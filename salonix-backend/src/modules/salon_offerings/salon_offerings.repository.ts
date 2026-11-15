import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { db } from '../../config/database.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import type {
    CreateComboRequest,
    CreateManualOfferSaleRequest,
    CreatePackageRequest,
    CreatePurchaseRequest,
    CustomerOfferPurchaseResponse,
    ListOfferingsQuery,
    OfferLedgerEntry,
    OfferPurchaseRequestResponse,
    OfferServiceSnapshot,
    OfferType,
    RejectOfferPurchaseRequest,
    UpdateComboRequest,
    UpdateOfferSaleQuoteRequest,
    UpdatePackageRequest,
} from './salon_offerings.types.js';

interface OfferRow extends QueryResultRow {
    id: string;
    revisionId: string;
    salonId: string;
    name: string;
    description: string | null;
    type: OfferType;
    sellingPrice: string;
    creditAmount: string | null;
    validityDays: number;
    status: string;
    revisionNumber: number;
    services: OfferServiceSnapshot[];
    createdAt: Date;
    updatedAt: Date;
}

interface RequestRow extends QueryResultRow {
    id: string;
    salonId: string;
    customerAccountId: string;
    offerType: OfferType;
    offeringId: string;
    status: OfferPurchaseRequestResponse['status'];
    paymentMode: OfferPurchaseRequestResponse['paymentMode'];
    listPrice: string;
    finalAmount: string;
    discountAmount: string;
    discountReason: string | null;
    termsSnapshot: Record<string, unknown>;
    servicesSnapshot: OfferServiceSnapshot[];
    isManualAssignment: boolean;
    billId: string | null;
    rejectionReason: string | null;
    createdAt: Date;
    acceptedAt: Date | null;
}

const OFFER_COLUMNS = `
    package.id,
    revision.id AS "revisionId",
    revision.salon_id AS "salonId",
    revision.name,
    revision.description,
    'PACKAGE'::varchar AS type,
    revision.selling_price::text AS "sellingPrice",
    revision.credit_amount::text AS "creditAmount",
    revision.validity_days AS "validityDays",
    revision.status,
    revision.revision_number AS "revisionNumber",
    COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'serviceId', service.service_id,
            'serviceName', service.service_name,
            'servicePriceAtRevision', service.service_price_at_revision::text,
            'estimatedDurationMinutes', service.estimated_duration_minutes,
            'maxUses', service.max_uses
        ) ORDER BY service.service_name)
        FROM salon_package_revision_services AS service
        WHERE service.revision_id = revision.id AND service.salon_id = revision.salon_id
    ), '[]'::jsonb) AS services,
    revision.created_at AS "createdAt",
    package.updated_at AS "updatedAt"`;

const COMBO_COLUMNS = `
    combo.id,
    revision.id AS "revisionId",
    revision.salon_id AS "salonId",
    revision.name,
    revision.description,
    'COMBO'::varchar AS type,
    revision.selling_price::text AS "sellingPrice",
    NULL::text AS "creditAmount",
    revision.validity_days AS "validityDays",
    revision.status,
    revision.revision_number AS "revisionNumber",
    COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'serviceId', service.service_id,
            'serviceName', service.service_name,
            'servicePriceAtRevision', service.service_price_at_revision::text,
            'estimatedDurationMinutes', service.estimated_duration_minutes
        ) ORDER BY service.service_name)
        FROM salon_combo_revision_services AS service
        WHERE service.revision_id = revision.id AND service.salon_id = revision.salon_id
    ), '[]'::jsonb) AS services,
    revision.created_at AS "createdAt",
    combo.updated_at AS "updatedAt"`;

function toMinorUnits(value: string): bigint {
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function fromMinorUnits(value: bigint): string {
    const whole = value / 100n;
    const fraction = String(value % 100n).padStart(2, '0');
    return `${whole}.${fraction}`;
}

export class SalonOfferingsRepository {
    async createPackage(salonId: string, accountId: string, data: CreatePackageRequest) {
        const client = await db.connect();
        const packageId = randomUUID();
        try {
            await client.query('BEGIN');
            await this.assertApprovedSalon(client, salonId);
            const services = await this.loadActiveServices(
                client, salonId, data.services.map(({ serviceId }) => serviceId)
            );
            await client.query(
                `INSERT INTO salon_packages (
                    id, salon_id, name, description, selling_price, total_value,
                    validity_days, status, is_public, is_active
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [
                    packageId, salonId, data.name, data.description ?? null,
                    data.sellingPrice, data.creditAmount, data.validityDays, data.status,
                    data.status === 'LISTED', data.status !== 'ARCHIVED',
                ]
            );
            const revisionId = await this.insertPackageRevision(
                client, packageId, salonId, accountId, 1, data
            );
            await this.insertPackageRevisionServices(client, revisionId, salonId, services, data.services);
            await client.query(
                `UPDATE salon_packages SET current_revision_id = $3 WHERE id = $1 AND salon_id = $2`,
                [packageId, salonId, revisionId]
            );
            await this.writeAudit(
                client, accountId, salonId, 'SALON_PACKAGE_CREATED', packageId,
                { revisionId, status: data.status }
            );
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        const offer = await this.getOffering(salonId, packageId, 'PACKAGE', false);
        if (!offer) throw new ApiError(500, 'Created package could not be loaded');
        return offer;
    }

    async updatePackage(
        salonId: string,
        packageId: string,
        accountId: string,
        data: UpdatePackageRequest
    ) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const currentResult = await client.query<{
                currentRevisionId: string;
                revisionNumber: number;
                status: string;
            }>(
                `SELECT package.current_revision_id AS "currentRevisionId",
                        revision.revision_number AS "revisionNumber",
                        package.status
                 FROM salon_packages AS package
                 JOIN salon_package_revisions AS revision
                   ON revision.id = package.current_revision_id
                  AND revision.salon_id = package.salon_id
                 WHERE package.id = $1 AND package.salon_id = $2
                 FOR UPDATE OF package`,
                [packageId, salonId]
            );
            const current = currentResult.rows[0];
            if (!current) throw new ApiError(404, 'Package was not found');
            if (current.status === 'ARCHIVED' && data.status !== 'ARCHIVED') {
                throw new ApiError(409, 'Archived packages cannot be republished');
            }

            const currentOffer = await this.getOfferingWithClient(
                client, salonId, packageId, 'PACKAGE'
            );
            if (!currentOffer) throw new ApiError(404, 'Package was not found');
            const next: CreatePackageRequest = {
                name: data.name ?? currentOffer.name,
                description: data.description === undefined
                    ? currentOffer.description
                    : data.description,
                sellingPrice: data.sellingPrice ?? currentOffer.sellingPrice,
                creditAmount: data.creditAmount ?? currentOffer.creditAmount ?? '0',
                validityDays: data.validityDays ?? currentOffer.validityDays,
                services: data.services ?? currentOffer.services.map((service) => ({
                    serviceId: service.serviceId,
                    maxUses: service.maxUses,
                })),
                status: data.status ?? currentOffer.status as CreatePackageRequest['status'],
            };
            await this.assertApprovedSalon(client, salonId);
            const services = data.services || next.status === 'LISTED'
                ? await this.loadActiveServices(
                    client, salonId, next.services.map(({ serviceId }) => serviceId)
                )
                : next.services.map((service) => {
                    const snapshot = currentOffer.services.find(
                        ({ serviceId }) => serviceId === service.serviceId
                    );
                    if (!snapshot) throw new ApiError(409, 'Package service snapshot is missing');
                    return {
                        id: snapshot.serviceId,
                        name: snapshot.serviceName,
                        basePrice: snapshot.servicePriceAtRevision,
                        estimatedDurationMinutes: snapshot.estimatedDurationMinutes,
                    };
                });
            const revisionId = await this.insertPackageRevision(
                client, packageId, salonId, accountId, current.revisionNumber + 1, next
            );
            await this.insertPackageRevisionServices(client, revisionId, salonId, services, next.services);
            await client.query(
                `UPDATE salon_packages
                 SET name = $3, description = $4, selling_price = $5, total_value = $6,
                     validity_days = $7, status = $8, current_revision_id = $9,
                     is_public = $10, is_active = $11, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND salon_id = $2`,
                [
                    packageId, salonId, next.name, next.description ?? null, next.sellingPrice,
                    next.creditAmount, next.validityDays, next.status, revisionId,
                    next.status === 'LISTED', next.status !== 'ARCHIVED',
                ]
            );
            await this.writeAudit(
                client, accountId, salonId, 'SALON_PACKAGE_UPDATED', packageId,
                { revisionId, status: next.status }
            );
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        const offer = await this.getOffering(salonId, packageId, 'PACKAGE', false);
        if (!offer) throw new ApiError(500, 'Updated package could not be loaded');
        return offer;
    }

    async createCombo(salonId: string, accountId: string, data: CreateComboRequest) {
        const client = await db.connect();
        const comboId = randomUUID();
        try {
            await client.query('BEGIN');
            await this.assertApprovedSalon(client, salonId);
            const services = await this.loadActiveServices(client, salonId, data.serviceIds);
            await client.query(
                `INSERT INTO salon_service_combos (
                    id, salon_id, name, description, bundle_price, validity_days, status,
                    is_public, is_active
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                    comboId, salonId, data.name, data.description ?? null, data.sellingPrice,
                    data.validityDays, data.status, data.status === 'LISTED',
                    data.status !== 'ARCHIVED',
                ]
            );
            const revisionId = await this.insertComboRevision(
                client, comboId, salonId, accountId, 1, data
            );
            await this.insertComboRevisionServices(client, revisionId, salonId, services);
            await client.query(
                `UPDATE salon_service_combos SET current_revision_id = $3 WHERE id = $1 AND salon_id = $2`,
                [comboId, salonId, revisionId]
            );
            await this.writeAudit(
                client, accountId, salonId, 'SALON_COMBO_CREATED', comboId,
                { revisionId, status: data.status }
            );
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        const offer = await this.getOffering(salonId, comboId, 'COMBO', false);
        if (!offer) throw new ApiError(500, 'Created combo could not be loaded');
        return offer;
    }

    async updateCombo(
        salonId: string,
        comboId: string,
        accountId: string,
        data: UpdateComboRequest
    ) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const currentResult = await client.query<{
                revisionNumber: number;
                status: string;
            }>(
                `SELECT revision.revision_number AS "revisionNumber", combo.status
                 FROM salon_service_combos AS combo
                 JOIN salon_combo_revisions AS revision
                   ON revision.id = combo.current_revision_id
                  AND revision.salon_id = combo.salon_id
                 WHERE combo.id = $1 AND combo.salon_id = $2
                 FOR UPDATE OF combo`,
                [comboId, salonId]
            );
            const current = currentResult.rows[0];
            if (!current) throw new ApiError(404, 'Combo was not found');
            if (current.status === 'ARCHIVED' && data.status !== 'ARCHIVED') {
                throw new ApiError(409, 'Archived combos cannot be republished');
            }
            const currentOffer = await this.getOfferingWithClient(
                client, salonId, comboId, 'COMBO'
            );
            if (!currentOffer) throw new ApiError(404, 'Combo was not found');
            const next: CreateComboRequest = {
                name: data.name ?? currentOffer.name,
                description: data.description === undefined
                    ? currentOffer.description
                    : data.description,
                sellingPrice: data.sellingPrice ?? currentOffer.sellingPrice,
                validityDays: data.validityDays ?? currentOffer.validityDays,
                serviceIds: data.serviceIds ?? currentOffer.services.map(({ serviceId }) => serviceId),
                status: data.status ?? currentOffer.status as CreateComboRequest['status'],
            };
            await this.assertApprovedSalon(client, salonId);
            const services = data.serviceIds || next.status === 'LISTED'
                ? await this.loadActiveServices(client, salonId, next.serviceIds)
                : next.serviceIds.map((serviceId) => {
                    const snapshot = currentOffer.services.find(
                        (service) => service.serviceId === serviceId
                    );
                    if (!snapshot) throw new ApiError(409, 'Combo service snapshot is missing');
                    return {
                        id: snapshot.serviceId,
                        name: snapshot.serviceName,
                        basePrice: snapshot.servicePriceAtRevision,
                        estimatedDurationMinutes: snapshot.estimatedDurationMinutes,
                    };
                });
            const revisionId = await this.insertComboRevision(
                client, comboId, salonId, accountId, current.revisionNumber + 1, next
            );
            await this.insertComboRevisionServices(client, revisionId, salonId, services);
            await client.query(
                `UPDATE salon_service_combos
                 SET name = $3, description = $4, bundle_price = $5, validity_days = $6,
                     status = $7, current_revision_id = $8, is_public = $9, is_active = $10,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND salon_id = $2`,
                [
                    comboId, salonId, next.name, next.description ?? null, next.sellingPrice,
                    next.validityDays, next.status, revisionId, next.status === 'LISTED',
                    next.status !== 'ARCHIVED',
                ]
            );
            await this.writeAudit(
                client, accountId, salonId, 'SALON_COMBO_UPDATED', comboId,
                { revisionId, status: next.status }
            );
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        const offer = await this.getOffering(salonId, comboId, 'COMBO', false);
        if (!offer) throw new ApiError(500, 'Updated combo could not be loaded');
        return offer;
    }

    async listOfferings(salonId: string, query: ListOfferingsQuery, publicOnly: boolean) {
        const result = await db.query<OfferRow>(
            `SELECT offering.*
             FROM (
                 SELECT ${OFFER_COLUMNS}
                 FROM salon_packages AS package
                 JOIN salon_package_revisions AS revision
                   ON revision.id = package.current_revision_id AND revision.salon_id = package.salon_id
                 WHERE package.salon_id = $1
                 UNION ALL
                 SELECT ${COMBO_COLUMNS}
                 FROM salon_service_combos AS combo
                 JOIN salon_combo_revisions AS revision
                   ON revision.id = combo.current_revision_id AND revision.salon_id = combo.salon_id
                 WHERE combo.salon_id = $1
             ) AS offering
             WHERE ($2::varchar IS NULL OR offering.type = $2)
               AND ($3::boolean = FALSE OR offering.status = 'LISTED')
               AND ($3::boolean = FALSE OR EXISTS (
                   SELECT 1 FROM salons AS salon
                   JOIN salon_applications AS application ON application.salon_id = salon.id
                   WHERE salon.id = $1 AND salon.status = 'ACTIVE'
                     AND salon.deleted_at IS NULL AND application.status = 'APPROVED'
               ))
             ORDER BY offering."createdAt" DESC, offering.id
             LIMIT $4 OFFSET $5`,
            [salonId, query.type ?? null, publicOnly, query.limit, query.offset]
        );
        return result.rows;
    }

    async getOffering(
        salonId: string,
        offeringId: string,
        type: OfferType,
        publicOnly: boolean
    ) {
        const result = type === 'PACKAGE'
            ? await db.query<OfferRow>(
                `SELECT ${OFFER_COLUMNS}
                 FROM salon_packages AS package
                 JOIN salon_package_revisions AS revision
                   ON revision.id = package.current_revision_id AND revision.salon_id = package.salon_id
                 WHERE package.id = $1 AND package.salon_id = $2
                   AND ($3::boolean = FALSE OR revision.status = 'LISTED')
                   AND ($3::boolean = FALSE OR EXISTS (
                       SELECT 1 FROM salons AS salon
                       JOIN salon_applications AS application ON application.salon_id = salon.id
                       WHERE salon.id = package.salon_id
                         AND salon.status = 'ACTIVE' AND salon.deleted_at IS NULL
                         AND application.status = 'APPROVED'
                   ))`,
                [offeringId, salonId, publicOnly]
            )
            : await db.query<OfferRow>(
                `SELECT ${COMBO_COLUMNS}
                 FROM salon_service_combos AS combo
                 JOIN salon_combo_revisions AS revision
                   ON revision.id = combo.current_revision_id AND revision.salon_id = combo.salon_id
                 WHERE combo.id = $1 AND combo.salon_id = $2
                   AND ($3::boolean = FALSE OR revision.status = 'LISTED')
                   AND ($3::boolean = FALSE OR EXISTS (
                       SELECT 1 FROM salons AS salon
                       JOIN salon_applications AS application ON application.salon_id = salon.id
                       WHERE salon.id = combo.salon_id
                         AND salon.status = 'ACTIVE' AND salon.deleted_at IS NULL
                         AND application.status = 'APPROVED'
                   ))`,
                [offeringId, salonId, publicOnly]
            );
        return result.rows[0] ?? null;
    }

    async createPurchaseRequest(
        customerAccountId: string,
        salonId: string,
        input: CreatePurchaseRequest
    ) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await this.assertCustomer(client, customerAccountId);
            const offer = await this.getOfferingWithClient(
                client, salonId, input.offeringId, input.offerType, true
            );
            if (!offer || offer.status !== 'LISTED') {
                throw new ApiError(404, 'Listed package or combo was not found');
            }
            const request = await this.insertPurchaseRequest(
                client, customerAccountId, salonId, input.offerType, offer,
                input.paymentMode ?? null, false, customerAccountId, undefined
            );
            await client.query('COMMIT');
            return request;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async createManualSale(
        salonId: string,
        actorAccountId: string,
        input: CreateManualOfferSaleRequest
    ) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await this.lockIdempotencyKey(client, actorAccountId, input.idempotencyKey);
            await this.assertApprovedSalon(client, salonId);
            const customer = await client.query<{ accountId: string }>(
                `SELECT account.id AS "accountId"
                 FROM accounts AS account
                 JOIN customer_profiles AS profile ON profile.account_id = account.id
                 WHERE account.account_type = 'CUSTOMER'
                   AND account.phone_number = $1
                   AND account.status = 'ACTIVE'
                   AND account.phone_verified_at IS NOT NULL
                   AND account.deleted_at IS NULL
                 FOR SHARE OF account`,
                [input.customerPhone]
            );
            if (!customer.rows[0]) throw new ApiError(404, 'Active customer account was not found');
            const existing = await client.query<RequestRow>(
                `SELECT request.id, request.salon_id AS "salonId",
                        request.customer_account_id AS "customerAccountId",
                        request.offer_type AS "offerType",
                        COALESCE(request.package_id, request.combo_id) AS "offeringId",
                        request.status, request.payment_mode AS "paymentMode",
                        request.list_price::text AS "listPrice",
                        request.final_amount::text AS "finalAmount",
                        request.discount_amount::text AS "discountAmount",
                        request.discount_reason AS "discountReason",
                        request.terms_snapshot AS "termsSnapshot",
                        request.services_snapshot AS "servicesSnapshot",
                        request.is_manual_assignment AS "isManualAssignment",
                        request.bill_id AS "billId",
                        request.rejection_reason AS "rejectionReason",
                        request.created_at AS "createdAt",
                        request.accepted_at AS "acceptedAt"
                 FROM salon_offer_purchase_requests AS request
                 WHERE request.created_by_account_id = $1 AND request.idempotency_key = $2
                 FOR UPDATE`,
                [actorAccountId, input.idempotencyKey]
            );
            if (existing.rows[0]) {
                const prior = this.mapRequest(existing.rows[0]);
                if (
                    prior.salonId !== salonId ||
                    prior.customerAccountId !== customer.rows[0].accountId ||
                    prior.offerType !== input.offerType ||
                    prior.offeringId !== input.offeringId ||
                    prior.paymentMode !== (input.paymentMode ?? null) ||
                    toMinorUnits(prior.finalAmount) !== toMinorUnits(input.finalAmount) ||
                    prior.discountReason !== (input.discountReason ?? null)
                ) {
                    throw new ApiError(409, 'Idempotency key was already used for a different sale');
                }
                await client.query('COMMIT');
                return prior;
            }
            const offer = await this.getOfferingWithClient(
                client, salonId, input.offeringId, input.offerType
            );
            if (!offer || !['LISTED', 'UNLISTED'].includes(offer.status)) {
                throw new ApiError(404, 'Available package or combo was not found');
            }
            const finalAmount = toMinorUnits(input.finalAmount);
            const listPrice = toMinorUnits(offer.sellingPrice);
            if (finalAmount > listPrice) {
                throw new ApiError(400, 'Manual sale amount cannot exceed the catalog selling price');
            }
            if (finalAmount < listPrice && !input.discountReason) {
                throw new ApiError(400, 'A reason is required when the manual sale is discounted');
            }
            const request = await this.insertPurchaseRequest(
                client,
                customer.rows[0].accountId,
                salonId,
                input.offerType,
                offer,
                input.paymentMode ?? null,
                true,
                actorAccountId,
                {
                    finalAmount: input.finalAmount,
                    discountReason: input.discountReason,
                    idempotencyKey: input.idempotencyKey,
                    status: 'BILLING',
                }
            );
            await client.query('COMMIT');
            return request;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async listPurchaseRequests(
        salonId: string,
        query: { limit: number; offset: number; status?: string; type?: string }
    ) {
        const result = await db.query<RequestRow & QueryResultRow>(
            `SELECT request.id, request.salon_id AS "salonId",
                    request.customer_account_id AS "customerAccountId",
                    request.offer_type AS "offerType",
                    COALESCE(request.package_id, request.combo_id) AS "offeringId",
                    request.status, request.payment_mode AS "paymentMode",
                    request.list_price::text AS "listPrice",
                    request.final_amount::text AS "finalAmount",
                    request.discount_amount::text AS "discountAmount",
                    request.discount_reason AS "discountReason",
                    request.terms_snapshot AS "termsSnapshot",
                    request.services_snapshot AS "servicesSnapshot",
                    request.is_manual_assignment AS "isManualAssignment",
                    request.bill_id AS "billId",
                    request.rejection_reason AS "rejectionReason",
                    request.created_at AS "createdAt",
                    request.accepted_at AS "acceptedAt"
             FROM salon_offer_purchase_requests AS request
             WHERE request.salon_id = $1
               AND ($2::varchar IS NULL OR request.status = $2)
               AND ($3::varchar IS NULL OR request.offer_type = $3)
             ORDER BY request.created_at DESC, request.id
             LIMIT $4 OFFSET $5`,
            [salonId, query.status ?? null, query.type ?? null, query.limit, query.offset]
        );
        return result.rows.map((row) => this.mapRequest(row));
    }

    async listMyPurchases(customerAccountId: string, limit: number, offset: number) {
        const result = await db.query<RequestRow & QueryResultRow & {
            entitlementId: string | null;
            remainingCredit: string | null;
            purchaseStatus: string;
            expiresAt: Date | null;
        }>(
            `SELECT request.id, request.salon_id AS "salonId",
                    request.customer_account_id AS "customerAccountId",
                    request.offer_type AS "offerType",
                    COALESCE(request.package_id, request.combo_id) AS "offeringId",
                    request.status, request.payment_mode AS "paymentMode",
                    request.list_price::text AS "listPrice",
                    request.final_amount::text AS "finalAmount",
                    request.discount_amount::text AS "discountAmount",
                    request.discount_reason AS "discountReason",
                    request.terms_snapshot AS "termsSnapshot",
                    request.services_snapshot AS "servicesSnapshot",
                    request.is_manual_assignment AS "isManualAssignment",
                    request.bill_id AS "billId",
                    request.rejection_reason AS "rejectionReason",
                    request.created_at AS "createdAt",
                    request.accepted_at AS "acceptedAt",
             CASE WHEN request.offer_type = 'PACKAGE'
                  THEN subscription.id ELSE combo_purchase.id END AS "entitlementId",
             CASE WHEN request.offer_type = 'PACKAGE'
                  THEN subscription.remaining_value::text ELSE NULL END AS "remainingCredit",
             COALESCE(
                 CASE
                     WHEN request.offer_type = 'PACKAGE' AND subscription.expires_at <= CURRENT_TIMESTAMP
                         THEN 'EXPIRED'
                     WHEN request.offer_type = 'COMBO' AND combo_purchase.expires_at <= CURRENT_TIMESTAMP
                         THEN 'EXPIRED'
                     WHEN request.offer_type = 'PACKAGE' THEN subscription.status
                     ELSE combo_purchase.status
                 END,
                 request.status
             ) AS "purchaseStatus",
             CASE WHEN request.offer_type = 'PACKAGE'
                  THEN subscription.expires_at ELSE combo_purchase.expires_at END AS "expiresAt"
             FROM salon_offer_purchase_requests AS request
             LEFT JOIN customer_package_subscriptions AS subscription
               ON subscription.purchase_request_id = request.id
              AND subscription.salon_id = request.salon_id
             LEFT JOIN customer_combo_purchases AS combo_purchase
               ON combo_purchase.purchase_request_id = request.id
              AND combo_purchase.salon_id = request.salon_id
             WHERE request.customer_account_id = $1
             ORDER BY request.created_at DESC, request.id
             LIMIT $2 OFFSET $3`,
            [customerAccountId, limit, offset]
        );
        return result.rows.map((row) => ({
            request: this.mapRequest(row),
            entitlementId: row.entitlementId,
            remainingCredit: row.remainingCredit,
            status: row.purchaseStatus,
            expiresAt: row.expiresAt,
        }));
    }

    async getPurchaseRequest(
        salonId: string,
        requestId: string,
        customerAccountId?: string
    ) {
        const result = await db.query<RequestRow & QueryResultRow>(
            `SELECT request.id, request.salon_id AS "salonId",
                    request.customer_account_id AS "customerAccountId",
                    request.offer_type AS "offerType",
                    COALESCE(request.package_id, request.combo_id) AS "offeringId",
                    request.status, request.payment_mode AS "paymentMode",
                    request.list_price::text AS "listPrice",
                    request.final_amount::text AS "finalAmount",
                    request.discount_amount::text AS "discountAmount",
                    request.discount_reason AS "discountReason",
                    request.terms_snapshot AS "termsSnapshot",
                    request.services_snapshot AS "servicesSnapshot",
                    request.is_manual_assignment AS "isManualAssignment",
                    request.bill_id AS "billId",
                    request.rejection_reason AS "rejectionReason",
                    request.created_at AS "createdAt",
                    request.accepted_at AS "acceptedAt"
             FROM salon_offer_purchase_requests AS request
             WHERE request.salon_id = $1 AND request.id = $2
               AND ($3::uuid IS NULL OR request.customer_account_id = $3)`,
            [salonId, requestId, customerAccountId ?? null]
        );
        const request = result.rows[0] ? this.mapRequest(result.rows[0]) : null;
        if (!request || !customerAccountId) return request;
        const client = await db.connect();
        try {
            return await this.getCustomerPurchaseWithClient(client, request);
        } finally {
            client.release();
        }
    }

    async startCheckout(salonId: string, requestId: string, accountId: string) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const current = await client.query<{ status: string }>(
                `SELECT status FROM salon_offer_purchase_requests
                 WHERE id = $1 AND salon_id = $2 FOR UPDATE`,
                [requestId, salonId]
            );
            const row = current.rows[0];
            if (!row) throw new ApiError(404, 'Offer purchase request was not found');
            if (row.status === 'PENDING') {
                await client.query(
                    `UPDATE salon_offer_purchase_requests
                     SET status = 'BILLING', updated_at = CURRENT_TIMESTAMP
                     WHERE id = $1 AND salon_id = $2`,
                    [requestId, salonId]
                );
                await this.writeAudit(
                    client, accountId, salonId, 'OFFER_CHECKOUT_STARTED',
                    requestId, {}
                );
            } else if (row.status !== 'BILLING') {
                throw new ApiError(409, 'Only pending requests can enter billing');
            }
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        const request = await this.getPurchaseRequest(salonId, requestId);
        if (!request) throw new ApiError(500, 'Billing request could not be loaded');
        return request;
    }

    async updateSaleQuote(
        salonId: string,
        requestId: string,
        data: UpdateOfferSaleQuoteRequest,
        accountId: string
    ) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const current = await client.query<{
                id: string;
                status: string;
                listPrice: string;
                isManualAssignment: boolean;
                billId: string | null;
            }>(
                `SELECT id, status, list_price::text AS "listPrice",
                        bill_id AS "billId",
                        is_manual_assignment AS "isManualAssignment"
                 FROM salon_offer_purchase_requests
                 WHERE id = $1 AND salon_id = $2
                 FOR UPDATE`,
                [requestId, salonId]
            );
            const request = current.rows[0];
            if (!request) throw new ApiError(404, 'Offer purchase request was not found');
            if (!['PENDING', 'BILLING'].includes(request.status)) {
                throw new ApiError(409, 'A finalized purchase request cannot be repriced');
            }
            if (request.billId) {
                throw new ApiError(409, 'Set the final quote before linking the POS bill');
            }
            const finalAmountMinor = toMinorUnits(data.finalAmount);
            const listPriceMinor = toMinorUnits(request.listPrice);
            if (finalAmountMinor > listPriceMinor) {
                throw new ApiError(400, 'Final sale amount cannot exceed the catalog selling price');
            }
            if (
                finalAmountMinor < listPriceMinor &&
                !data.discountReason
            ) {
                throw new ApiError(400, 'A reason is required for a discount');
            }
            const discountAmount = fromMinorUnits(listPriceMinor - finalAmountMinor);
            await client.query(
                `UPDATE salon_offer_purchase_requests
                 SET status = 'BILLING', final_amount = $3, discount_amount = $4,
                     discount_reason = $5, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND salon_id = $2`,
                [
                    requestId,
                    salonId,
                    data.finalAmount,
                    discountAmount,
                    data.discountReason ?? null,
                ]
            );
            await this.writeAudit(
                client, accountId, salonId, 'OFFER_SALE_QUOTED', requestId,
                { finalAmount: data.finalAmount, discountAmount, reason: data.discountReason ?? null }
            );
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        const updated = await this.getPurchaseRequest(salonId, requestId);
        if (!updated) throw new ApiError(500, 'Updated sale quote could not be loaded');
        return updated;
    }

    async attachDraftBill(
        salonId: string,
        requestId: string,
        billId: string,
        accountId: string
    ) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const requestResult = await client.query<{
                status: string;
                customerAccountId: string;
                finalAmount: string;
                billId: string | null;
            }>(
                `SELECT status, customer_account_id AS "customerAccountId",
                        final_amount::text AS "finalAmount", bill_id AS "billId"
                 FROM salon_offer_purchase_requests
                 WHERE id = $1 AND salon_id = $2
                 FOR UPDATE`,
                [requestId, salonId]
            );
            const request = requestResult.rows[0];
            if (!request) throw new ApiError(404, 'Offer purchase request was not found');
            if (request.status !== 'BILLING') {
                throw new ApiError(409, 'Offer request must be in billing before attaching a draft bill');
            }
            if (request.billId && request.billId !== billId) {
                throw new ApiError(409, 'A different bill is already attached to this offer request');
            }
            const billResult = await client.query<{
                billStatus: string;
                sessionStatus: string;
                customerAccountId: string;
                netSubtotal: string;
                linkedRequestId: string | null;
            }>(
                `SELECT bill.status AS "billStatus", session.status AS "sessionStatus",
                        session.customer_account_id AS "customerAccountId",
                        COALESCE((
                            SELECT SUM(item.subtotal - item.discount_amount)
                            FROM pos_bill_items AS item
                            WHERE item.bill_id = bill.id AND item.salon_id = bill.salon_id
                              AND item.item_type IN ('PACKAGE', 'COMBO')
                              AND item.removed_at IS NULL
                        ), bill.subtotal - bill.discount_amount)::text AS "netSubtotal",
                        bill.offer_purchase_request_id AS "linkedRequestId"
                 FROM pos_bills AS bill
                 JOIN pos_billing_sessions AS session
                   ON session.id = bill.session_id AND session.salon_id = bill.salon_id
                 WHERE bill.id = $1 AND bill.salon_id = $2
                 FOR UPDATE OF bill, session`,
                [billId, salonId]
            );
            const bill = billResult.rows[0];
            if (!bill || bill.customerAccountId !== request.customerAccountId) {
                throw new ApiError(404, 'Draft POS bill for this customer and salon was not found');
            }
            if (
                bill.billStatus !== 'OPEN' ||
                bill.sessionStatus !== 'OPEN'
            ) {
                throw new ApiError(409, 'Only an open, unpaid POS bill can be attached');
            }
            if (bill.linkedRequestId && bill.linkedRequestId !== requestId) {
                throw new ApiError(409, 'POS bill is already linked to another offer request');
            }
            if (toMinorUnits(bill.netSubtotal) !== toMinorUnits(request.finalAmount)) {
                throw new ApiError(409, 'Draft bill amount does not match the offer quote');
            }
            await client.query(
                `UPDATE pos_bills
                 SET offer_purchase_request_id = $3
                 WHERE id = $1 AND salon_id = $2`,
                [billId, salonId, requestId]
            );
            await client.query(
                `UPDATE salon_offer_purchase_requests
                 SET bill_id = $3, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND salon_id = $2`,
                [requestId, salonId, billId]
            );
            await this.writeAudit(
                client, accountId, salonId, 'OFFER_DRAFT_BILL_ATTACHED',
                requestId, { billId, finalAmount: request.finalAmount }
            );
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        const updated = await this.getPurchaseRequest(salonId, requestId);
        if (!updated) throw new ApiError(500, 'Offer bill link could not be loaded');
        return updated;
    }

    async rejectPurchaseRequest(
        salonId: string,
        requestId: string,
        actorAccountId: string,
        data: RejectOfferPurchaseRequest
    ) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const current = await client.query<{ status: string; billId: string | null }>(
                `SELECT status, bill_id AS "billId" FROM salon_offer_purchase_requests
                 WHERE id = $1 AND salon_id = $2 FOR UPDATE`,
                [requestId, salonId]
            );
            if (!current.rows[0]) throw new ApiError(404, 'Offer purchase request was not found');
            if (!['PENDING', 'BILLING'].includes(current.rows[0].status)) {
                throw new ApiError(409, 'Only pending or billing requests can be rejected');
            }
            if (current.rows[0].billId) {
                const attachedBill = await client.query<{ status: string }>(
                    `SELECT status FROM pos_bills
                     WHERE id = $1 AND salon_id = $2 FOR SHARE`,
                    [current.rows[0].billId, salonId]
                );
                if (attachedBill.rows[0]?.status !== 'CANCELLED') {
                    throw new ApiError(409, 'Cancel the attached POS bill before rejecting this request');
                }
            }
            await client.query(
                `UPDATE salon_offer_purchase_requests
                 SET status = 'REJECTED', rejection_reason = $3,
                     rejected_by_account_id = $4, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND salon_id = $2`,
                [requestId, salonId, data.reason, actorAccountId]
            );
            await this.writeAudit(
                client, actorAccountId, salonId, 'OFFER_PURCHASE_REJECTED',
                requestId, { reason: data.reason }
            );
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        return this.getPurchaseRequest(salonId, requestId);
    }

    async confirmSettlement(
        salonId: string,
        requestId: string,
        actorAccountId: string,
        billId: string,
        idempotencyKey: string
    ) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await this.lockIdempotencyKey(client, salonId, idempotencyKey);
            const existingLedger = await client.query<{
                purchaseRequestId: string;
                entryType: string;
            }>(
                `SELECT purchase_request_id AS "purchaseRequestId", entry_type AS "entryType"
                 FROM salon_offer_ledger
                 WHERE salon_id = $1 AND idempotency_key = $2`,
                [salonId, idempotencyKey]
            );
            if (existingLedger.rows[0]) {
                if (
                    existingLedger.rows[0].purchaseRequestId !== requestId ||
                    existingLedger.rows[0].entryType !== 'SALE'
                ) {
                    throw new ApiError(409, 'Idempotency key belongs to another offer transaction');
                }
                const prior = await this.getPurchaseRequestWithClient(client, salonId, requestId);
                if (!prior) throw new ApiError(404, 'Offer purchase request was not found');
                await client.query('COMMIT');
                return this.getCustomerPurchaseWithClient(client, prior);
            }

            const locked = await client.query<RequestRow>(
                `SELECT request.id, request.salon_id AS "salonId",
                        request.customer_account_id AS "customerAccountId",
                        request.offer_type AS "offerType",
                        COALESCE(request.package_id, request.combo_id) AS "offeringId",
                        request.status, request.payment_mode AS "paymentMode",
                        request.list_price::text AS "listPrice",
                        request.final_amount::text AS "finalAmount",
                        request.discount_amount::text AS "discountAmount",
                        request.discount_reason AS "discountReason",
                        request.terms_snapshot AS "termsSnapshot",
                        request.services_snapshot AS "servicesSnapshot",
                        request.is_manual_assignment AS "isManualAssignment",
                        request.bill_id AS "billId",
                        request.rejection_reason AS "rejectionReason",
                        request.created_at AS "createdAt",
                        request.accepted_at AS "acceptedAt"
                 FROM salon_offer_purchase_requests AS request
                 WHERE request.id = $1 AND request.salon_id = $2
                 FOR UPDATE`,
                [requestId, salonId]
            );
            const request = locked.rows[0];
            if (!request) throw new ApiError(404, 'Offer purchase request was not found');
            if (request.billId !== billId) {
                throw new ApiError(409, 'The settled bill is not attached to this offer request');
            }
            if (request.status === 'ACCEPTED' && request.billId === billId) {
                const repeated = await this.findLedgerByIdempotency(client, salonId, idempotencyKey);
                if (repeated?.purchaseRequestId === requestId && repeated.entryType === 'SALE') {
                    await client.query('COMMIT');
                    return this.getCustomerPurchaseWithClient(client, request);
                }
            }
            if (request.status !== 'BILLING') {
                throw new ApiError(409, 'Offer request must be in billing before settlement');
            }
            const bill = await client.query<{
                billId: string;
                billStatus: string;
                sessionStatus: string;
                sessionCustomerId: string;
                netSubtotal: string;
                invoiceNumber: string;
                offerPurchaseRequestId: string | null;
            }>(
                `SELECT bill.id AS "billId", bill.status AS "billStatus",
                        bill.invoice_number AS "invoiceNumber",
                        session.status AS "sessionStatus",
                        session.customer_account_id AS "sessionCustomerId",
                        COALESCE((
                            SELECT SUM(item.subtotal - item.discount_amount)
                            FROM pos_bill_items AS item
                            WHERE item.bill_id = bill.id AND item.salon_id = bill.salon_id
                              AND item.item_type IN ('PACKAGE', 'COMBO')
                              AND item.removed_at IS NULL
                        ), bill.subtotal - bill.discount_amount)::text AS "netSubtotal",
                        bill.offer_purchase_request_id AS "offerPurchaseRequestId"
                 FROM pos_bills AS bill
                 JOIN pos_billing_sessions AS session
                   ON session.id = bill.session_id AND session.salon_id = bill.salon_id
                 WHERE bill.id = $1 AND bill.salon_id = $2
                 FOR SHARE OF bill, session`,
                [billId, salonId]
            );
            const settledBill = bill.rows[0];
            if (!settledBill || settledBill.sessionCustomerId !== request.customerAccountId) {
                throw new ApiError(404, 'Paid POS bill for this customer and salon was not found');
            }
            if (settledBill.offerPurchaseRequestId !== requestId) {
                throw new ApiError(409, 'POS bill is not linked to this offer request');
            }
            if (settledBill.billStatus !== 'CLOSED' || settledBill.sessionStatus !== 'PAID') {
                throw new ApiError(409, 'Offer entitlements require a fully settled POS bill');
            }
            if (toMinorUnits(settledBill.netSubtotal) !== toMinorUnits(request.finalAmount)) {
                throw new ApiError(409, 'Settled bill amount does not match the approved offer quote');
            }

            const startsAt = new Date();
            const terms = request.termsSnapshot;
            const services = request.servicesSnapshot;
            let entitlementId: string;
            if (request.offerType === 'PACKAGE') {
                const inserted = await client.query<{ id: string }>(
                    `INSERT INTO customer_package_subscriptions (
                        customer_account_id, salon_id, package_id, custom_name, custom_value,
                        starts_at, expires_at, remaining_value, payment_status, status,
                        is_manual_assignment, purchase_request_id, selling_price, terms_snapshot
                     )
                     VALUES ($1, $2, $3, $4, $5, $6,
                         $6 + make_interval(days => $7), $5, 'PAID', 'ACTIVE',
                         $8, $9, $10, $11::jsonb)
                     RETURNING id`,
                    [
                        request.customerAccountId, salonId, request.offeringId,
                        terms.name, terms.creditAmount, startsAt, terms.validityDays,
                        request.isManualAssignment, requestId, request.finalAmount,
                        JSON.stringify(terms),
                    ]
                );
                entitlementId = inserted.rows[0].id;
                await client.query(
                    `INSERT INTO customer_package_service_balances (
                        subscription_id, salon_id, service_id, max_uses, used_count
                     )
                     SELECT $1, $2, snapshot."serviceId", snapshot."maxUses", 0
                     FROM jsonb_to_recordset($3::jsonb) AS snapshot(
                         "serviceId" uuid, "maxUses" integer
                     )`,
                    [entitlementId, salonId, JSON.stringify(services)]
                );
            } else {
                const inserted = await client.query<{ id: string }>(
                    `INSERT INTO customer_combo_purchases (
                        customer_account_id, salon_id, combo_id, purchased_at, expires_at,
                        payment_status, status, is_manual_assignment, purchase_request_id,
                        selling_price, terms_snapshot
                     )
                     VALUES ($1, $2, $3, $4, $4 + make_interval(days => $5),
                         'PAID', 'ACTIVE', $6, $7, $8, $9::jsonb)
                     RETURNING id`,
                    [
                        request.customerAccountId, salonId, request.offeringId,
                        startsAt, terms.validityDays, request.isManualAssignment,
                        requestId, request.finalAmount, JSON.stringify({
                            ...terms,
                            services,
                            bundlePrice: terms.sellingPrice,
                        }),
                    ]
                );
                entitlementId = inserted.rows[0].id;
            }
            await client.query(
                `UPDATE salon_offer_purchase_requests
                 SET status = 'ACCEPTED', bill_id = $3, accepted_at = CURRENT_TIMESTAMP,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND salon_id = $2`,
                [requestId, salonId, billId]
            );
            await client.query(
                `INSERT INTO salon_offer_ledger (
                    salon_id, customer_account_id, purchase_request_id, entry_type,
                    amount, bill_id, idempotency_key, metadata
                 ) VALUES ($1, $2, $3, 'SALE', $4, $5, $6, $7::jsonb)`,
                [
                    salonId, request.customerAccountId, requestId, request.finalAmount,
                    billId, idempotencyKey,
                    JSON.stringify({
                        listPrice: request.listPrice,
                        finalAmount: request.finalAmount,
                        discountAmount: request.discountAmount,
                        discountReason: request.discountReason,
                        offerType: request.offerType,
                        entitlementId,
                        termsSnapshot: terms,
                        servicesSnapshot: services,
                    }),
                ]
            );
            await this.enqueueActivationNotifications(
                client, request.customerAccountId, salonId, request, billId,
                settledBill.invoiceNumber
            );
            await this.writeAudit(
                client, actorAccountId, salonId, 'OFFER_PURCHASE_ACTIVATED',
                requestId, { billId, entitlementId, finalAmount: request.finalAmount }
            );
            const activatedRequest = await this.getPurchaseRequestWithClient(
                client, salonId, requestId
            );
            if (!activatedRequest) throw new ApiError(500, 'Activated offer purchase could not be loaded');
            const purchase = await this.getCustomerPurchaseWithClient(client, activatedRequest);
            await client.query('COMMIT');
            return purchase;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async redeemPackage(
        salonId: string,
        subscriptionId: string,
        accountId: string,
        serviceId: string,
        billId: string,
        idempotencyKey: string
    ) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await this.lockIdempotencyKey(client, salonId, idempotencyKey);
            const prior = await this.findLedgerByIdempotency(client, salonId, idempotencyKey);
            if (prior) {
                if (
                    prior.entryType !== 'PACKAGE_REDEMPTION' ||
                    prior.metadata.entitlementId !== subscriptionId
                ) {
                    throw new ApiError(409, 'Idempotency key belongs to another offer transaction');
                }
                await client.query('COMMIT');
                return prior;
            }
            const entitlement = await client.query<{
                requestId: string;
                customerAccountId: string;
                status: string;
                remainingValue: string;
                expiresAt: Date;
                servicePrice: string;
                serviceName: string;
                maxUses: number | null;
                usedCount: number;
            }>(
                `SELECT subscription.purchase_request_id AS "requestId",
                        subscription.customer_account_id AS "customerAccountId",
                        subscription.status, subscription.remaining_value::text AS "remainingValue",
                        subscription.expires_at AS "expiresAt",
                        service.base_price::text AS "servicePrice",
                        snapshot.service_name AS "serviceName",
                        balance.max_uses AS "maxUses", balance.used_count AS "usedCount"
                 FROM customer_package_subscriptions AS subscription
                 JOIN salon_offer_purchase_requests AS request
                   ON request.id = subscription.purchase_request_id
                  AND request.salon_id = subscription.salon_id
                 JOIN customer_package_service_balances AS balance
                   ON balance.subscription_id = subscription.id
                  AND balance.salon_id = subscription.salon_id
                  AND balance.service_id = $3
                 JOIN salon_package_revision_services AS snapshot
                   ON snapshot.revision_id = request.package_revision_id
                  AND snapshot.salon_id = subscription.salon_id
                  AND snapshot.service_id = balance.service_id
                 JOIN salon_services AS service
                   ON service.id = balance.service_id AND service.salon_id = subscription.salon_id
                 WHERE subscription.id = $1 AND subscription.salon_id = $2
                   AND subscription.payment_status = 'PAID'
                   AND subscription.status = 'ACTIVE'
                   AND subscription.expires_at > CURRENT_TIMESTAMP
                 FOR UPDATE OF subscription, balance`,
                [subscriptionId, salonId, serviceId]
            );
            const active = entitlement.rows[0];
            if (!active) throw new ApiError(409, 'Active package or included service was not found');
            if (active.maxUses !== null && active.usedCount >= active.maxUses) {
                throw new ApiError(409, 'Package service usage limit is exhausted');
            }
            if (toMinorUnits(active.servicePrice) > toMinorUnits(active.remainingValue)) {
                throw new ApiError(409, 'Package has insufficient remaining credit for this service');
            }
            await this.assertPaidServiceBill(client, salonId, active.customerAccountId, billId, serviceId);
            const update = await client.query(
                `UPDATE customer_package_service_balances
                 SET used_count = used_count + 1
                 WHERE subscription_id = $1 AND salon_id = $2 AND service_id = $3
                   AND (max_uses IS NULL OR used_count < max_uses)`,
                [subscriptionId, salonId, serviceId]
            );
            if (update.rowCount !== 1) throw new ApiError(409, 'Package service usage limit is exhausted');
            const creditUpdate = await client.query(
                `UPDATE customer_package_subscriptions
                 SET remaining_value = remaining_value - $2
                 WHERE id = $1 AND salon_id = $3 AND remaining_value >= $2`,
                [subscriptionId, active.servicePrice, salonId]
            );
            if (creditUpdate.rowCount !== 1) {
                throw new ApiError(409, 'Package has insufficient remaining credit for this service');
            }
            await client.query(
                `UPDATE customer_package_subscriptions AS subscription
                 SET status = 'EXHAUSTED'
                 WHERE subscription.id = $1 AND subscription.salon_id = $2
                   AND (
                     subscription.remaining_value = 0
                     OR NOT EXISTS (
                       SELECT 1
                       FROM customer_package_service_balances AS balance
                       WHERE balance.subscription_id = subscription.id
                         AND balance.salon_id = subscription.salon_id
                         AND (balance.max_uses IS NULL OR balance.used_count < balance.max_uses)
                     )
                   )`,
                [subscriptionId, salonId]
            );
            const created = await client.query<OfferLedgerEntry>(
                `INSERT INTO salon_offer_ledger (
                    salon_id, customer_account_id, purchase_request_id, entry_type,
                    amount, service_id, bill_id, idempotency_key, metadata
                 ) VALUES ($1, $2, $3, 'PACKAGE_REDEMPTION', -$4, $5, $6, $7, $8::jsonb)
                 RETURNING id, purchase_request_id AS "purchaseRequestId", entry_type AS "entryType",
                           amount::text AS amount, service_id AS "serviceId", bill_id AS "billId",
                           metadata, created_at AS "createdAt"`,
                [
                    salonId, active.customerAccountId, active.requestId, active.servicePrice,
                    serviceId, billId, idempotencyKey,
                    JSON.stringify({
                        serviceName: active.serviceName,
                        currentServicePrice: active.servicePrice,
                        entitlementId: subscriptionId,
                        remainingCreditAfter: fromMinorUnits(
                            toMinorUnits(active.remainingValue) - toMinorUnits(active.servicePrice)
                        ),
                    }),
                ]
            );
            await this.writeAudit(
                client, accountId, salonId, 'PACKAGE_SERVICE_REDEEMED',
                active.requestId, { serviceId, billId, amount: active.servicePrice }
            );
            await client.query('COMMIT');
            return created.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async redeemCombo(
        salonId: string,
        comboPurchaseId: string,
        accountId: string,
        serviceIds: string[],
        billId: string,
        idempotencyKey: string
    ) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await this.lockIdempotencyKey(client, salonId, idempotencyKey);
            const prior = await this.findLedgerByIdempotency(client, salonId, idempotencyKey);
            if (prior) {
                if (
                    prior.entryType !== 'COMBO_REDEMPTION' ||
                    prior.metadata.comboPurchaseId !== comboPurchaseId
                ) {
                    throw new ApiError(409, 'Idempotency key belongs to another offer transaction');
                }
                await client.query('COMMIT');
                return prior;
            }
            const combo = await client.query<{
                requestId: string;
                customerAccountId: string;
                status: string;
                expiresAt: Date;
                servicesSnapshot: OfferServiceSnapshot[];
            }>(
                `SELECT purchase.purchase_request_id AS "requestId",
                        purchase.customer_account_id AS "customerAccountId",
                        purchase.status, purchase.expires_at AS "expiresAt",
                        request.services_snapshot AS "servicesSnapshot"
                 FROM customer_combo_purchases AS purchase
                 JOIN salon_offer_purchase_requests AS request
                   ON request.id = purchase.purchase_request_id
                  AND request.salon_id = purchase.salon_id
                 WHERE purchase.id = $1 AND purchase.salon_id = $2
                   AND purchase.payment_status = 'PAID'
                   AND purchase.status = 'ACTIVE'
                   AND purchase.expires_at > CURRENT_TIMESTAMP
                 FOR UPDATE OF purchase`,
                [comboPurchaseId, salonId]
            );
            const active = combo.rows[0];
            if (!active) throw new ApiError(409, 'Active combo purchase was not found');
            const expected = active.servicesSnapshot.map(({ serviceId }) => serviceId).sort();
            const actual = [...serviceIds].sort();
            if (
                expected.length !== actual.length ||
                expected.some((serviceId, index) => serviceId !== actual[index])
            ) {
                throw new ApiError(409, 'Every combo service must be redeemed together in one visit');
            }
            await this.assertPaidServiceBill(client, salonId, active.customerAccountId, billId, serviceIds);
            const update = await client.query(
                `UPDATE customer_combo_purchases
                 SET status = 'USED'
                 WHERE id = $1 AND salon_id = $2 AND status = 'ACTIVE'
                 RETURNING id`,
                [comboPurchaseId, salonId]
            );
            if (!update.rows[0]) throw new ApiError(409, 'Combo was already redeemed');
            const inserted = await client.query<OfferLedgerEntry>(
                `INSERT INTO salon_offer_ledger (
                    salon_id, customer_account_id, purchase_request_id, entry_type,
                    amount, bill_id, idempotency_key, metadata
                 ) VALUES ($1, $2, $3, 'COMBO_REDEMPTION', 0, $4, $5, $6::jsonb)
                 RETURNING id, purchase_request_id AS "purchaseRequestId", entry_type AS "entryType",
                           amount::text AS amount, service_id AS "serviceId", bill_id AS "billId",
                           metadata, created_at AS "createdAt"`,
                [
                    salonId, active.customerAccountId, active.requestId, billId,
                    idempotencyKey, JSON.stringify({
                        serviceIds: expected,
                        comboPurchaseId,
                    }),
                ]
            );
            await this.writeAudit(
                client, accountId, salonId, 'COMBO_REDEEMED',
                active.requestId, { serviceIds: expected, billId }
            );
            await client.query('COMMIT');
            return inserted.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async listLedger(
        salonId: string,
        customerAccountId: string,
        limit: number,
        offset: number
    ) {
        const result = await db.query<OfferLedgerEntry>(
            `SELECT id, purchase_request_id AS "purchaseRequestId", entry_type AS "entryType",
                    amount::text AS amount, service_id AS "serviceId", bill_id AS "billId",
                    metadata, created_at AS "createdAt"
             FROM salon_offer_ledger
             WHERE salon_id = $1 AND customer_account_id = $2
             ORDER BY created_at DESC, id
             LIMIT $3 OFFSET $4`,
            [salonId, customerAccountId, limit, offset]
        );
        return result.rows;
    }

    private async insertPurchaseRequest(
        client: PoolClient,
        customerAccountId: string,
        salonId: string,
        type: OfferType,
        offer: OfferRow,
        paymentMode: string | null,
        isManualAssignment: boolean,
        actorAccountId: string,
        override?: {
            finalAmount: string;
            discountReason?: string;
            idempotencyKey: string;
            status: 'BILLING';
        }
    ) {
        const discountAmount = override
            ? fromMinorUnits(toMinorUnits(offer.sellingPrice) - toMinorUnits(override.finalAmount))
            : '0.00';
        const created = await client.query<{ id: string }>(
            `INSERT INTO salon_offer_purchase_requests (
                salon_id, customer_account_id, offer_type, package_id, combo_id,
                package_revision_id, combo_revision_id, status, payment_mode,
                list_price, final_amount, discount_amount, discount_reason,
                terms_snapshot, services_snapshot, is_manual_assignment,
                created_by_account_id, idempotency_key
             ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                $14::jsonb, $15::jsonb, $16, $17, $18
             ) RETURNING id`,
            [
                salonId, customerAccountId, type,
                type === 'PACKAGE' ? offer.id : null,
                type === 'COMBO' ? offer.id : null,
                type === 'PACKAGE' ? offer.revisionId : null,
                type === 'COMBO' ? offer.revisionId : null,
                override?.status ?? 'PENDING',
                paymentMode,
                offer.sellingPrice,
                override?.finalAmount ?? offer.sellingPrice,
                discountAmount,
                override?.discountReason ?? null,
                JSON.stringify({
                    id: offer.id,
                    type,
                    revisionNumber: offer.revisionNumber,
                    name: offer.name,
                    description: offer.description,
                    sellingPrice: offer.sellingPrice,
                    creditAmount: offer.creditAmount,
                    validityDays: offer.validityDays,
                }),
                JSON.stringify(offer.services),
                isManualAssignment,
                actorAccountId,
                override?.idempotencyKey ?? null,
            ]
        );
        await this.writeAudit(
            client, actorAccountId, salonId,
            isManualAssignment ? 'OFFER_MANUAL_SALE_CREATED' : 'OFFER_PURCHASE_REQUESTED',
            created.rows[0].id,
            { offerId: offer.id, offerType: type, isManualAssignment }
        );
        const saved = await this.getPurchaseRequestWithClient(client, salonId, created.rows[0].id);
        if (!saved) throw new ApiError(500, 'Offer purchase request could not be loaded');
        return saved;
    }

    private async getOfferingWithClient(
        client: PoolClient,
        salonId: string,
        offerId: string,
        type: OfferType,
        publicOnly = false
    ) {
        const result = type === 'PACKAGE'
            ? await client.query<OfferRow>(
                `SELECT ${OFFER_COLUMNS}
                 FROM salon_packages AS package
                 JOIN salon_package_revisions AS revision
                   ON revision.id = package.current_revision_id AND revision.salon_id = package.salon_id
                 WHERE package.id = $1 AND package.salon_id = $2
                   AND ($3::boolean = FALSE OR revision.status = 'LISTED')
                   AND ($3::boolean = FALSE OR EXISTS (
                       SELECT 1 FROM salons AS salon
                       JOIN salon_applications AS application ON application.salon_id = salon.id
                       WHERE salon.id = package.salon_id
                         AND salon.status = 'ACTIVE' AND salon.deleted_at IS NULL
                         AND application.status = 'APPROVED'
                   ))
                 FOR SHARE OF package, revision`,
                [offerId, salonId, publicOnly]
            )
            : await client.query<OfferRow>(
                `SELECT ${COMBO_COLUMNS}
                 FROM salon_service_combos AS combo
                 JOIN salon_combo_revisions AS revision
                   ON revision.id = combo.current_revision_id AND revision.salon_id = combo.salon_id
                 WHERE combo.id = $1 AND combo.salon_id = $2
                   AND ($3::boolean = FALSE OR revision.status = 'LISTED')
                   AND ($3::boolean = FALSE OR EXISTS (
                       SELECT 1 FROM salons AS salon
                       JOIN salon_applications AS application ON application.salon_id = salon.id
                       WHERE salon.id = combo.salon_id
                         AND salon.status = 'ACTIVE' AND salon.deleted_at IS NULL
                         AND application.status = 'APPROVED'
                   ))
                 FOR SHARE OF combo, revision`,
                [offerId, salonId, publicOnly]
            );
        return result.rows[0] ?? null;
    }

    private async getPurchaseRequestWithClient(client: PoolClient, salonId: string, requestId: string) {
        const result = await client.query<RequestRow>(
            `SELECT request.id, request.salon_id AS "salonId",
                    request.customer_account_id AS "customerAccountId",
                    request.offer_type AS "offerType",
                    COALESCE(request.package_id, request.combo_id) AS "offeringId",
                    request.status, request.payment_mode AS "paymentMode",
                    request.list_price::text AS "listPrice",
                    request.final_amount::text AS "finalAmount",
                    request.discount_amount::text AS "discountAmount",
                    request.discount_reason AS "discountReason",
                    request.terms_snapshot AS "termsSnapshot",
                    request.services_snapshot AS "servicesSnapshot",
                    request.is_manual_assignment AS "isManualAssignment",
                    request.bill_id AS "billId",
                    request.rejection_reason AS "rejectionReason",
                    request.created_at AS "createdAt",
                    request.accepted_at AS "acceptedAt"
             FROM salon_offer_purchase_requests AS request
             WHERE request.id = $1 AND request.salon_id = $2`,
            [requestId, salonId]
        );
        return result.rows[0] ? this.mapRequest(result.rows[0]) : null;
    }

    private async getCustomerPurchaseWithClient(
        client: PoolClient,
        request: OfferPurchaseRequestResponse
    ) {
        const result = await client.query<{
            entitlementId: string;
            remainingCredit: string | null;
            status: string;
            expiresAt: Date | null;
        }>(
            `SELECT CASE WHEN request.offer_type = 'PACKAGE'
                    THEN subscription.id ELSE combo_purchase.id END AS "entitlementId",
                    CASE WHEN request.offer_type = 'PACKAGE'
                    THEN subscription.remaining_value::text ELSE NULL END AS "remainingCredit",
                    CASE
                        WHEN request.offer_type = 'PACKAGE' AND subscription.expires_at <= CURRENT_TIMESTAMP
                            THEN 'EXPIRED'
                        WHEN request.offer_type = 'COMBO' AND combo_purchase.expires_at <= CURRENT_TIMESTAMP
                            THEN 'EXPIRED'
                        WHEN request.offer_type = 'PACKAGE' THEN subscription.status
                        ELSE combo_purchase.status
                    END AS status,
                    CASE WHEN request.offer_type = 'PACKAGE'
                    THEN subscription.expires_at ELSE combo_purchase.expires_at END AS "expiresAt"
             FROM salon_offer_purchase_requests AS request
             LEFT JOIN customer_package_subscriptions AS subscription
               ON subscription.purchase_request_id = request.id
              AND subscription.salon_id = request.salon_id
             LEFT JOIN customer_combo_purchases AS combo_purchase
               ON combo_purchase.purchase_request_id = request.id
              AND combo_purchase.salon_id = request.salon_id
             WHERE request.id = $1`,
            [request.id]
        );
        const purchase = result.rows[0];
        return {
            request,
            entitlementId: purchase?.entitlementId ?? null,
            remainingCredit: purchase?.remainingCredit ?? null,
            status: purchase?.status ?? request.status,
            expiresAt: purchase?.expiresAt ?? null,
        };
    }

    private mapRequest(row: RequestRow): OfferPurchaseRequestResponse {
        return {
            id: row.id,
            salonId: row.salonId,
            customerAccountId: row.customerAccountId,
            offerType: row.offerType,
            offeringId: row.offeringId,
            status: row.status,
            paymentMode: row.paymentMode,
            listPrice: row.listPrice,
            finalAmount: row.finalAmount,
            discountAmount: row.discountAmount,
            discountReason: row.discountReason,
            termsSnapshot: row.termsSnapshot,
            servicesSnapshot: row.servicesSnapshot,
            isManualAssignment: row.isManualAssignment,
            billId: row.billId,
            rejectionReason: row.rejectionReason,
            createdAt: row.createdAt,
            acceptedAt: row.acceptedAt,
        };
    }

    private async insertPackageRevision(
        client: PoolClient,
        packageId: string,
        salonId: string,
        accountId: string,
        revisionNumber: number,
        data: CreatePackageRequest
    ) {
        const result = await client.query<{ id: string }>(
            `INSERT INTO salon_package_revisions (
                package_id, salon_id, revision_number, name, description, selling_price,
                credit_amount, validity_days, status, created_by_account_id
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING id`,
            [
                packageId, salonId, revisionNumber, data.name, data.description ?? null,
                data.sellingPrice, data.creditAmount, data.validityDays, data.status, accountId,
            ]
        );
        return result.rows[0].id;
    }

    private async insertPackageRevisionServices(
        client: PoolClient,
        revisionId: string,
        salonId: string,
        services: Array<{
            id: string;
            name: string;
            basePrice: string;
            estimatedDurationMinutes: number;
        }>,
        definitions: CreatePackageRequest['services']
    ) {
        const maxUses = new Map(definitions.map(({ serviceId, maxUses: uses }) => [serviceId, uses ?? null]));
        for (const service of services) {
            await client.query(
                `INSERT INTO salon_package_revision_services (
                    revision_id, salon_id, service_id, service_name,
                    service_price_at_revision, estimated_duration_minutes, max_uses
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    revisionId, salonId, service.id, service.name, service.basePrice,
                    service.estimatedDurationMinutes, maxUses.get(service.id) ?? null,
                ]
            );
        }
    }

    private async insertComboRevision(
        client: PoolClient,
        comboId: string,
        salonId: string,
        accountId: string,
        revisionNumber: number,
        data: CreateComboRequest
    ) {
        const result = await client.query<{ id: string }>(
            `INSERT INTO salon_combo_revisions (
                combo_id, salon_id, revision_number, name, description, selling_price,
                validity_days, status, created_by_account_id
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id`,
            [
                comboId, salonId, revisionNumber, data.name, data.description ?? null,
                data.sellingPrice, data.validityDays, data.status, accountId,
            ]
        );
        return result.rows[0].id;
    }

    private async insertComboRevisionServices(
        client: PoolClient,
        revisionId: string,
        salonId: string,
        services: Array<{
            id: string;
            name: string;
            basePrice: string;
            estimatedDurationMinutes: number;
        }>
    ) {
        for (const service of services) {
            await client.query(
                `INSERT INTO salon_combo_revision_services (
                    revision_id, salon_id, service_id, service_name,
                    service_price_at_revision, estimated_duration_minutes
                 ) VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    revisionId, salonId, service.id, service.name, service.basePrice,
                    service.estimatedDurationMinutes,
                ]
            );
        }
    }

    private async loadActiveServices(
        client: PoolClient,
        salonId: string,
        serviceIds: string[]
    ) {
        const result = await client.query<{
            id: string;
            name: string;
            basePrice: string;
            estimatedDurationMinutes: number;
        }>(
            `SELECT id, name, base_price::text AS "basePrice",
                    estimated_duration_minutes AS "estimatedDurationMinutes"
             FROM salon_services
             WHERE salon_id = $1 AND id = ANY($2::uuid[])
               AND is_active = TRUE AND deleted_at IS NULL
             ORDER BY id`,
            [salonId, serviceIds]
        );
        if (result.rows.length !== serviceIds.length) {
            throw new ApiError(400, 'Every offer service must be active in this salon');
        }
        return result.rows;
    }

    private async assertApprovedSalon(client: PoolClient, salonId: string) {
        const salon = await client.query(
            `SELECT 1 FROM salons AS salon
             JOIN salon_applications AS application ON application.salon_id = salon.id
             WHERE salon.id = $1 AND salon.status = 'ACTIVE'
               AND salon.deleted_at IS NULL AND application.status = 'APPROVED'
             FOR SHARE OF salon`,
            [salonId]
        );
        if (!salon.rows[0]) throw new ApiError(404, 'Approved salon was not found');
    }

    private async assertCustomer(client: PoolClient, customerAccountId: string) {
        const customer = await client.query(
            `SELECT 1 FROM accounts AS account
             JOIN customer_profiles AS profile ON profile.account_id = account.id
             WHERE account.id = $1 AND account.account_type = 'CUSTOMER'
               AND account.status = 'ACTIVE' AND account.deleted_at IS NULL
             FOR SHARE OF account`,
            [customerAccountId]
        );
        if (!customer.rows[0]) throw new ApiError(403, 'An active customer account is required');
    }

    private async assertPaidServiceBill(
        client: PoolClient,
        salonId: string,
        customerAccountId: string,
        billId: string,
        serviceIds: string | string[]
    ) {
        const ids = Array.isArray(serviceIds) ? serviceIds : [serviceIds];
        const bill = await client.query(
            `SELECT bill.id
             FROM pos_bills AS bill
             JOIN pos_billing_sessions AS session
               ON session.id = bill.session_id AND session.salon_id = bill.salon_id
             WHERE bill.id = $1 AND bill.salon_id = $2
               AND session.customer_account_id = $3
               AND bill.status = 'CLOSED' AND session.status = 'PAID'
               AND NOT EXISTS (
                   SELECT 1
                   FROM unnest($4::uuid[]) AS requested(service_id)
                   WHERE NOT EXISTS (
                       SELECT 1 FROM pos_bill_items AS item
                       WHERE item.bill_id = bill.id AND item.salon_id = bill.salon_id
                         AND item.service_id = requested.service_id
                   )
               )
             FOR SHARE OF bill, session`,
            [billId, salonId, customerAccountId, ids]
        );
        if (!bill.rows[0]) {
            throw new ApiError(409, 'A closed, paid POS bill containing the redeemed services is required');
        }
    }

    private async findLedgerByIdempotency(client: PoolClient, salonId: string, key: string) {
        const result = await client.query<OfferLedgerEntry>(
            `SELECT id, purchase_request_id AS "purchaseRequestId", entry_type AS "entryType",
                    amount::text AS amount, service_id AS "serviceId", bill_id AS "billId",
                    metadata, created_at AS "createdAt"
             FROM salon_offer_ledger
             WHERE salon_id = $1 AND idempotency_key = $2`,
            [salonId, key]
        );
        return result.rows[0] ?? null;
    }

    private async enqueueActivationNotifications(
        client: PoolClient,
        customerAccountId: string,
        salonId: string,
        request: RequestRow,
        billId: string,
        invoiceNumber: string
    ) {
        const title = `${request.termsSnapshot.name} is ready`;
        const message = `Your ${request.offerType.toLowerCase()} purchase is confirmed. Invoice: ${invoiceNumber}.`;
        await client.query(
            `INSERT INTO account_notifications (
                account_id, salon_id, title, body, channel, priority, status, metadata
             ) VALUES
                ($1, $2, $3, $4, 'IN_APP', 'NORMAL', 'PENDING', $5::jsonb),
                ($1, $2, $3, $4, 'PUSH', 'NORMAL', 'PENDING', $5::jsonb)`,
            [
                customerAccountId,
                salonId,
                title,
                message,
                JSON.stringify({
                    event: 'OFFER_PURCHASE_ACTIVATED',
                    purchaseRequestId: request.id,
                    billId,
                    invoiceNumber,
                    finalAmount: request.finalAmount,
                    discountAmount: request.discountAmount,
                    fallbackOrder: ['EMAIL', 'WHATSAPP', 'SMS'],
                    whatsappRequires: ['activePlanFeatureOrAddon'],
                }),
            ]
        );
    }

    private async lockIdempotencyKey(client: PoolClient, scope: string, key: string) {
        await client.query(
            'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
            [scope, key]
        );
    }

    private async writeAudit(
        client: PoolClient,
        actorAccountId: string,
        salonId: string,
        action: string,
        resourceId: string,
        changes: Record<string, unknown>
    ) {
        await client.query(
            `INSERT INTO audit_logs (
                actor_account_id, actor_context, salon_id, action,
                resource_type, resource_id, changes
             )
             SELECT account.id, account.account_type::text, $2, $3,
                    'SALON_OFFER', $4, $5::jsonb
             FROM accounts AS account
             WHERE account.id = $1`,
            [actorAccountId, salonId, action, resourceId, JSON.stringify(changes)]
        );
    }
}
