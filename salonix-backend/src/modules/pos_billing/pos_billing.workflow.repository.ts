import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { db } from '../../config/database.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import { LoyaltyRepository } from '../loyalty/loyalty.repository.js';
import type {
    CreatePaymentClaimRequest,
    CreateAdvanceClaimRequest,
    CreatePosSessionRequest,
    AllocateAdvanceRequest,
    PosBillLineRequest,
    PosSaleOrigin,
    PosTenderMode,
    RecordPosPaymentRequest,
    ReviewPaymentClaimRequest,
    CreatePosWalletRedemptionRequest,
    ReviewPosWalletRedemptionRequest,
    PosBillCategoryOverrideRequest,
    PosCategorySettingRequest,
    PosTaxCategory,
    CreatePosRefundRequest,
    ReviewPosRefundRequest,
} from './pos_billing.types.js';

interface BillRow extends QueryResultRow {
    id: string;
    sessionId: string;
    salonId: string;
    customerAccountId: string;
    invoiceNumber: string;
    workflowStatus: string;
    currentVersion: number;
    subtotal: string;
    discountAmount: string;
    serviceTaxAmount: string;
    productTaxAmount: string;
    offerTaxAmount: string;
    totalAmount: string;
    paidAmount: string;
    offerPurchaseRequestId: string | null;
    confirmedAt: Date | null;
    refundWindowDays: number;
}

interface PricedLine {
    itemType: string;
    serviceId: string | null;
    productId: string | null;
    packageId: string | null;
    comboId: string | null;
    offerPurchaseRequestId: string | null;
    parentBillItemId: string | null;
    description: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    discountType: string | null;
    discountValue: number | null;
    discountAmount: number;
    taxCategory: string;
    taxInclusive: boolean;
    taxOverrideReason: string | null;
    taxRate: number;
    taxAmount: number;
    staffMembershipId: string | null;
    sortOrder: number;
    batchAllocations: Array<{
        batchId: string;
        quantity: number;
        expiredOverrideReason: string | null;
    }>;
}

interface Totals {
    subtotal: number;
    discountAmount: number;
    serviceTaxAmount: number;
    productTaxAmount: number;
    offerTaxAmount: number;
    totalAmount: number;
}

interface WalletAllocation {
    type: 'PACKAGE' | 'COMBO' | 'LOYALTY';
    amount: number;
    entitlementId?: string;
    billItemId?: string;
    serviceId?: string;
}

interface WalletRedemptionRow {
    id: string;
    billId: string;
    billVersionId: string;
    customerAccountId: string;
    allocation: WalletAllocation[];
    status: string;
    expiresAt: Date;
}

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export class PosBillingWorkflowRepository {
    private readonly loyalty = new LoyaltyRepository();

    async createSession(salonId: string, actorAccountId: string, input: CreatePosSessionRequest) {
        return this.withTransaction(async (client) => {
            const customer = await client.query(
                `SELECT account.id
                 FROM accounts AS account
                 JOIN customer_profiles AS customer ON customer.account_id = account.id
                 WHERE account.id = $1 AND account.account_type = 'CUSTOMER'
                   AND account.status = 'ACTIVE' AND account.deleted_at IS NULL
                 FOR SHARE OF account`,
                [input.customerAccountId]
            );
            if (!customer.rowCount) throw new ApiError(404, 'Active customer was not found');

            if (input.origin === 'QUEUE' && !input.queueEntryId && !input.bookingId) {
                throw new ApiError(400, 'Queue sessions require a queue entry or booking');
            }
            if (input.origin !== 'QUEUE' && (input.queueEntryId || input.bookingId)) {
                throw new ApiError(400, 'Walk-in and offline sessions cannot link a queue or booking');
            }
            if (input.bookingId) {
                const booking = await client.query(
                    `SELECT id FROM customer_bookings
                     WHERE id = $1 AND salon_id = $2 AND customer_account_id = $3
                     FOR SHARE`,
                    [input.bookingId, salonId, input.customerAccountId]
                );
                if (!booking.rowCount) throw new ApiError(404, 'Customer booking was not found');
            }
            if (input.queueEntryId) {
                const queueEntry = await client.query(
                    `SELECT id FROM queue_entries
                     WHERE id = $1 AND salon_id = $2 AND customer_account_id = $3
                       AND status NOT IN ('COMPLETED', 'CANCELLED')
                     FOR SHARE`,
                    [input.queueEntryId, salonId, input.customerAccountId]
                );
                if (!queueEntry.rowCount) throw new ApiError(404, 'Active customer queue entry was not found');
            }

            const result = await client.query<{ id: string }>(
                `INSERT INTO pos_billing_sessions (
                    salon_id, customer_account_id, booking_id, queue_entry_id, origin
                 ) VALUES ($1, $2, $3, $4, $5)
                 RETURNING id`,
                [
                    salonId,
                    input.customerAccountId,
                    input.bookingId ?? null,
                    input.queueEntryId ?? null,
                    input.origin,
                ]
            );
            return {
                id: result.rows[0].id,
                salonId,
                customerAccountId: input.customerAccountId,
                origin: input.origin,
                createdByAccountId: actorAccountId,
            };
        });
    }

    async createBill(
        salonId: string,
        sessionId: string,
        actorAccountId: string,
        lines: PosBillLineRequest[]
    ) {
        return this.withTransaction(async (client) => {
            const session = await this.lockSession(client, salonId, sessionId);
            if (session.status !== 'OPEN') throw new ApiError(409, 'Only open POS sessions can receive bills');
            const existing = await client.query(
                `SELECT id FROM pos_bills WHERE session_id = $1 AND salon_id = $2
                 AND status <> 'CANCELLED' LIMIT 1`,
                [sessionId, salonId]
            );
            if (existing.rowCount) {
                throw new ApiError(409, 'This POS session already has a bill; edit it or create another session');
            }

            const billId = randomUUID();
            const priced = await this.priceLines(client, salonId, session.customerAccountId, billId, lines);
            const totals = this.calculateTotals(priced);
            const offerRequestId = this.singleOfferRequestId(priced);
            const billType = this.billType(priced);
            const created = await client.query<{ id: string }>(
                `INSERT INTO pos_bills (
                    id, session_id, salon_id, invoice_number, bill_type,
                    offer_purchase_request_id, subtotal, discount_amount,
                    service_tax_amount, product_tax_amount, offer_tax_amount,
                    total_amount, status, workflow_status
                 ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'OPEN', 'DRAFT'
                 ) RETURNING id`,
                [
                    billId,
                    sessionId,
                    salonId,
                    `DRAFT-${billId}`,
                    billType,
                    offerRequestId,
                    totals.subtotal,
                    totals.discountAmount,
                    totals.serviceTaxAmount,
                    totals.productTaxAmount,
                    totals.offerTaxAmount,
                    totals.totalAmount,
                ]
            );
            await this.insertLines(client, billId, salonId, priced);
            await this.attachOfferRequest(client, salonId, session.customerAccountId, billId, offerRequestId);
            await this.addBillEvent(
                client, billId, salonId, 'CREATED', actorAccountId,
                { origin: session.origin, itemCount: priced.length }
            );
            await client.query(
                `UPDATE pos_billing_sessions SET session_total = $3 WHERE id = $1 AND salon_id = $2`,
                [sessionId, salonId, totals.totalAmount]
            );
            return this.getBill(client, salonId, created.rows[0].id);
        });
    }

    async updateBill(
        salonId: string,
        billId: string,
        actorAccountId: string,
        lines: PosBillLineRequest[]
    ) {
        return this.withTransaction(async (client) => {
            const bill = await this.lockBill(client, salonId, billId);
            if (!['DRAFT', 'ISSUED'].includes(bill.workflowStatus)) {
                throw new ApiError(409, 'A confirmed or cancelled invoice cannot be edited');
            }

            const priced = await this.priceLines(
                client, salonId, bill.customerAccountId, billId, lines
            );
            const offerRequestId = this.singleOfferRequestId(priced);
            if (
                bill.offerPurchaseRequestId &&
                bill.offerPurchaseRequestId !== offerRequestId
            ) {
                throw new ApiError(409, 'An offer linked to this bill cannot be removed or replaced');
            }

            await client.query(
                `UPDATE pos_bill_items
                 SET removed_at = CURRENT_TIMESTAMP, removed_by_account_id = $3
                 WHERE bill_id = $1 AND salon_id = $2 AND removed_at IS NULL`,
                [billId, salonId, actorAccountId]
            );
            await this.insertLines(client, billId, salonId, priced);
            await this.attachOfferRequest(
                client, salonId, bill.customerAccountId, billId, offerRequestId
            );
            const totals = this.calculateTotals(priced);
            await client.query(
                `UPDATE pos_bill_versions
                 SET status = 'SUPERSEDED'
                 WHERE bill_id = $1 AND salon_id = $2 AND status = 'CURRENT'`,
                [billId, salonId]
            );
            await client.query(
                `UPDATE pos_payment_claims
                 SET status = 'STALE',
                     reason = 'Invoice items changed after this payment claim was submitted',
                     reviewed_at = CURRENT_TIMESTAMP
                 WHERE bill_id = $1 AND salon_id = $2 AND status = 'PENDING'`,
                [billId, salonId]
            );
            await client.query(
                `UPDATE pos_bills SET
                    invoice_number = $3, bill_type = $4, subtotal = $5,
                    discount_amount = $6, service_tax_amount = $7,
                    product_tax_amount = $8, offer_tax_amount = $9,
                    total_amount = $10, workflow_status = 'DRAFT',
                    offer_purchase_request_id = COALESCE(offer_purchase_request_id, $11)
                 WHERE id = $1 AND salon_id = $2`,
                [
                    billId,
                    salonId,
                    `DRAFT-${randomUUID()}`,
                    this.billType(priced),
                    totals.subtotal,
                    totals.discountAmount,
                    totals.serviceTaxAmount,
                    totals.productTaxAmount,
                    totals.offerTaxAmount,
                    totals.totalAmount,
                    offerRequestId,
                ]
            );
            await this.addBillEvent(
                client, billId, salonId, 'EDITED', actorAccountId,
                { itemCount: priced.length, totalAmount: totals.totalAmount }
            );
            await client.query(
                `UPDATE pos_billing_sessions SET session_total = $3
                 WHERE id = $1 AND salon_id = $2`,
                [bill.sessionId, salonId, totals.totalAmount]
            );
            return this.getBill(client, salonId, billId);
        });
    }

    async issueBillVersion(
        salonId: string,
        billId: string,
        actorAccountId: string,
        customerMessage?: string
    ) {
        return this.withTransaction(async (client) => {
            const bill = await this.lockBill(client, salonId, billId);
            if (!['DRAFT', 'ISSUED'].includes(bill.workflowStatus)) {
                throw new ApiError(409, 'Only editable invoices can be issued');
            }
            const items = await client.query(
                `SELECT id, item_type AS "itemType", service_id AS "serviceId",
                        product_id AS "productId", package_id AS "packageId",
                        combo_id AS "comboId", description, quantity::text AS quantity,
                        unit_price::text AS "unitPrice", subtotal::text AS subtotal,
                        discount_type AS "discountType", discount_value::text AS "discountValue",
                        discount_amount::text AS "discountAmount", tax_category AS "taxCategory",
                        tax_inclusive AS "taxInclusive", tax_rate::text AS "taxRate",
                        tax_amount::text AS "taxAmount", staff_membership_id AS "staffMembershipId",
                        sort_order AS "sortOrder"
                 FROM pos_bill_items
                 WHERE bill_id = $1 AND salon_id = $2 AND removed_at IS NULL
                 ORDER BY sort_order, created_at`,
                [billId, salonId]
            );
            if (!items.rowCount) throw new ApiError(400, 'A bill must contain at least one active item');
            const versionResult = await client.query<{ version: number }>(
                `SELECT COALESCE(MAX(version_number), 0) + 1 AS version
                 FROM pos_bill_versions WHERE bill_id = $1 AND salon_id = $2`,
                [billId, salonId]
            );
            const version = versionResult.rows[0].version;
            const versionId = randomUUID();
            const invoiceNumber = `SAL-${randomUUID()}`;
            const snapshot = {
                billId,
                salonId,
                invoiceNumber,
                invoiceType: 'PRO_FORMA',
                version,
                customerMessage: customerMessage ?? null,
                totals: {
                    subtotal: Number(bill.subtotal),
                    discountAmount: Number(bill.discountAmount),
                    serviceTaxAmount: Number(bill.serviceTaxAmount),
                    productTaxAmount: Number(bill.productTaxAmount),
                    offerTaxAmount: Number(bill.offerTaxAmount),
                    totalAmount: Number(bill.totalAmount),
                },
                items: items.rows,
            };
            await client.query(
                `UPDATE pos_bill_versions SET status = 'SUPERSEDED'
                 WHERE bill_id = $1 AND salon_id = $2 AND status = 'CURRENT'`,
                [billId, salonId]
            );
            await client.query(
                `INSERT INTO pos_bill_versions (
                    id, bill_id, salon_id, version_number, status,
                    invoice_number, snapshot, created_by_account_id
                 ) VALUES ($1, $2, $3, $4, 'CURRENT', $5, $6::jsonb, $7)`,
                [versionId, billId, salonId, version, invoiceNumber, JSON.stringify(snapshot), actorAccountId]
            );
            await client.query(
                `UPDATE pos_bills SET workflow_status = 'ISSUED',
                    current_version = $3, invoice_number = $4
                 WHERE id = $1 AND salon_id = $2`,
                [billId, salonId, version, invoiceNumber]
            );
            await this.addBillEvent(
                client, billId, salonId, 'VERSION_ISSUED', actorAccountId,
                { versionId, version, invoiceNumber, customerMessage: customerMessage ?? null }
            );
            await this.addInvoiceNotification(client, bill, versionId, invoiceNumber, snapshot);
            return { id: versionId, billId, version, invoiceNumber, status: 'CURRENT', snapshot };
        });
    }

    async confirmBill(salonId: string, billId: string, versionId: string, actorAccountId: string) {
        return this.withTransaction(async (client) => {
            const bill = await this.lockBill(client, salonId, billId);
            if (bill.workflowStatus !== 'ISSUED') {
                throw new ApiError(409, 'The invoice must be issued before salon confirmation');
            }
            const version = await client.query<{ id: string; versionNumber: number; status: string }>(
                `SELECT id, version_number AS "versionNumber", status
                 FROM pos_bill_versions WHERE id = $1 AND bill_id = $2 AND salon_id = $3
                 FOR UPDATE`,
                [versionId, billId, salonId]
            );
            const current = version.rows[0];
            if (!current || current.status !== 'CURRENT' || current.versionNumber !== bill.currentVersion) {
                throw new ApiError(409, 'Only the latest invoice version can be confirmed');
            }

            const lines = await client.query<{
                id: string;
                itemType: string;
                serviceId: string | null;
                productId: string | null;
                quantity: string;
            }>(
                `SELECT id, item_type AS "itemType", service_id AS "serviceId",
                        product_id AS "productId", quantity::text AS quantity
                 FROM pos_bill_items
                 WHERE bill_id = $1 AND salon_id = $2 AND removed_at IS NULL
                 FOR UPDATE`,
                [billId, salonId]
            );
            for (const item of lines.rows) {
                if (item.itemType === 'PRODUCT' && item.productId) {
                    await this.decrementRetailBatchAllocations(
                        client,
                        salonId,
                        billId,
                        item.id,
                        item.productId,
                        Number(item.quantity),
                        actorAccountId
                    );
                }
                if (item.itemType === 'SERVICE' && item.serviceId) {
                    const materials = await client.query<{
                        productId: string;
                        quantityRequired: string;
                        quantityUnit: string;
                    }>(
                        `SELECT mapping.product_id AS "productId",
                                mapping.quantity_required::text AS "quantityRequired",
                                COALESCE(product.content_unit, product.base_unit) AS "quantityUnit"
                         FROM salon_service_consumables AS mapping
                         JOIN salon_products AS product
                           ON product.id = mapping.product_id AND product.salon_id = mapping.salon_id
                         WHERE mapping.salon_id = $1 AND mapping.service_id = $2
                           AND product.inventory_type IN ('SALON_USE', 'LEGACY_UNCLASSIFIED')
                         FOR SHARE`,
                        [salonId, item.serviceId]
                    );
                    for (const material of materials.rows) {
                        const estimate = roundMoney(
                            Number(material.quantityRequired) * Number(item.quantity)
                        );
                        await client.query(
                            `INSERT INTO salon_service_consumable_usage (
                                salon_id, service_id, product_id, bill_id, bill_item_id,
                                estimated_quantity, quantity_unit, recorded_by_account_id
                             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                             ON CONFLICT (bill_item_id, product_id) DO NOTHING`,
                            [
                                salonId, item.serviceId, material.productId, billId,
                                item.id, estimate, material.quantityUnit, actorAccountId,
                            ]
                        );
                    }
                }
            }
            await client.query(
                `UPDATE pos_bill_versions SET status = 'CONFIRMED'
                 WHERE id = $1 AND salon_id = $2`,
                [versionId, salonId]
            );
            await client.query(
                `UPDATE pos_bills SET workflow_status = 'CONFIRMED',
                    confirmed_by_account_id = $3, confirmed_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND salon_id = $2`,
                [billId, salonId, actorAccountId]
            );
            const finalSnapshot = await client.query(
                `UPDATE pos_bill_versions
                 SET snapshot = jsonb_set(snapshot, '{invoiceType}', '"FINAL"'::jsonb)
                 WHERE id = $1 AND salon_id = $2
                 RETURNING snapshot`,
                [versionId, salonId]
            );
            await this.addBillEvent(
                client, billId, salonId, 'CONFIRMED', actorAccountId,
                { versionId, version: bill.currentVersion }
            );
            await this.addInvoiceNotification(
                client, bill, versionId, bill.invoiceNumber, finalSnapshot.rows[0].snapshot
            );
            return this.getBill(client, salonId, billId);
        });
    }

    async recordPayment(
        salonId: string,
        billId: string,
        actorAccountId: string,
        input: RecordPosPaymentRequest
    ) {
        return this.withTransaction(async (client) => {
            const bill = await this.lockBill(client, salonId, billId);
            if (bill.workflowStatus !== 'CONFIRMED') {
                throw new ApiError(409, 'The salon must confirm the invoice before payment can be recorded');
            }
            const replay = await this.getIdempotentPayment(client, salonId, input.idempotencyKey);
            if (replay) {
                this.assertSamePayment(replay, billId, input.paymentMode, input.amount);
                return this.getBill(client, salonId, billId);
            }
            const remaining = roundMoney(Number(bill.totalAmount) - Number(bill.paidAmount));
            if (input.amount > remaining) throw new ApiError(400, 'Payment exceeds the outstanding bill balance');
            const payment = await client.query<{ id: string }>(
                `INSERT INTO pos_payments (
                    session_id, salon_id, bill_id, payment_mode, source_type,
                    amount, transaction_reference, status, recorded_by_account_id,
                    approved_by_account_id, idempotency_key
                 ) VALUES ($1, $2, $3, $4, 'SALON_RECORDED', $5, $6, 'SUCCESS', $7, $7, $8)
                 RETURNING id`,
                [
                    bill.sessionId, salonId, billId, input.paymentMode, input.amount,
                    input.transactionReference ?? null, actorAccountId, input.idempotencyKey,
                ]
            );
            await client.query(
                `INSERT INTO pos_payment_events (
                    payment_id, salon_id, event_type, actor_account_id, metadata
                 ) VALUES ($1, $2, 'RECORDED', $3, $4::jsonb)`,
                [
                    payment.rows[0].id, salonId, actorAccountId,
                    JSON.stringify({ paymentMode: input.paymentMode, amount: input.amount }),
                ]
            );
            await this.addBillEvent(
                client, billId, salonId, 'PAYMENT_RECORDED', actorAccountId,
                { paymentId: payment.rows[0].id, paymentMode: input.paymentMode, amount: input.amount }
            );
            await this.refreshPaymentStatus(client, salonId, billId, bill.sessionId);
            return this.getBill(client, salonId, billId);
        });
    }

    async createPaymentClaim(
        salonId: string,
        customerAccountId: string,
        actorAccountId: string,
        input: CreatePaymentClaimRequest
    ) {
        return this.withTransaction(async (client) => {
            const bill = await this.lockBill(client, salonId, input.billId);
            if (bill.customerAccountId !== customerAccountId) {
                throw new ApiError(404, 'Bill was not found for this customer');
            }
            const version = await client.query<{ id: string; status: string }>(
                `SELECT id, status FROM pos_bill_versions
                 WHERE id = $1 AND bill_id = $2 AND salon_id = $3`,
                [input.billVersionId, input.billId, salonId]
            );
            if (!version.rowCount || version.rows[0].status !== 'CURRENT') {
                throw new ApiError(409, 'Payment claims must refer to the current invoice version');
            }
            const old = await client.query<{
                id: string;
                amount: string;
                paymentMode: string;
                billId: string | null;
                billVersionId: string | null;
                customerAccountId: string;
                status: string;
            }>(
                `SELECT id, amount::text AS amount, payment_mode AS "paymentMode",
                        bill_id AS "billId", bill_version_id AS "billVersionId",
                        customer_account_id AS "customerAccountId", status
                 FROM pos_payment_claims
                 WHERE salon_id = $1 AND idempotency_key = $2`,
                [salonId, input.idempotencyKey]
            );
            if (old.rowCount) {
                const prior = old.rows[0];
                if (
                    Number(prior.amount) !== input.amount ||
                    prior.paymentMode !== input.paymentMode ||
                    prior.billId !== input.billId ||
                    prior.billVersionId !== input.billVersionId ||
                    prior.customerAccountId !== customerAccountId
                ) throw new ApiError(409, 'Idempotency key was used for a different payment claim');
                return { id: prior.id, status: prior.status };
            }
            const outstanding = roundMoney(Number(bill.totalAmount) - Number(bill.paidAmount));
            if (input.amount > outstanding) throw new ApiError(400, 'Claim exceeds the outstanding bill balance');
            const created = await client.query<{ id: string }>(
                `INSERT INTO pos_payment_claims (
                    salon_id, customer_account_id, bill_id, bill_version_id,
                    claim_type, payment_mode, amount, transaction_reference,
                    created_by_account_id, idempotency_key
                 ) VALUES ($1, $2, $3, $4, 'BILL_PAYMENT', $5, $6, $7, $8, $9)
                 RETURNING id`,
                [
                    salonId, customerAccountId, input.billId, input.billVersionId,
                    input.paymentMode, input.amount, input.transactionReference ?? null,
                    actorAccountId, input.idempotencyKey,
                ]
            );
            return { id: created.rows[0].id, status: 'PENDING' };
        });
    }

    async createAdvanceClaim(
        salonId: string,
        customerAccountId: string,
        actorAccountId: string,
        input: CreateAdvanceClaimRequest
    ) {
        return this.withTransaction(async (client) => {
            const customer = await client.query(
                `SELECT account.id
                 FROM accounts AS account
                 JOIN customer_profiles AS profile ON profile.account_id = account.id
                 WHERE account.id = $1 AND account.account_type = 'CUSTOMER'
                   AND account.status = 'ACTIVE' AND account.deleted_at IS NULL`,
                [customerAccountId]
            );
            if (!customer.rowCount) throw new ApiError(404, 'Active customer was not found');
            const existing = await client.query<{
                id: string;
                amount: string;
                paymentMode: string;
                customerAccountId: string;
                status: string;
            }>(
                `SELECT id, amount::text AS amount, payment_mode AS "paymentMode",
                        customer_account_id AS "customerAccountId", status
                 FROM pos_payment_claims
                 WHERE salon_id = $1 AND idempotency_key = $2`,
                [salonId, input.idempotencyKey]
            );
            if (existing.rows[0]) {
                const prior = existing.rows[0];
                if (
                    prior.customerAccountId !== customerAccountId ||
                    prior.paymentMode !== input.paymentMode ||
                    Number(prior.amount) !== input.amount
                ) throw new ApiError(409, 'Idempotency key was used for a different advance claim');
                return { id: prior.id, status: prior.status };
            }
            const created = await client.query<{ id: string }>(
                `INSERT INTO pos_payment_claims (
                    salon_id, customer_account_id, claim_type, payment_mode,
                    amount, transaction_reference, created_by_account_id, idempotency_key
                 ) VALUES ($1, $2, 'ADVANCE', $3, $4, $5, $6, $7)
                 RETURNING id`,
                [
                    salonId, customerAccountId, input.paymentMode, input.amount,
                    input.transactionReference ?? null, actorAccountId, input.idempotencyKey,
                ]
            );
            return { id: created.rows[0].id, status: 'PENDING' };
        });
    }

    async allocateAdvance(
        salonId: string,
        billId: string,
        actorAccountId: string,
        input: AllocateAdvanceRequest
    ) {
        return this.withTransaction(async (client) => {
            const bill = await this.lockBill(client, salonId, billId);
            if (bill.workflowStatus !== 'CONFIRMED') {
                throw new ApiError(409, 'Only confirmed invoices can use a customer advance');
            }
            const replay = await client.query<{
                id: string;
                amount: string;
                advanceEntryId: string;
                billId: string;
            }>(
                `SELECT id, amount::text AS amount,
                        advance_entry_id AS "advanceEntryId", bill_id AS "billId"
                 FROM pos_advance_allocations
                 WHERE salon_id = $1 AND idempotency_key = $2`,
                [salonId, input.idempotencyKey]
            );
            if (replay.rows[0]) {
                if (
                    Number(replay.rows[0].amount) !== input.amount ||
                    replay.rows[0].advanceEntryId !== input.advanceEntryId ||
                    replay.rows[0].billId !== billId
                ) {
                    throw new ApiError(409, 'Idempotency key was used for a different advance allocation');
                }
                return this.getBill(client, salonId, billId);
            }
            const advance = await client.query<{
                customerAccountId: string;
                remainingAmount: string;
                status: string;
            }>(
                `SELECT customer_account_id AS "customerAccountId",
                        remaining_amount::text AS "remainingAmount", status
                 FROM pos_customer_advance_entries
                 WHERE id = $1 AND salon_id = $2
                 FOR UPDATE`,
                [input.advanceEntryId, salonId]
            );
            const entry = advance.rows[0];
            if (!entry || entry.customerAccountId !== bill.customerAccountId) {
                throw new ApiError(404, 'Available customer advance was not found');
            }
            if (entry.status === 'REVERSED' || Number(entry.remainingAmount) < input.amount) {
                throw new ApiError(409, 'Advance balance is insufficient');
            }
            const outstanding = roundMoney(Number(bill.totalAmount) - Number(bill.paidAmount));
            if (input.amount > outstanding) throw new ApiError(400, 'Advance allocation exceeds the bill balance');
            await client.query(
                `INSERT INTO pos_advance_allocations (
                    salon_id, advance_entry_id, bill_id, amount,
                    idempotency_key, allocated_by_account_id
                 ) VALUES ($1, $2, $3, $4, $5, $6)`,
                [salonId, input.advanceEntryId, billId, input.amount, input.idempotencyKey, actorAccountId]
            );
            const remaining = roundMoney(Number(entry.remainingAmount) - input.amount);
            await client.query(
                `UPDATE pos_customer_advance_entries SET remaining_amount = $3,
                    status = $4 WHERE id = $1 AND salon_id = $2`,
                [
                    input.advanceEntryId, salonId, remaining,
                    remaining === 0 ? 'ALLOCATED' : 'PARTIALLY_ALLOCATED',
                ]
            );
            const payment = await client.query<{ id: string }>(
                `INSERT INTO pos_payments (
                    session_id, salon_id, bill_id, payment_mode, source_type, amount,
                    status, recorded_by_account_id, approved_by_account_id, idempotency_key
                 ) VALUES ($1, $2, $3, 'CREDIT', 'ADVANCE', $4, 'SUCCESS', $5, $5, $6)
                 RETURNING id`,
                [bill.sessionId, salonId, billId, input.amount, actorAccountId, `advance:${input.idempotencyKey}`]
            );
            await client.query(
                `INSERT INTO pos_payment_events (
                    payment_id, salon_id, event_type, actor_account_id, metadata
                 ) VALUES ($1, $2, 'RECORDED', $3, $4::jsonb)`,
                [
                    payment.rows[0].id, salonId, actorAccountId,
                    JSON.stringify({ advanceEntryId: input.advanceEntryId, amount: input.amount }),
                ]
            );
            await this.refreshPaymentStatus(client, salonId, billId, bill.sessionId);
            return this.getBill(client, salonId, billId);
        });
    }

    async createWalletRedemption(
        salonId: string,
        customerAccountId: string,
        input: CreatePosWalletRedemptionRequest
    ) {
        return this.withTransaction(async (client) => {
            await client.query(
                `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
                [`${customerAccountId}:${salonId}:pos-wallet`]
            );
            const bill = await this.lockBill(client, salonId, input.billId);
            if (
                bill.customerAccountId !== customerAccountId ||
                bill.workflowStatus !== 'CONFIRMED' ||
                bill.currentVersion < 1
            ) {
                throw new ApiError(409, 'A confirmed bill for this customer is required');
            }
            const version = await client.query<{ id: string; status: string }>(
                `SELECT id, status FROM pos_bill_versions
                 WHERE id = $1 AND bill_id = $2 AND salon_id = $3
                   AND version_number = $4`,
                [input.versionId, input.billId, salonId, bill.currentVersion]
            );
            if (!version.rowCount || version.rows[0].status !== 'CONFIRMED') {
                throw new ApiError(409, 'Wallet redemption requires the current confirmed invoice');
            }

            const resolved: Array<Record<string, unknown> & {
                type: 'PACKAGE' | 'COMBO' | 'LOYALTY';
                amount: number;
                entitlementId?: string;
                billItemId?: string;
                serviceId?: string;
            }> = [];
            const usedBillItems = new Set<string>();
            for (const allocation of input.allocations) {
                if (allocation.type === 'LOYALTY') {
                    const billCategories = await client.query<{ category: string }>(
                        `SELECT DISTINCT tax_category AS category
                         FROM pos_bill_items
                         WHERE bill_id = $1 AND salon_id = $2 AND removed_at IS NULL`,
                        [input.billId, salonId]
                    );
                    for (const row of billCategories.rows) {
                        const categorySetting = await this.getEffectiveCategorySetting(
                            client, salonId, input.billId, row.category
                        );
                        if (!categorySetting.allowLoyalty) {
                            throw new ApiError(403, `Loyalty payments are disabled for ${row.category.toLowerCase()} items`);
                        }
                    }
                    if (allocation.amount <= 0) {
                        throw new ApiError(400, 'Loyalty allocation must be greater than zero');
                    }
                    resolved.push({ type: 'LOYALTY', amount: roundMoney(allocation.amount) });
                    continue;
                }

                if (!allocation.billItemId || !allocation.entitlementId) {
                    throw new ApiError(400, 'Package and combo redemption requires a bill item and entitlement');
                }
                if (usedBillItems.has(allocation.billItemId)) {
                    throw new ApiError(400, 'A service line cannot be covered more than once');
                }
                usedBillItems.add(allocation.billItemId);
                const lineResult = await client.query<{
                    itemType: string;
                    serviceId: string | null;
                    quantity: string;
                    unitPrice: string;
                }>(
                    `SELECT item_type AS "itemType", service_id AS "serviceId",
                            quantity::text AS quantity, unit_price::text AS "unitPrice"
                     FROM pos_bill_items
                     WHERE id = $1 AND bill_id = $2 AND salon_id = $3
                       AND removed_at IS NULL
                     FOR UPDATE`,
                    [allocation.billItemId, input.billId, salonId]
                );
                const line = lineResult.rows[0];
                if (!line || line.itemType !== 'SERVICE' || !line.serviceId || Number(line.quantity) !== 1) {
                    throw new ApiError(400, 'Package and combo credits can only cover one service per bill line');
                }
                if (allocation.serviceId && allocation.serviceId !== line.serviceId) {
                    throw new ApiError(400, 'Requested service does not match the bill line');
                }
                const categorySettings = await this.getEffectiveCategorySetting(
                    client, salonId, input.billId, 'SERVICE'
                );
                if (allocation.type === 'PACKAGE' && !categorySettings.allowPackage) {
                    throw new ApiError(403, 'Package payments are disabled for services at this salon');
                }
                if (allocation.type === 'COMBO' && !categorySettings.allowCombo) {
                    throw new ApiError(403, 'Combo payments are disabled for services at this salon');
                }

                const service = await client.query<{ currentPrice: string }>(
                    `SELECT base_price::text AS "currentPrice"
                     FROM salon_services
                     WHERE id = $1 AND salon_id = $2 AND is_active = TRUE
                       AND deleted_at IS NULL`,
                    [line.serviceId, salonId]
                );
                if (!service.rows[0]) throw new ApiError(404, 'Active salon service was not found');
                const currentPrice = roundMoney(Number(line.unitPrice));
                if (Math.abs(Number(service.rows[0].currentPrice) - currentPrice) >= 0.01) {
                    throw new ApiError(409, 'Service price changed; issue a new invoice before wallet redemption');
                }
                if (allocation.type === 'PACKAGE') {
                    const subscription = await client.query<{
                        remainingValue: string;
                        maxUses: number | null;
                        usedCount: number;
                    }>(
                        `SELECT subscription.remaining_value::text AS "remainingValue",
                                balance.max_uses AS "maxUses", balance.used_count AS "usedCount"
                         FROM customer_package_subscriptions AS subscription
                         JOIN customer_package_service_balances AS balance
                           ON balance.subscription_id = subscription.id
                          AND balance.salon_id = subscription.salon_id
                          AND balance.service_id = $3
                         WHERE subscription.id = $1 AND subscription.salon_id = $2
                           AND subscription.customer_account_id = $4
                           AND subscription.status = 'ACTIVE'
                           AND subscription.payment_status = 'PAID'
                           AND subscription.expires_at > CURRENT_TIMESTAMP
                         FOR SHARE OF subscription, balance`,
                        [allocation.entitlementId, salonId, line.serviceId, customerAccountId]
                    );
                    const active = subscription.rows[0];
                    if (!active || Number(active.remainingValue) < currentPrice) {
                        throw new ApiError(409, 'Package credit is unavailable for this service');
                    }
                    if (active.maxUses !== null && active.usedCount >= active.maxUses) {
                        throw new ApiError(409, 'Package use limit is exhausted for this service');
                    }
                    const reserved = await client.query<{ amount: string }>(
                        `SELECT COALESCE(SUM((item.value->>'amount')::numeric), 0)::text AS amount
                         FROM pos_wallet_redemptions AS redemption
                         CROSS JOIN LATERAL jsonb_array_elements(redemption.allocation) AS item(value)
                         WHERE redemption.salon_id = $1
                           AND redemption.status IN ('OTP_PENDING', 'OTP_VERIFIED')
                           AND redemption.expires_at > CURRENT_TIMESTAMP
                           AND redemption.idempotency_key <> $3
                           AND item.value->>'type' = 'PACKAGE'
                           AND item.value->>'entitlementId' = $2`,
                        [salonId, allocation.entitlementId, input.idempotencyKey]
                    );
                    if (Number(active.remainingValue) - Number(reserved.rows[0].amount) < currentPrice) {
                        throw new ApiError(409, 'Package credit is already reserved by another redemption');
                    }
                } else {
                    const combo = await client.query<{
                        servicesSnapshot: Array<{ serviceId: string }>;
                    }>(
                        `SELECT request.services_snapshot AS "servicesSnapshot"
                         FROM customer_combo_purchases AS purchase
                         JOIN salon_offer_purchase_requests AS request
                           ON request.id = purchase.purchase_request_id
                          AND request.salon_id = purchase.salon_id
                         WHERE purchase.id = $1 AND purchase.salon_id = $2
                           AND purchase.customer_account_id = $3
                           AND purchase.payment_status = 'PAID'
                           AND purchase.status = 'ACTIVE'
                           AND purchase.expires_at > CURRENT_TIMESTAMP
                         FOR SHARE OF purchase`,
                        [allocation.entitlementId, salonId, customerAccountId]
                    );
                    if (!combo.rows[0]?.servicesSnapshot.some(({ serviceId }) => serviceId === line.serviceId)) {
                        throw new ApiError(409, 'Active combo does not include this service');
                    }
                    const reserved = await client.query<{ count: string }>(
                        `SELECT COUNT(*)::text AS count
                         FROM pos_wallet_redemptions AS redemption
                         CROSS JOIN LATERAL jsonb_array_elements(redemption.allocation) AS item(value)
                         WHERE redemption.salon_id = $1
                           AND redemption.status IN ('OTP_PENDING', 'OTP_VERIFIED')
                           AND redemption.expires_at > CURRENT_TIMESTAMP
                           AND redemption.idempotency_key <> $3
                           AND item.value->>'type' = 'COMBO'
                           AND item.value->>'entitlementId' = $2`,
                        [salonId, allocation.entitlementId, input.idempotencyKey]
                    );
                    if (Number(reserved.rows[0].count) > 0) {
                        throw new ApiError(409, 'Combo is already reserved by another redemption');
                    }
                }
                resolved.push({
                    type: allocation.type,
                    entitlementId: allocation.entitlementId,
                    billItemId: allocation.billItemId,
                    serviceId: line.serviceId,
                    amount: currentPrice,
                });
            }

            const loyaltyAmount = roundMoney(resolved
                .filter((allocation) => allocation.type === 'LOYALTY')
                .reduce((sum, allocation) => sum + allocation.amount, 0));
            if (loyaltyAmount > 0) {
                const reserved = await client.query<{ amount: string }>(
                    `SELECT COALESCE(SUM((item.value->>'amount')::numeric), 0)::text AS amount
                     FROM pos_wallet_redemptions AS redemption
                     CROSS JOIN LATERAL jsonb_array_elements(redemption.allocation) AS item(value)
                     WHERE redemption.customer_account_id = $1 AND redemption.salon_id = $2
                       AND redemption.status IN ('OTP_PENDING', 'OTP_VERIFIED')
                       AND redemption.expires_at > CURRENT_TIMESTAMP
                       AND redemption.idempotency_key <> $3
                       AND item.value->>'type' = 'LOYALTY'`,
                    [customerAccountId, salonId, input.idempotencyKey]
                );
                const availableValue = await this.loyalty.getAvailableRedemptionValue(
                    client,
                    customerAccountId,
                    salonId
                );
                if (availableValue - Number(reserved.rows[0].amount) < loyaltyAmount) {
                    throw new ApiError(409, 'Loyalty point balance is insufficient or reserved');
                }
            }
            const total = roundMoney(resolved.reduce((sum, item) => sum + item.amount, 0));
            const outstanding = roundMoney(Number(bill.totalAmount) - Number(bill.paidAmount));
            if (total <= 0 || total > outstanding) {
                throw new ApiError(400, 'Wallet allocation must be positive and cannot exceed the bill balance');
            }
            for (const allocation of resolved.filter((item) => item.type === 'COMBO')) {
                const comboAllocations = resolved.filter((item) =>
                    item.type === 'COMBO' && item.entitlementId === allocation.entitlementId
                );
                const expected = await client.query<{ servicesSnapshot: Array<{ serviceId: string }> }>(
                    `SELECT request.services_snapshot AS "servicesSnapshot"
                     FROM customer_combo_purchases AS purchase
                     JOIN salon_offer_purchase_requests AS request
                       ON request.id = purchase.purchase_request_id
                      AND request.salon_id = purchase.salon_id
                     WHERE purchase.id = $1 AND purchase.salon_id = $2`,
                    [allocation.entitlementId, salonId]
                );
                const expectedIds = (expected.rows[0]?.servicesSnapshot ?? [])
                    .map(({ serviceId }) => serviceId).sort();
                const actualIds = comboAllocations
                    .map((item) => item.serviceId as string).sort();
                if (
                    expectedIds.length !== actualIds.length ||
                    expectedIds.some((serviceId, index) => serviceId !== actualIds[index])
                ) {
                    throw new ApiError(409, 'Every service in a combo must be redeemed together');
                }
            }
            const authorizationHash = createHash('sha256').update(JSON.stringify({
                billId: input.billId,
                versionId: input.versionId,
                allocations: resolved,
            })).digest('hex');
            const existing = await client.query<{
                id: string;
                authorizationHash: string;
                status: string;
                expiresAt: Date;
            }>(
                `SELECT id, authorization_hash AS "authorizationHash", status,
                        expires_at AS "expiresAt"
                 FROM pos_wallet_redemptions
                 WHERE salon_id = $1 AND idempotency_key = $2`,
                [salonId, input.idempotencyKey]
            );
            if (existing.rows[0]) {
                if (existing.rows[0].authorizationHash !== authorizationHash) {
                    throw new ApiError(409, 'Idempotency key was used for another wallet redemption');
                }
                return {
                    id: existing.rows[0].id,
                    status: existing.rows[0].status,
                    expiresAt: existing.rows[0].expiresAt,
                };
            }
            const inserted = await client.query<{ id: string; expiresAt: Date }>(
                `INSERT INTO pos_wallet_redemptions (
                    salon_id, bill_id, bill_version_id, customer_account_id,
                    allocation, authorization_hash, status, expires_at, idempotency_key
                 ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'OTP_PENDING',
                           CURRENT_TIMESTAMP + INTERVAL '5 minutes', $7)
                 RETURNING id, expires_at AS "expiresAt"`,
                [
                    salonId, input.billId, input.versionId, customerAccountId,
                    JSON.stringify(resolved), authorizationHash, input.idempotencyKey,
                ]
            );
            return { id: inserted.rows[0].id, status: 'OTP_PENDING', expiresAt: inserted.rows[0].expiresAt };
        });
    }

    async verifyWalletRedemption(
        salonId: string,
        customerAccountId: string,
        redemptionId: string
    ) {
        return this.withTransaction(async (client) => {
            const redemption = await client.query<{
                id: string;
                billId: string;
                billVersionId: string;
                status: string;
                expiresAt: Date;
            }>(
                `SELECT id, bill_id AS "billId", bill_version_id AS "billVersionId",
                        status, expires_at AS "expiresAt"
                 FROM pos_wallet_redemptions
                 WHERE id = $1 AND salon_id = $2 AND customer_account_id = $3
                 FOR UPDATE`,
                [redemptionId, salonId, customerAccountId]
            );
            const row = redemption.rows[0];
            if (!row) throw new ApiError(404, 'Wallet redemption was not found');
            if (row.status === 'OTP_VERIFIED') return { id: row.id, status: row.status };
            if (row.status !== 'OTP_PENDING' || row.expiresAt <= new Date()) {
                throw new ApiError(409, 'Wallet redemption OTP has expired or is no longer valid');
            }
            const bill = await this.lockBill(client, salonId, row.billId);
            const version = await client.query(
                `SELECT id FROM pos_bill_versions
                 WHERE id = $1 AND bill_id = $2 AND salon_id = $3
                   AND version_number = $4 AND status = 'CONFIRMED'`,
                [row.billVersionId, row.billId, salonId, bill.currentVersion]
            );
            if (!version.rowCount || bill.workflowStatus !== 'CONFIRMED') {
                throw new ApiError(409, 'Invoice changed after this wallet redemption was requested');
            }
            await client.query(
                `UPDATE pos_wallet_redemptions SET status = 'OTP_VERIFIED', verified_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND salon_id = $2`,
                [redemptionId, salonId]
            );
            return { id: redemptionId, status: 'OTP_VERIFIED' };
        });
    }

    async failWalletOtpDelivery(
        salonId: string,
        customerAccountId: string,
        redemptionId: string
    ) {
        return this.withTransaction(async (client) => {
            await client.query(
                `UPDATE pos_wallet_redemptions
                 SET status = 'RELEASED', otp_hash = NULL
                 WHERE id = $1 AND salon_id = $2 AND customer_account_id = $3
                   AND status = 'OTP_PENDING'`,
                [redemptionId, salonId, customerAccountId]
            );
        });
    }

    async reviewWalletRedemption(
        salonId: string,
        redemptionId: string,
        actorAccountId: string,
        input: ReviewPosWalletRedemptionRequest
    ) {
        return this.withTransaction(async (client) => {
            const result = await client.query<{
                id: string;
                billId: string;
                billVersionId: string;
                customerAccountId: string;
                allocation: WalletAllocation[];
                status: string;
                expiresAt: Date;
            }>(
                `SELECT id, bill_id AS "billId", bill_version_id AS "billVersionId",
                        customer_account_id AS "customerAccountId", allocation,
                        status, expires_at AS "expiresAt"
                 FROM pos_wallet_redemptions
                 WHERE id = $1 AND salon_id = $2 FOR UPDATE`,
                [redemptionId, salonId]
            );
            const redemption = result.rows[0];
            if (!redemption) throw new ApiError(404, 'Wallet redemption was not found');
            if (redemption.status === input.status) {
                return { id: redemptionId, status: redemption.status, billId: redemption.billId };
            }
            if (input.status === 'REJECTED') {
                if (!['OTP_PENDING', 'OTP_VERIFIED'].includes(redemption.status)) {
                    throw new ApiError(409, 'This wallet redemption cannot be rejected');
                }
                await client.query(
                    `UPDATE pos_wallet_redemptions SET status = 'REJECTED',
                        review_reason = $3, reviewed_by_account_id = $4
                     WHERE id = $1 AND salon_id = $2`,
                    [redemptionId, salonId, input.reason, actorAccountId]
                );
                return { id: redemptionId, status: 'REJECTED', billId: redemption.billId };
            }
            if (redemption.status !== 'OTP_VERIFIED' || redemption.expiresAt <= new Date()) {
                throw new ApiError(409, 'Customer OTP verification is required before wallet approval');
            }
            const bill = await this.lockBill(client, salonId, redemption.billId);
            const version = await client.query<{ status: string }>(
                `SELECT status FROM pos_bill_versions
                 WHERE id = $1 AND bill_id = $2 AND salon_id = $3
                   AND version_number = $4`,
                [redemption.billVersionId, redemption.billId, salonId, bill.currentVersion]
            );
            if (bill.workflowStatus !== 'CONFIRMED' || version.rows[0]?.status !== 'CONFIRMED') {
                throw new ApiError(409, 'Wallet redemption belongs to a superseded invoice');
            }
            const total = roundMoney(redemption.allocation.reduce((sum, item) => sum + item.amount, 0));
            const outstanding = roundMoney(Number(bill.totalAmount) - Number(bill.paidAmount));
            if (total > outstanding) throw new ApiError(409, 'Wallet redemption exceeds the current bill balance');

            const processedCombos = new Set<string>();
            for (const [index, allocation] of redemption.allocation.entries()) {
                if (allocation.type === 'PACKAGE') {
                    await this.redeemPackageAllocation(
                        client, salonId, redemption, allocation, actorAccountId, index
                    );
                } else if (allocation.type === 'COMBO') {
                    const entitlementId = allocation.entitlementId;
                    if (!entitlementId || processedCombos.has(entitlementId)) continue;
                    processedCombos.add(entitlementId);
                    await this.redeemComboAllocations(
                        client,
                        salonId,
                        redemption,
                        redemption.allocation.filter((item) =>
                            item.type === 'COMBO' && item.entitlementId === entitlementId
                        ),
                        actorAccountId,
                        index
                    );
                } else {
                    await this.redeemLoyaltyAllocation(
                        client, salonId, redemption, allocation.amount, actorAccountId, index
                    );
                }
            }
            await client.query(
                `UPDATE pos_wallet_redemptions SET status = 'APPROVED',
                    review_reason = $3, reviewed_by_account_id = $4,
                    approved_by_account_id = $4
                 WHERE id = $1 AND salon_id = $2`,
                [redemptionId, salonId, input.reason ?? null, actorAccountId]
            );
            await this.addBillEvent(
                client,
                redemption.billId,
                salonId,
                'WALLET_APPROVED',
                actorAccountId,
                { redemptionId, amount: total, allocation: redemption.allocation }
            );
            await this.refreshPaymentStatus(client, salonId, redemption.billId, bill.sessionId);
            return { id: redemptionId, status: 'APPROVED', billId: redemption.billId };
        });
    }

    async reviewPaymentClaim(
        salonId: string,
        claimId: string,
        actorAccountId: string,
        input: ReviewPaymentClaimRequest
    ) {
        return this.withTransaction(async (client) => {
            const result = await client.query<{
                id: string;
                customerAccountId: string;
                billId: string | null;
                billVersionId: string | null;
                claimType: string;
                paymentMode: PosTenderMode;
                amount: string;
                transactionReference: string | null;
                status: string;
            }>(
                `SELECT claim.id, claim.customer_account_id AS "customerAccountId",
                        claim.bill_id AS "billId", claim.bill_version_id AS "billVersionId",
                        claim.claim_type AS "claimType", claim.payment_mode AS "paymentMode",
                        claim.amount::text AS amount,
                        claim.transaction_reference AS "transactionReference",
                        claim.status
                 FROM pos_payment_claims AS claim
                 LEFT JOIN pos_bills AS bill
                   ON bill.id = claim.bill_id AND bill.salon_id = claim.salon_id
                 WHERE claim.id = $1 AND claim.salon_id = $2
                 FOR UPDATE OF claim`,
                [claimId, salonId]
            );
            const claim = result.rows[0];
            if (!claim) throw new ApiError(404, 'Payment claim was not found');
            if (claim.status === input.status) {
                return { id: claimId, status: claim.status, billId: claim.billId };
            }
            if (input.status === 'REJECTED') {
                if (claim.status !== 'PENDING') {
                    throw new ApiError(409, 'This payment claim cannot be rejected');
                }
                await client.query(
                    `UPDATE pos_payment_claims
                     SET status = 'REJECTED', reason = $3, reviewed_by_account_id = $4,
                         reviewed_at = CURRENT_TIMESTAMP
                     WHERE id = $1 AND salon_id = $2`,
                    [claimId, salonId, input.reason, actorAccountId]
                );
                await this.addClaimEvent(client, claimId, salonId, 'REJECTED', actorAccountId, input.reason);
                return { id: claimId, status: 'REJECTED' };
            }
            if (!['PENDING', 'REJECTED'].includes(claim.status)) {
                throw new ApiError(409, 'Only pending or rejected payment claims can be approved');
            }
            if (claim.claimType === 'ADVANCE') {
                return this.approveAdvanceClaim(client, salonId, claim, actorAccountId);
            }
            if (!claim.billId || !claim.billVersionId) {
                throw new ApiError(409, 'Payment claim is missing its invoice reference');
            }
            const lockedBill = await this.lockBill(client, salonId, claim.billId);
            const version = await client.query<{ id: string; status: string }>(
                `SELECT id, status FROM pos_bill_versions
                 WHERE id = $1 AND bill_id = $2 AND salon_id = $3 AND version_number = $4`,
                [claim.billVersionId, claim.billId, salonId, lockedBill.currentVersion]
            );
            if (lockedBill.workflowStatus !== 'CONFIRMED' || version.rows[0]?.status !== 'CONFIRMED') {
                throw new ApiError(409, 'Payment claim belongs to an unconfirmed or superseded invoice');
            }
            const remaining = roundMoney(Number(lockedBill.totalAmount) - Number(lockedBill.paidAmount));
            if (Number(claim.amount) > remaining) {
                throw new ApiError(409, 'Payment claim exceeds the remaining bill balance');
            }
            const payment = await client.query<{ id: string }>(
                `INSERT INTO pos_payments (
                    session_id, salon_id, bill_id, payment_mode, source_type,
                    amount, transaction_reference, status, recorded_by_account_id,
                    approved_by_account_id, idempotency_key
                 ) VALUES (
                    $1, $2, $3, $4, 'CUSTOMER_CLAIM', $5, $6, 'SUCCESS', $7, $7, $8
                 ) RETURNING id`,
                [
                    lockedBill.sessionId, salonId, claim.billId, claim.paymentMode,
                    claim.amount, claim.transactionReference, actorAccountId, `claim:${claimId}`,
                ]
            );
            await client.query(
                `UPDATE pos_payment_claims
                 SET status = 'APPROVED', reviewed_by_account_id = $3,
                     reviewed_at = CURRENT_TIMESTAMP, reason = $4
                 WHERE id = $1 AND salon_id = $2`,
                [claimId, salonId, actorAccountId, input.reason ?? null]
            );
            await this.addClaimEvent(
                client,
                claimId,
                salonId,
                claim.status === 'REJECTED' ? 'REAPPROVED' : 'APPROVED',
                actorAccountId,
                input.reason
            );
            await this.addBillEvent(
                client,
                claim.billId,
                salonId,
                'PAYMENT_APPROVED',
                actorAccountId,
                { claimId, paymentId: payment.rows[0].id, amount: Number(claim.amount) }
            );
            await client.query(
                `INSERT INTO pos_payment_events (
                    payment_id, salon_id, event_type, actor_account_id, reason, metadata
                 ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
                [
                    payment.rows[0].id, salonId,
                    claim.status === 'REJECTED' ? 'REAPPROVED' : 'APPROVED',
                    actorAccountId, input.reason ?? null, JSON.stringify({ claimId }),
                ]
            );
            await this.refreshPaymentStatus(client, salonId, claim.billId, lockedBill.sessionId);
            return { id: claimId, paymentId: payment.rows[0].id, status: 'APPROVED', billId: claim.billId };
        });
    }

    async listPaymentClaims(salonId: string, limit: number, offset: number) {
        const result = await db.query(
            `SELECT id, customer_account_id AS "customerAccountId", bill_id AS "billId",
                    claim_type AS "claimType", payment_mode AS "paymentMode",
                    amount::text AS amount, transaction_reference AS "transactionReference",
                    status, reason, created_at AS "createdAt", reviewed_at AS "reviewedAt"
             FROM pos_payment_claims
             WHERE salon_id = $1
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3`,
            [salonId, limit, offset]
        );
        return result.rows;
    }

    async getBillById(salonId: string, billId: string) {
        return this.withTransaction((client) => this.getBill(client, salonId, billId));
    }

    async getCustomerBillById(salonId: string, customerAccountId: string, billId: string) {
        const result = await db.query(
            `SELECT 1
             FROM pos_bills AS bill
             JOIN pos_billing_sessions AS session
               ON session.id = bill.session_id AND session.salon_id = bill.salon_id
             WHERE bill.id = $1 AND bill.salon_id = $2
               AND session.customer_account_id = $3
               AND bill.workflow_status IN ('ISSUED', 'CONFIRMED')`,
            [billId, salonId, customerAccountId]
        );
        if (!result.rowCount) return null;
        return this.getBillById(salonId, billId);
    }

    async listCustomerBills(
        salonId: string,
        customerAccountId: string,
        limit: number,
        offset: number
    ) {
        const result = await db.query(
            `SELECT bill.id, bill.session_id AS "sessionId",
                    bill.invoice_number AS "invoiceNumber",
                    bill.workflow_status AS "workflowStatus",
                    bill.current_version AS "currentVersion",
                    bill.subtotal::text AS subtotal,
                    bill.discount_amount::text AS "discountAmount",
                    bill.total_amount::text AS "totalAmount",
                    bill.created_at AS "createdAt"
             FROM pos_bills AS bill
             JOIN pos_billing_sessions AS session
               ON session.id = bill.session_id AND session.salon_id = bill.salon_id
             WHERE bill.salon_id = $1 AND session.customer_account_id = $2
               AND bill.workflow_status IN ('ISSUED', 'CONFIRMED')
             ORDER BY bill.created_at DESC
             LIMIT $3 OFFSET $4`,
            [salonId, customerAccountId, limit, offset]
        );
        return result.rows;
    }

    async listBills(salonId: string, limit: number, offset: number) {
        const result = await db.query(
            `SELECT bill.id, bill.session_id AS "sessionId", bill.invoice_number AS "invoiceNumber",
                    bill.workflow_status AS "workflowStatus", bill.current_version AS "currentVersion",
                    bill.total_amount::text AS "totalAmount", bill.status,
                    bill.created_at AS "createdAt",
                    session.customer_account_id AS "customerAccountId"
             FROM pos_bills AS bill
             JOIN pos_billing_sessions AS session
               ON session.id = bill.session_id AND session.salon_id = bill.salon_id
             WHERE bill.salon_id = $1
             ORDER BY bill.created_at DESC
             LIMIT $2 OFFSET $3`,
            [salonId, limit, offset]
        );
        return result.rows;
    }

    async createRefund(
        salonId: string,
        billId: string,
        actorAccountId: string,
        input: CreatePosRefundRequest
    ) {
        return this.withTransaction(async (client) => {
            await this.assertSalonOwner(client, salonId, actorAccountId);
            const bill = await this.lockBill(client, salonId, billId);
            const prior = await client.query<{
                id: string;
                amount: string;
                paymentId: string | null;
                billId: string;
                reason: string;
                status: string;
            }>(
                `SELECT id, amount::text AS amount, payment_id AS "paymentId",
                        bill_id AS "billId", reason, status
                 FROM pos_refunds
                 WHERE salon_id = $1 AND idempotency_key = $2`,
                [salonId, input.idempotencyKey]
            );
            if (prior.rows[0]) {
                const previous = prior.rows[0];
                if (
                    previous.billId !== billId ||
                    Number(previous.amount) !== input.amount ||
                    previous.paymentId !== (input.paymentId ?? null) ||
                    previous.reason !== input.reason
                ) throw new ApiError(409, 'Idempotency key was used for another refund request');
                return {
                    id: previous.id,
                    billId,
                    amount: Number(previous.amount),
                    status: previous.status,
                };
            }
            if (bill.workflowStatus !== 'CONFIRMED' || !bill.confirmedAt) {
                throw new ApiError(409, 'Only confirmed invoices can be refunded');
            }
            const refundExpiresAt = new Date(
                bill.confirmedAt.getTime() + bill.refundWindowDays * 86_400_000
            );
            if (Date.now() > refundExpiresAt.getTime()) {
                throw new ApiError(409, 'The invoice refund window has expired');
            }
            const paid = await client.query<{ amount: string }>(
                `SELECT COALESCE(SUM(amount), 0)::text AS amount
                 FROM pos_payments
                 WHERE bill_id = $1 AND salon_id = $2 AND status = 'SUCCESS'
                   AND ($3::uuid IS NULL OR id = $3)`,
                [billId, salonId, input.paymentId ?? null]
            );
            if (Number(paid.rows[0].amount) <= 0) {
                throw new ApiError(409, 'There are no successful payments to refund');
            }
            const priorRefunds = await this.sumRefundReservations(
                client, billId, salonId, input.paymentId ?? null
            );
            if (roundMoney(priorRefunds + input.amount) > Number(paid.rows[0].amount)) {
                throw new ApiError(400, 'Refund amount exceeds the unrefunded amount paid');
            }
            const created = await client.query<{ id: string }>(
                `INSERT INTO pos_refunds (
                    bill_id, salon_id, payment_id, amount, reason, status,
                    requested_by_account_id, idempotency_key
                 ) VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, $7)
                 RETURNING id`,
                [
                    billId, salonId, input.paymentId ?? null, input.amount,
                    input.reason, actorAccountId, input.idempotencyKey,
                ]
            );
            await this.addBillEvent(
                client, billId, salonId, 'REFUND_ISSUED', actorAccountId,
                { refundId: created.rows[0].id, amount: input.amount, reason: input.reason }
            );
            return {
                id: created.rows[0].id,
                billId,
                amount: input.amount,
                status: 'PENDING',
                refundWindowExpiresAt: refundExpiresAt,
            };
        });
    }

    async listRefunds(salonId: string, limit: number, offset: number) {
        const result = await db.query(
            `SELECT refund.id, refund.bill_id AS "billId",
                    bill.invoice_number AS "invoiceNumber",
                    session.customer_account_id AS "customerAccountId",
                    refund.payment_id AS "paymentId", refund.amount::text AS amount,
                    refund.reason, refund.status,
                    refund.credit_note_id AS "creditNoteId",
                    refund.settlement_method AS "settlementMethod",
                    refund.cash_payout_reference AS "payoutReference",
                    refund.cash_paid_at AS "cashPaidAt",
                    refund.requested_by_account_id AS "requestedByAccountId",
                    refund.completed_by_account_id AS "completedByAccountId",
                    refund.created_at AS "createdAt",
                    refund.completed_at AS "completedAt"
             FROM pos_refunds AS refund
             JOIN pos_bills AS bill
               ON bill.id = refund.bill_id AND bill.salon_id = refund.salon_id
             JOIN pos_billing_sessions AS session
               ON session.id = bill.session_id AND session.salon_id = bill.salon_id
             WHERE refund.salon_id = $1
             ORDER BY refund.created_at DESC
             LIMIT $2 OFFSET $3`,
            [salonId, limit, offset]
        );
        return result.rows;
    }

    async reviewRefund(
        salonId: string,
        refundId: string,
        actorAccountId: string,
        input: ReviewPosRefundRequest
    ) {
        return this.withTransaction(async (client) => {
            await this.assertSalonOwner(client, salonId, actorAccountId);
            const result = await client.query<{
                id: string;
                billId: string;
                paymentId: string | null;
                amount: string;
                reason: string;
                status: string;
                creditNoteId: string | null;
                settlementMethod: string | null;
                payoutReference: string | null;
                cashPaidAt: Date | null;
                customerAccountId: string;
                offerPurchaseRequestId: string | null;
                confirmedAt: Date | null;
                refundWindowDays: number;
            }>(
                `SELECT refund.id, refund.bill_id AS "billId",
                        refund.payment_id AS "paymentId", refund.amount::text AS amount,
                        refund.reason, refund.status,
                        refund.credit_note_id AS "creditNoteId",
                        refund.settlement_method AS "settlementMethod",
                        refund.cash_payout_reference AS "payoutReference",
                        refund.cash_paid_at AS "cashPaidAt",
                        session.customer_account_id AS "customerAccountId",
                        bill.offer_purchase_request_id AS "offerPurchaseRequestId",
                        bill.confirmed_at AS "confirmedAt",
                        bill.refund_window_days AS "refundWindowDays"
                 FROM pos_refunds AS refund
                 JOIN pos_bills AS bill
                   ON bill.id = refund.bill_id AND bill.salon_id = refund.salon_id
                 JOIN pos_billing_sessions AS session
                   ON session.id = bill.session_id AND session.salon_id = bill.salon_id
                 WHERE refund.id = $1 AND refund.salon_id = $2
                 FOR UPDATE OF refund, bill`,
                [refundId, salonId]
            );
            const refund = result.rows[0];
            if (!refund) throw new ApiError(404, 'Refund request was not found');
            if (refund.status === input.status) {
                return {
                    id: refund.id,
                    billId: refund.billId,
                    creditNoteId: refund.creditNoteId,
                    amount: Number(refund.amount),
                    status: refund.status,
                    settlementMethod: refund.settlementMethod,
                    payoutReference: refund.payoutReference,
                    cashPaidAt: refund.cashPaidAt,
                };
            }
            if (refund.status !== 'PENDING') {
                throw new ApiError(409, 'Only pending refunds can be completed or cancelled');
            }
            if (input.status === 'CANCELLED') {
                await client.query(
                    `UPDATE pos_refunds SET status = 'CANCELLED',
                        completed_by_account_id = $3, completed_at = CURRENT_TIMESTAMP
                     WHERE id = $1 AND salon_id = $2`,
                    [refundId, salonId, actorAccountId]
                );
                await this.addBillEvent(
                    client,
                    refund.billId,
                    salonId,
                    'CANCELLED',
                    actorAccountId,
                    { refundId, reason: input.reason ?? null }
                );
                return { id: refund.id, billId: refund.billId, status: 'CANCELLED' };
            }
            if (input.cashPayoutConfirmed !== true) {
                throw new ApiError(400, 'Confirm the cash payout before completing the refund');
            }
            const paid = await client.query<{ amount: string }>(
                `SELECT COALESCE(SUM(amount), 0)::text AS amount
                 FROM pos_payments
                 WHERE bill_id = $1 AND salon_id = $2 AND status = 'SUCCESS'
                   AND ($3::uuid IS NULL OR id = $3)`,
                [refund.billId, salonId, refund.paymentId]
            );
            const reservedRefunds = await this.sumRefundReservations(
                client, refund.billId, salonId, refund.paymentId, refundId
            );
            if (
                roundMoney(reservedRefunds + Number(refund.amount))
                    > Number(paid.rows[0].amount)
            ) {
                throw new ApiError(409, 'Other approved refunds have consumed the available paid amount');
            }

            const offerPurchaseRequestId = refund.offerPurchaseRequestId;
            if (offerPurchaseRequestId) {
                await this.reverseUnusedOffer(
                    client,
                    salonId,
                    { ...refund, offerPurchaseRequestId },
                    actorAccountId,
                    refundId
                );
            }
            const note = await client.query<{ id: string }>(
                `INSERT INTO pos_credit_notes (
                    bill_id, salon_id, customer_account_id, amount, reason,
                    status, issued_by_account_id, refund_window_expires_at,
                    idempotency_key
                 ) VALUES ($1, $2, $3, $4, $5, 'ISSUED', $6, $7, $8)
                 RETURNING id`,
                [
                    refund.billId,
                    salonId,
                    refund.customerAccountId,
                    refund.amount,
                    refund.reason,
                    actorAccountId,
                    refund.confirmedAt
                        ? new Date(refund.confirmedAt.getTime() + refund.refundWindowDays * 86_400_000)
                        : null,
                    `refund:${refundId}`,
                ]
            );
            await client.query(
                `UPDATE pos_refunds SET status = 'COMPLETED', credit_note_id = $3,
                    settlement_method = 'CASH', cash_payout_reference = $4,
                    cash_paid_at = CURRENT_TIMESTAMP,
                    completed_by_account_id = $5, completed_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND salon_id = $2`,
                [refundId, salonId, note.rows[0].id, input.payoutReference ?? null, actorAccountId]
            );
            await this.addBillEvent(
                client, refund.billId, salonId, 'REFUND_COMPLETED', actorAccountId,
                {
                    refundId,
                    creditNoteId: note.rows[0].id,
                    amount: Number(refund.amount),
                    payoutMethod: 'CASH',
                    payoutReference: input.payoutReference ?? null,
                }
            );
            await client.query(
                `INSERT INTO account_notifications (
                    account_id, salon_id, title, body, channel, priority, status, metadata
                 ) VALUES
                    ($1, $2, 'Cash refund recorded', $3, 'IN_APP', 'HIGH', 'PENDING', $4::jsonb),
                    ($1, $2, 'Cash refund recorded', $3, 'PUSH', 'HIGH', 'PENDING', $4::jsonb)`,
                [
                    refund.customerAccountId,
                    salonId,
                    `A cash refund of ${refund.amount} was recorded for invoice ${refund.billId}.`,
                    JSON.stringify({
                        billId: refund.billId,
                        refundId,
                        creditNoteId: note.rows[0].id,
                        amount: refund.amount,
                        payoutMethod: 'CASH',
                        payoutReference: input.payoutReference ?? null,
                        fallbackOrder: ['EMAIL', 'WHATSAPP', 'SMS'],
                        whatsappRequires: ['activePlanFeatureOrAddon'],
                    }),
                ]
            );
            return {
                id: refundId,
                billId: refund.billId,
                creditNoteId: note.rows[0].id,
                amount: Number(refund.amount),
                status: 'COMPLETED',
                settlementMethod: 'CASH',
                payoutReference: input.payoutReference ?? null,
                cashPaidAt: new Date(),
            };
        });
    }

    async getCategorySettings(salonId: string) {
        const result = await db.query(
            `SELECT category, tax_mode AS "taxMode", allow_package AS "allowPackage",
                    allow_combo AS "allowCombo", allow_loyalty AS "allowLoyalty",
                    updated_by_account_id AS "updatedByAccountId", updated_at AS "updatedAt"
             FROM salon_pos_category_settings
             WHERE salon_id = $1
             ORDER BY category`,
            [salonId]
        );
        return result.rows;
    }

    async updateCategorySetting(
        salonId: string,
        category: PosTaxCategory,
        actorAccountId: string,
        input: PosCategorySettingRequest
    ) {
        return this.withTransaction(async (client) => {
            const before = await client.query(
                `SELECT tax_mode AS "taxMode", allow_package AS "allowPackage",
                        allow_combo AS "allowCombo", allow_loyalty AS "allowLoyalty"
                 FROM salon_pos_category_settings
                 WHERE salon_id = $1 AND category = $2
                 FOR UPDATE`,
                [salonId, category]
            );
            const after = {
                taxMode: input.taxMode,
                allowPackage: input.allowPackage,
                allowCombo: input.allowCombo,
                allowLoyalty: input.allowLoyalty,
            };
            await client.query(
                `INSERT INTO salon_pos_category_settings (
                    salon_id, category, tax_mode, allow_package, allow_combo,
                    allow_loyalty, updated_by_account_id, updated_at
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
                 ON CONFLICT (salon_id, category) DO UPDATE SET
                    tax_mode = EXCLUDED.tax_mode,
                    allow_package = EXCLUDED.allow_package,
                    allow_combo = EXCLUDED.allow_combo,
                    allow_loyalty = EXCLUDED.allow_loyalty,
                    updated_by_account_id = EXCLUDED.updated_by_account_id,
                    updated_at = CURRENT_TIMESTAMP`,
                [
                    salonId, category, input.taxMode, input.allowPackage,
                    input.allowCombo, input.allowLoyalty, actorAccountId,
                ]
            );
            await client.query(
                `INSERT INTO pos_category_setting_events (
                    salon_id, category, before_state, after_state, reason, actor_account_id
                 ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)`,
                [
                    salonId, category,
                    before.rows[0] ? JSON.stringify(before.rows[0]) : null,
                    JSON.stringify(after), input.reason, actorAccountId,
                ]
            );
            return { salonId, category, ...after };
        });
    }

    async updateBillCategoryOverride(
        salonId: string,
        billId: string,
        category: PosTaxCategory,
        actorAccountId: string,
        input: PosBillCategoryOverrideRequest
    ) {
        return this.withTransaction(async (client) => {
            const bill = await this.lockBill(client, salonId, billId);
            if (!['DRAFT', 'ISSUED'].includes(bill.workflowStatus)) {
                throw new ApiError(409, 'Confirmed invoices cannot change payment-category rules');
            }
            const before = await client.query(
                `SELECT allow_package AS "allowPackage", allow_combo AS "allowCombo",
                        allow_loyalty AS "allowLoyalty"
                 FROM pos_bill_category_overrides
                 WHERE bill_id = $1 AND salon_id = $2 AND category = $3
                 FOR UPDATE`,
                [billId, salonId, category]
            );
            const after = {
                allowPackage: input.allowPackage,
                allowCombo: input.allowCombo,
                allowLoyalty: input.allowLoyalty,
            };
            await client.query(
                `INSERT INTO pos_bill_category_overrides (
                    bill_id, salon_id, category, allow_package, allow_combo,
                    allow_loyalty, reason, updated_by_account_id
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (bill_id, category) DO UPDATE SET
                    allow_package = EXCLUDED.allow_package,
                    allow_combo = EXCLUDED.allow_combo,
                    allow_loyalty = EXCLUDED.allow_loyalty,
                    reason = EXCLUDED.reason,
                    updated_by_account_id = EXCLUDED.updated_by_account_id,
                    updated_at = CURRENT_TIMESTAMP`,
                [
                    billId, salonId, category,
                    input.allowPackage, input.allowCombo, input.allowLoyalty,
                    input.reason, actorAccountId,
                ]
            );
            await client.query(
                `INSERT INTO pos_bill_category_override_events (
                    bill_id, salon_id, category, before_state, after_state,
                    reason, actor_account_id
                 ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
                [
                    billId, salonId, category,
                    before.rows[0] ? JSON.stringify(before.rows[0]) : null,
                    JSON.stringify(after), input.reason, actorAccountId,
                ]
            );
            return { billId, salonId, category, ...after, reason: input.reason };
        });
    }

    private async priceLines(
        client: PoolClient,
        salonId: string,
        customerAccountId: string,
        billId: string,
        lines: PosBillLineRequest[]
    ): Promise<PricedLine[]> {
        const result: PricedLine[] = [];
        for (const [index, line] of lines.entries()) {
            if (line.itemType === 'SERVICE') {
                const serviceResult = await client.query<{
                    name: string;
                    basePrice: string;
                }>(
                    `SELECT name, base_price::text AS "basePrice"
                     FROM salon_services
                     WHERE id = $1 AND salon_id = $2 AND is_active = TRUE
                       AND deleted_at IS NULL`,
                    [line.serviceId, salonId]
                );
                const service = serviceResult.rows[0];
                if (!service) throw new ApiError(404, 'Active salon service was not found');
                result.push(await this.priceLine(client, salonId, line, {
                    id: line.serviceId,
                    description: line.description ?? service.name,
                    price: Number(service.basePrice),
                    category: 'SERVICE',
                    serviceId: line.serviceId,
                    productId: null,
                    packageId: null,
                    comboId: null,
                    requestId: null,
                    customerAccountId,
                }, index));
            } else if (line.itemType === 'PRODUCT') {
                const productResult = await client.query<{
                    name: string;
                    retailPrice: string | null;
                    inventoryType: string;
                    baseUnit: string;
                }>(
                    `SELECT name, retail_price::text AS "retailPrice",
                            inventory_type AS "inventoryType", base_unit AS "baseUnit"
                     FROM salon_products
                     WHERE id = $1 AND salon_id = $2 AND is_active = TRUE
                       AND is_sellable = TRUE AND deleted_at IS NULL
                       AND inventory_type IN ('RETAIL', 'LEGACY_UNCLASSIFIED')`,
                    [line.productId, salonId]
                );
                const product = productResult.rows[0];
                if (!product || product.retailPrice === null) {
                    throw new ApiError(404, 'Sellable salon product with a retail price was not found');
                }
                if (
                    (product.baseUnit === 'UNIT' || product.baseUnit === 'PACK') &&
                    !Number.isInteger(line.quantity)
                ) {
                    throw new ApiError(400, 'Retail product quantities must be whole units or packs');
                }
                result.push(await this.priceLine(client, salonId, line, {
                    id: line.productId,
                    description: line.description ?? product.name,
                    price: Number(product.retailPrice),
                    category: 'PRODUCT',
                    serviceId: null,
                    productId: line.productId,
                    packageId: null,
                    comboId: null,
                    requestId: null,
                    customerAccountId,
                }, index));
            } else {
                const requestResult = await client.query<{
                    offerType: string;
                    customerAccountId: string;
                    packageId: string | null;
                    comboId: string | null;
                    finalAmount: string;
                    name: string;
                    status: string;
                    billId: string | null;
                }>(
                    `SELECT request.offer_type AS "offerType",
                            request.customer_account_id AS "customerAccountId",
                            request.package_id AS "packageId", request.combo_id AS "comboId",
                            request.final_amount::text AS "finalAmount",
                            COALESCE(package_revision.name, combo_revision.name) AS name,
                            request.status, request.bill_id AS "billId"
                     FROM salon_offer_purchase_requests AS request
                     LEFT JOIN salon_package_revisions AS package_revision
                       ON package_revision.id = request.package_revision_id
                     LEFT JOIN salon_combo_revisions AS combo_revision
                       ON combo_revision.id = request.combo_revision_id
                     WHERE request.id = $1 AND request.salon_id = $2
                     FOR SHARE OF request`,
                    [line.offerPurchaseRequestId, salonId]
                );
                const offer = requestResult.rows[0];
                if (
                    !offer ||
                    offer.offerType !== line.itemType ||
                    offer.customerAccountId !== customerAccountId ||
                    offer.status !== 'BILLING' ||
                    (offer.billId && offer.billId !== billId)
                ) {
                    throw new ApiError(409, 'Package or combo sale request is not available for this customer and POS bill');
                }
                result.push(await this.priceLine(client, salonId, line, {
                    id: line.offerPurchaseRequestId,
                    description: line.description ?? offer.name,
                    price: Number(offer.finalAmount),
                    category: line.itemType,
                    serviceId: null,
                    productId: null,
                    packageId: offer.packageId,
                    comboId: offer.comboId,
                    requestId: line.offerPurchaseRequestId,
                    customerAccountId,
                }, index));
            }
        }
        return result;
    }

    private async priceLine(
        client: PoolClient,
        salonId: string,
        line: PosBillLineRequest,
        source: {
            id: string;
            description: string;
            price: number;
            category: string;
            serviceId: string | null;
            productId: string | null;
            packageId: string | null;
            comboId: string | null;
            requestId: string | null;
            customerAccountId: string;
        },
        sortOrder: number
    ): Promise<PricedLine> {
        const quantity = line.quantity;
        const subtotal = roundMoney(source.price * quantity);
        const discountType = 'discountType' in line ? line.discountType ?? null : null;
        const discountValue = 'discountValue' in line ? line.discountValue ?? null : null;
        if (source.category === 'PACKAGE' || source.category === 'COMBO') {
            if (discountType || discountValue !== null) {
                throw new ApiError(400, 'Package and combo discounts must be set on the offer sale quote');
            }
        }
        const taxRateOverride = 'taxRate' in line ? line.taxRate : undefined;
        const taxInclusiveOverride = 'taxInclusive' in line ? line.taxInclusive : undefined;
        const taxOverrideReason = 'taxOverrideReason' in line
            ? line.taxOverrideReason ?? null
            : null;
        if (
            (taxRateOverride !== undefined || taxInclusiveOverride !== undefined) &&
            !taxOverrideReason?.trim()
        ) {
            throw new ApiError(400, 'A reason is required for a POS tax-rate override');
        }
        const discountAmount = discountType === 'PERCENT'
            ? roundMoney(subtotal * Number(discountValue) / 100)
            : discountType === 'FIXED' ? roundMoney(Number(discountValue)) : 0;
        if (discountAmount > subtotal) {
            throw new ApiError(400, 'Line discount cannot exceed its subtotal');
        }

        const taxSettings = await client.query<{ taxMode: string }>(
            `SELECT tax_mode AS "taxMode"
             FROM salon_pos_category_settings
             WHERE salon_id = $1 AND category = $2`,
            [salonId, source.category]
        );
        const rateRows = await client.query<{ rate: string }>(
            `SELECT rate::text AS rate FROM salon_tax_rates
             WHERE salon_id = $1 AND item_type = $2 AND is_active = TRUE`,
            [salonId, source.category]
        );
        const taxRate = taxRateOverride ?? rateRows.rows.reduce((sum, tax) => sum + Number(tax.rate), 0);
        if (taxRate > 100) throw new ApiError(400, `Combined ${source.category.toLowerCase()} tax exceeds 100%`);
        const taxInclusive = taxInclusiveOverride ?? taxSettings.rows[0]?.taxMode === 'INCLUSIVE';
        const taxableAmount = roundMoney(subtotal - discountAmount);
        const taxAmount = roundMoney(
            taxInclusive
                ? taxableAmount * taxRate / (100 + taxRate)
                : taxableAmount * taxRate / 100
        );

        return {
            itemType: source.category,
            serviceId: source.serviceId,
            productId: source.productId,
            packageId: source.packageId,
            comboId: source.comboId,
            offerPurchaseRequestId: source.requestId,
            parentBillItemId: line.parentBillItemId ?? null,
            description: source.description,
            quantity,
            unitPrice: source.price,
            subtotal,
            discountType,
            discountValue,
            discountAmount,
            taxCategory: source.category,
            taxInclusive,
            taxOverrideReason,
            taxRate,
            taxAmount,
            staffMembershipId: 'staffMembershipId' in line ? line.staffMembershipId ?? null : null,
            sortOrder,
            batchAllocations: line.itemType === 'PRODUCT'
                ? line.batchAllocations.map((allocation) => ({
                    batchId: allocation.batchId,
                    quantity: allocation.quantity,
                    expiredOverrideReason: allocation.expiredOverrideReason ?? null,
                }))
                : [],
        };
    }

    private calculateTotals(lines: PricedLine[]): Totals {
        const subtotal = roundMoney(lines.reduce((sum, item) => sum + item.subtotal, 0));
        const discountAmount = roundMoney(lines.reduce((sum, item) => sum + item.discountAmount, 0));
        const taxes = (types: string[]) => roundMoney(lines
            .filter((item) => types.includes(item.taxCategory))
            .reduce((sum, item) => sum + item.taxAmount, 0));
        const serviceTaxAmount = taxes(['SERVICE', 'CONSUMABLE']);
        const productTaxAmount = taxes(['PRODUCT']);
        const offerTaxAmount = taxes(['PACKAGE', 'COMBO']);
        const totalAmount = roundMoney(lines.reduce(
            (sum, item) => sum + item.subtotal - item.discountAmount
                + (item.taxInclusive ? 0 : item.taxAmount),
            0
        ));
        return {
            subtotal, discountAmount, serviceTaxAmount,
            productTaxAmount, offerTaxAmount, totalAmount,
        };
    }

    private async insertLines(client: PoolClient, billId: string, salonId: string, lines: PricedLine[]) {
        for (const item of lines) {
            const inserted = await client.query<{ id: string }>(
                `INSERT INTO pos_bill_items (
                    bill_id, salon_id, item_type, service_id, product_id,
                    package_id, combo_id, offer_purchase_request_id, parent_bill_item_id,
                    description, quantity, unit_price, subtotal, discount_type,
                    discount_value, discount_amount, tax_category, tax_inclusive,
                    tax_override_reason, tax_rate, tax_amount, staff_membership_id, sort_order
                 ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                    $14, $15, $16, $17, $18, $19, $20, $21, $22, $23
                 )
                 RETURNING id`,
                [
                    billId, salonId, item.itemType, item.serviceId, item.productId,
                    item.packageId, item.comboId, item.offerPurchaseRequestId,
                    item.parentBillItemId, item.description, item.quantity, item.unitPrice,
                    item.subtotal,                     item.discountType, item.discountValue, item.discountAmount,
                    item.taxCategory, item.taxInclusive,
                    item.taxOverrideReason, item.taxRate, item.taxAmount,
                    item.staffMembershipId, item.sortOrder,
                ]
            );
            const billItemId = inserted.rows[0].id;
            if (item.itemType !== 'PRODUCT') continue;
            for (const allocation of item.batchAllocations) {
                const batch = await client.query(
                    `SELECT id
                     FROM salon_inventory_batches
                     WHERE id = $1 AND salon_id = $2 AND product_id = $3`,
                    [allocation.batchId, salonId, item.productId]
                );
                if (!batch.rowCount) {
                    throw new ApiError(404, 'Selected batch does not belong to this salon product');
                }
                await client.query(
                    `INSERT INTO pos_bill_item_batch_allocations (
                        salon_id, bill_id, bill_item_id, product_id, batch_id,
                        quantity, expired_override_reason
                     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [
                        salonId, billId, billItemId, item.productId,
                        allocation.batchId, allocation.quantity,
                        allocation.expiredOverrideReason,
                    ]
                );
            }
        }
    }

    private async attachOfferRequest(
        client: PoolClient,
        salonId: string,
        customerAccountId: string,
        billId: string,
        requestId: string | null
    ) {
        if (!requestId) return;
        const updated = await client.query(
            `UPDATE salon_offer_purchase_requests
             SET bill_id = $3, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND salon_id = $2 AND customer_account_id = $4
               AND status = 'BILLING' AND (bill_id IS NULL OR bill_id = $3)`,
            [requestId, salonId, billId, customerAccountId]
        );
        if (!updated.rowCount) throw new ApiError(409, 'Offer sale request is already linked to another bill');
    }

    private async lockSession(client: PoolClient, salonId: string, sessionId: string) {
        const result = await client.query<{
            id: string;
            customerAccountId: string;
            status: string;
            origin: string;
        }>(
            `SELECT id, customer_account_id AS "customerAccountId", status
                    , origin
             FROM pos_billing_sessions WHERE id = $1 AND salon_id = $2 FOR UPDATE`,
            [sessionId, salonId]
        );
        if (!result.rows[0]) throw new ApiError(404, 'POS session was not found');
        return result.rows[0];
    }

    private async lockBill(client: PoolClient, salonId: string, billId: string): Promise<BillRow> {
        const result = await client.query<BillRow>(
            `SELECT bill.id, bill.session_id AS "sessionId", bill.salon_id AS "salonId",
                    session.customer_account_id AS "customerAccountId",
                    bill.invoice_number AS "invoiceNumber",
                    bill.workflow_status AS "workflowStatus",
                    bill.current_version AS "currentVersion",
                    bill.subtotal::text AS subtotal,
                    bill.discount_amount::text AS "discountAmount",
                    bill.service_tax_amount::text AS "serviceTaxAmount",
                    bill.product_tax_amount::text AS "productTaxAmount",
                    bill.offer_tax_amount::text AS "offerTaxAmount",
                    bill.total_amount::text AS "totalAmount",
                    COALESCE(payments.paid, 0)::text AS "paidAmount",
                    bill.offer_purchase_request_id AS "offerPurchaseRequestId",
                    bill.confirmed_at AS "confirmedAt",
                    bill.refund_window_days AS "refundWindowDays"
             FROM pos_bills AS bill
             JOIN pos_billing_sessions AS session
               ON session.id = bill.session_id AND session.salon_id = bill.salon_id
             LEFT JOIN LATERAL (
                SELECT COALESCE(SUM(payment.amount) FILTER (WHERE payment.status = 'SUCCESS'), 0) AS paid
                FROM pos_payments AS payment
                WHERE payment.bill_id = bill.id AND payment.salon_id = bill.salon_id
             ) AS payments ON TRUE
             WHERE bill.id = $1 AND bill.salon_id = $2
             FOR UPDATE OF bill, session`,
            [billId, salonId]
        );
        if (!result.rows[0]) throw new ApiError(404, 'POS bill was not found');
        return result.rows[0];
    }

    private async sumRefundReservations(
        client: PoolClient,
        billId: string,
        salonId: string,
        paymentId: string | null,
        excludeRefundId?: string
    ) {
        const result = await client.query<{ amount: string }>(
            `SELECT (
                COALESCE((
                    SELECT SUM(refund.amount)
                    FROM pos_refunds AS refund
                    WHERE refund.bill_id = $1 AND refund.salon_id = $2
                      AND refund.status IN ('PENDING', 'COMPLETED')
                      AND (
                          $3::uuid IS NULL OR refund.payment_id IS NULL
                          OR refund.payment_id = $3
                      )
                      AND ($4::uuid IS NULL OR refund.id <> $4)
                ), 0) +
                COALESCE((
                    SELECT SUM(note.amount)
                    FROM pos_credit_notes AS note
                    WHERE note.bill_id = $1 AND note.salon_id = $2
                      AND note.status IN ('ISSUED', 'REDEEMED')
                      AND NOT EXISTS (
                          SELECT 1 FROM pos_refunds AS linked_refund
                          WHERE linked_refund.credit_note_id = note.id
                      )
                ), 0)
             )::text AS amount`,
            [billId, salonId, paymentId, excludeRefundId ?? null]
        );
        return Number(result.rows[0].amount);
    }

    private async getBill(client: PoolClient, salonId: string, billId: string) {
        const bill = await this.lockBill(client, salonId, billId);
        const lines = await client.query(
            `SELECT id, item_type AS "itemType", service_id AS "serviceId",
                    product_id AS "productId", package_id AS "packageId",
                    combo_id AS "comboId", offer_purchase_request_id AS "offerPurchaseRequestId",
                    parent_bill_item_id AS "parentBillItemId", description,
                    quantity::text AS quantity, unit_price::text AS "unitPrice",
                    subtotal::text AS subtotal, discount_type AS "discountType",
                    discount_value::text AS "discountValue",
                    discount_amount::text AS "discountAmount", tax_category AS "taxCategory",
                    tax_inclusive AS "taxInclusive", tax_rate::text AS "taxRate",
                    tax_amount::text AS "taxAmount", staff_membership_id AS "staffMembershipId",
                    sort_order AS "sortOrder"
             FROM pos_bill_items
             WHERE bill_id = $1 AND salon_id = $2 AND removed_at IS NULL
             ORDER BY sort_order, created_at`,
            [billId, salonId]
        );
        const allocations = await client.query<{
            billItemId: string;
            batchId: string;
            batchNumber: string | null;
            expiryDate: string | null;
            quantity: string;
            expiryStatus: string;
            expiredOverrideReason: string | null;
        }>(
            `SELECT allocation.bill_item_id AS "billItemId",
                    allocation.batch_id AS "batchId",
                    batch.batch_number AS "batchNumber",
                    to_char(batch.expiry_date, 'YYYY-MM-DD') AS "expiryDate",
                    allocation.quantity::text AS quantity,
                    CASE
                        WHEN batch.expiry_date IS NULL THEN 'UNKNOWN'
                        WHEN batch.expiry_date < CURRENT_DATE THEN 'EXPIRED'
                        WHEN batch.expiry_date <= CURRENT_DATE + 30 THEN 'NEAR_EXPIRY'
                        ELSE 'OK'
                    END AS "expiryStatus",
                    allocation.expired_override_reason AS "expiredOverrideReason"
             FROM pos_bill_item_batch_allocations AS allocation
             JOIN salon_inventory_batches AS batch
               ON batch.id = allocation.batch_id
              AND batch.salon_id = allocation.salon_id
              AND batch.product_id = allocation.product_id
             WHERE allocation.bill_id = $1 AND allocation.salon_id = $2`,
            [billId, salonId]
        );
        const allocationsByItem = new Map<string, typeof allocations.rows>();
        for (const allocation of allocations.rows) {
            const current = allocationsByItem.get(allocation.billItemId) ?? [];
            current.push(allocation);
            allocationsByItem.set(allocation.billItemId, current);
        }
        return {
            id: bill.id,
            sessionId: bill.sessionId,
            salonId: bill.salonId,
            customerAccountId: bill.customerAccountId,
            invoiceNumber: bill.invoiceNumber,
            workflowStatus: bill.workflowStatus,
            currentVersion: bill.currentVersion,
            subtotal: Number(bill.subtotal),
            discountAmount: Number(bill.discountAmount),
            serviceTaxAmount: Number(bill.serviceTaxAmount),
            productTaxAmount: Number(bill.productTaxAmount),
            offerTaxAmount: Number(bill.offerTaxAmount),
            totalAmount: Number(bill.totalAmount),
            paidAmount: Number(bill.paidAmount),
            balanceDue: roundMoney(Number(bill.totalAmount) - Number(bill.paidAmount)),
            offerPurchaseRequestId: bill.offerPurchaseRequestId,
            items: lines.rows.map((line) => ({
                ...line,
                ...(line.itemType === 'PRODUCT'
                    ? { batchAllocations: allocationsByItem.get(String(line.id)) ?? [] }
                    : {}),
            })),
        };
    }

    private async decrementRetailBatchAllocations(
        client: PoolClient,
        salonId: string,
        billId: string,
        billItemId: string,
        productId: string,
        quantity: number,
        accountId: string
    ) {
        const allocations = await client.query<{
            batchId: string;
            quantity: string;
            isExpired: boolean;
            expiredOverrideReason: string | null;
        }>(
            `SELECT allocation.batch_id AS "batchId",
                    allocation.quantity::text AS quantity,
                    COALESCE(batch.expiry_date < CURRENT_DATE, FALSE) AS "isExpired",
                    allocation.expired_override_reason AS "expiredOverrideReason"
             FROM pos_bill_item_batch_allocations AS allocation
             JOIN salon_inventory_batches AS batch
               ON batch.id = allocation.batch_id
              AND batch.salon_id = allocation.salon_id
              AND batch.product_id = allocation.product_id
             WHERE allocation.bill_item_id = $1 AND allocation.bill_id = $2
               AND allocation.salon_id = $3 AND allocation.product_id = $4
             FOR UPDATE OF allocation, batch`,
            [billItemId, billId, salonId, productId]
        );
        const allocatedQuantity = allocations.rows.reduce(
            (sum, allocation) => sum + Number(allocation.quantity),
            0
        );
        if (
            allocations.rows.length === 0 ||
            Math.abs(allocatedQuantity - quantity) > 0.0001
        ) {
            throw new ApiError(409, 'Select the actual batch and quantity for every retail product line');
        }
        for (const allocation of allocations.rows) {
            const expired = allocation.isExpired;
            if (expired && !allocation.expiredOverrideReason) {
                throw new ApiError(409, 'Selected batch is expired; update the line with an authorized override reason');
            }
            if (expired) await this.assertInventoryManager(client, salonId, accountId);

            const batchUpdate = await client.query(
                `UPDATE salon_inventory_batches
                 SET current_quantity = current_quantity - $4
                 WHERE id = $1 AND product_id = $2 AND salon_id = $3
                   AND current_quantity >= $4`,
                [allocation.batchId, productId, salonId, allocation.quantity]
            );
            if (!batchUpdate.rowCount) {
                throw new ApiError(409, 'Selected batch no longer has enough stock');
            }
            const productUpdate = await client.query(
                `UPDATE salon_products
                 SET current_stock = current_stock - $3, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND salon_id = $2 AND is_active = TRUE
                   AND is_sellable = TRUE AND current_stock >= $3`,
                [productId, salonId, allocation.quantity]
            );
            if (!productUpdate.rowCount) {
                throw new ApiError(409, `Insufficient product stock for ${productId}`);
            }
            await client.query(
                `INSERT INTO salon_inventory_ledger (
                    salon_id, product_id, batch_id, quantity_change, reason,
                    reference_id, created_by_account_id, note
                 ) VALUES ($1, $2, $3, $4, 'RETAIL_SALE', $5, $6, $7)`,
                [
                    salonId, productId, allocation.batchId, -Number(allocation.quantity),
                    billId, accountId, expired ? allocation.expiredOverrideReason : null,
                ]
            );
        }
    }

    private async assertInventoryManager(
        client: PoolClient,
        salonId: string,
        accountId: string
    ) {
        const result = await client.query(
            `SELECT 1
             FROM salon_organization_owners AS owner
             JOIN salons AS salon ON salon.organization_id = owner.organization_id
             JOIN salon_applications AS application ON application.salon_id = salon.id
             WHERE owner.account_id = $1 AND salon.id = $2
               AND salon.status = 'ACTIVE' AND salon.deleted_at IS NULL
               AND application.status = 'APPROVED'
             UNION
             SELECT 1
             FROM salon_memberships AS membership
             JOIN salon_membership_locations AS location
               ON location.membership_id = membership.id
              AND location.organization_id = membership.organization_id
             JOIN salon_membership_roles AS membership_role
               ON membership_role.membership_id = membership.id
              AND membership_role.salon_id = location.salon_id
             JOIN salon_role_permissions AS role_permission
               ON role_permission.role_id = membership_role.role_id
             WHERE membership.account_id = $1 AND location.salon_id = $2
               AND membership.status = 'ACTIVE'
               AND role_permission.permission_key = 'inventory:manage'
             LIMIT 1`,
            [accountId, salonId]
        );
        if (!result.rowCount) throw new ApiError(403, 'Inventory manager permission is required for expired stock');
    }

    private async addBillEvent(
        client: PoolClient,
        billId: string,
        salonId: string,
        eventType: string,
        actorAccountId: string,
        metadata: Record<string, unknown>
    ) {
        await client.query(
            `INSERT INTO pos_bill_events (
                bill_id, salon_id, event_type, actor_account_id, metadata
             ) VALUES ($1, $2, $3, $4, $5::jsonb)`,
            [billId, salonId, eventType, actorAccountId, JSON.stringify(metadata)]
        );
    }

    private async assertSalonOwner(
        client: PoolClient,
        salonId: string,
        actorAccountId: string
    ) {
        const owner = await client.query(
            `SELECT 1
             FROM salons AS salon
             JOIN salon_organization_owners AS owner
               ON owner.organization_id = salon.organization_id
             WHERE salon.id = $1 AND owner.account_id = $2
               AND salon.deleted_at IS NULL
             FOR SHARE OF salon, owner`,
            [salonId, actorAccountId]
        );
        if (!owner.rowCount) {
            throw new ApiError(403, 'Only the salon owner can manage refunds');
        }
    }

    private async reverseUnusedOffer(
        client: PoolClient,
        salonId: string,
        refund: {
            billId: string;
            customerAccountId: string;
            offerPurchaseRequestId: string;
            amount: string;
        },
        actorAccountId: string,
        refundId: string
    ) {
        const offer = await client.query<{
            id: string;
            offerType: 'PACKAGE' | 'COMBO';
            finalAmount: string;
        }>(
            `SELECT id, offer_type AS "offerType", final_amount::text AS "finalAmount"
             FROM salon_offer_purchase_requests
             WHERE id = $1 AND salon_id = $2
               AND customer_account_id = $3 AND status = 'ACCEPTED'
             FOR UPDATE`,
            [refund.offerPurchaseRequestId, salonId, refund.customerAccountId]
        );
        const request = offer.rows[0];
        if (!request) throw new ApiError(409, 'Offer sale is not available for refund');
        const items = await client.query<{
            amount: string;
            itemType: string;
            taxInclusive: boolean;
            taxAmount: string;
        }>(
            `SELECT item_type AS "itemType",
                    (subtotal - discount_amount
                     + CASE WHEN tax_inclusive THEN 0 ELSE tax_amount END)::text AS amount,
                    tax_inclusive AS "taxInclusive", tax_amount::text AS "taxAmount"
             FROM pos_bill_items
             WHERE bill_id = $1 AND salon_id = $2 AND removed_at IS NULL`,
            [refund.billId, salonId]
        );
        if (
            items.rows.length !== 1 ||
            items.rows[0].itemType !== request.offerType ||
            roundMoney(Number(items.rows[0].amount)) !== Number(refund.amount)
        ) {
            throw new ApiError(
                409,
                'Offer refunds require a separate invoice and must refund the full offer sale amount'
            );
        }
        const used = await client.query(
            `SELECT 1 FROM salon_offer_ledger
             WHERE salon_id = $1 AND purchase_request_id = $2
               AND entry_type IN ('PACKAGE_REDEMPTION', 'COMBO_REDEMPTION')
             LIMIT 1`,
            [salonId, request.id]
        );
        if (used.rowCount) throw new ApiError(409, 'An offer with any redemption cannot be refunded');

        if (request.offerType === 'PACKAGE') {
            const updated = await client.query(
                `UPDATE customer_package_subscriptions
                     SET status = 'CANCELLED', payment_status = 'REFUNDED', remaining_value = 0
                 WHERE purchase_request_id = $1 AND salon_id = $2
                       AND customer_account_id = $3
                       AND status IN ('ACTIVE', 'EXHAUSTED', 'EXPIRED')
                       AND payment_status = 'PAID'
                   AND NOT EXISTS (
                       SELECT 1
                       FROM customer_package_service_balances AS balance
                       WHERE balance.subscription_id = customer_package_subscriptions.id
                         AND balance.salon_id = customer_package_subscriptions.salon_id
                         AND balance.used_count > 0
                   )`,
                [request.id, salonId, refund.customerAccountId]
            );
            if (!updated.rowCount) {
                throw new ApiError(409, 'Package entitlement was used or is no longer refundable');
            }
        } else {
            const updated = await client.query(
                `UPDATE customer_combo_purchases
                 SET status = 'CANCELLED', payment_status = 'REFUNDED'
                 WHERE purchase_request_id = $1 AND salon_id = $2
                   AND customer_account_id = $3
                   AND status IN ('ACTIVE', 'EXPIRED') AND payment_status = 'PAID'`,
                [request.id, salonId, refund.customerAccountId]
            );
            if (!updated.rowCount) {
                throw new ApiError(409, 'Combo entitlement was used or is no longer refundable');
            }
        }
        await client.query(
            `INSERT INTO salon_offer_ledger (
                salon_id, customer_account_id, purchase_request_id, entry_type,
                amount, bill_id, idempotency_key, metadata
             ) VALUES ($1, $2, $3, 'REVERSAL', $4, $5, $6, $7::jsonb)`,
            [
                salonId,
                refund.customerAccountId,
                request.id,
                -Number(request.finalAmount),
                refund.billId,
                `pos-refund:${refundId}:offer`,
                JSON.stringify({
                    refundId,
                    actorAccountId,
                    refundAmount: refund.amount,
                    offerType: request.offerType,
                    termsReversed: true,
                }),
            ]
        );
    }

    private async addInvoiceNotification(
        client: PoolClient,
        bill: BillRow,
        versionId: string,
        invoiceNumber: string,
        snapshot: unknown
    ) {
        const confirmed = typeof snapshot === 'object' && snapshot !== null
            && 'invoiceType' in snapshot && snapshot.invoiceType === 'FINAL';
        await client.query(
            `INSERT INTO account_notifications (
                account_id, salon_id, title, body, channel, priority, status, metadata
             ) VALUES
                ($1, $2, $3, $4, 'IN_APP', 'HIGH', 'PENDING', $5::jsonb),
                ($1, $2, $3, $4, 'PUSH', 'HIGH', 'PENDING', $5::jsonb)`,
            [
                bill.customerAccountId,
                bill.salonId,
                confirmed ? 'Final salon invoice' : 'Salon invoice ready for review',
                confirmed
                    ? `Your salon invoice ${invoiceNumber} is confirmed.`
                    : `Your pro forma invoice ${invoiceNumber} is ready. The salon will confirm the final invoice before payment.`,
                JSON.stringify({
                    billId: bill.id,
                    versionId,
                    invoiceNumber,
                    invoiceType: confirmed ? 'FINAL' : 'PRO_FORMA',
                    snapshot,
                    fallbackOrder: ['EMAIL', 'WHATSAPP', 'SMS'],
                    whatsappRequires: ['activePlanFeatureOrAddon'],
                }),
            ]
        );
    }

    private async getIdempotentPayment(client: PoolClient, salonId: string, key: string) {
        const result = await client.query<{
            id: string;
            billId: string | null;
            paymentMode: string;
            amount: string;
        }>(
            `SELECT id, bill_id AS "billId", payment_mode AS "paymentMode", amount::text AS amount
             FROM pos_payments WHERE salon_id = $1 AND idempotency_key = $2`,
            [salonId, key]
        );
        return result.rows[0] ?? null;
    }

    private assertSamePayment(
        payment: { billId: string | null; paymentMode: string; amount: string },
        billId: string,
        mode: string,
        amount: number
    ) {
        if (payment.billId !== billId || payment.paymentMode !== mode || Number(payment.amount) !== amount) {
            throw new ApiError(409, 'Idempotency key was used for a different payment');
        }
    }

    private async refreshPaymentStatus(
        client: PoolClient,
        salonId: string,
        billId: string,
        sessionId: string
    ) {
        const billTotals = await client.query<{ total: string; paid: string }>(
            `SELECT bill.total_amount::text AS total,
                    COALESCE(SUM(payment.amount) FILTER (WHERE payment.status = 'SUCCESS'), 0)::text AS paid
             FROM pos_bills AS bill
             LEFT JOIN pos_payments AS payment
               ON payment.bill_id = bill.id AND payment.salon_id = bill.salon_id
             WHERE bill.id = $1 AND bill.salon_id = $2
             GROUP BY bill.id`,
            [billId, salonId]
        );
        const bill = billTotals.rows[0];
        if (!bill) throw new ApiError(404, 'POS bill was not found');
        const paid = Number(bill.paid);
        const total = Number(bill.total);
        await client.query(
            `UPDATE pos_bills SET status = $3, closed_at = $4
             WHERE id = $1 AND salon_id = $2`,
            [
                billId,
                salonId,
                paid >= total ? 'CLOSED' : 'OPEN',
                paid >= total ? new Date() : null,
            ]
        );
        const sessionTotals = await client.query<{ total: string; paid: string }>(
            `SELECT COALESCE(SUM(bill.total_amount), 0)::text AS total,
                    COALESCE(SUM(payments.paid), 0)::text AS paid
             FROM pos_bills AS bill
             LEFT JOIN LATERAL (
                SELECT COALESCE(
                    SUM(payment.amount) FILTER (WHERE payment.status = 'SUCCESS'), 0
                ) AS paid
                FROM pos_payments AS payment
                WHERE payment.bill_id = bill.id AND payment.salon_id = bill.salon_id
             ) AS payments ON TRUE
             WHERE bill.session_id = $1 AND bill.salon_id = $2
             GROUP BY bill.session_id`,
            [sessionId, salonId]
        );
        const session = sessionTotals.rows[0];
        const sessionPaid = Number(session?.paid ?? 0);
        const sessionTotal = Number(session?.total ?? 0);
        const status = sessionPaid >= sessionTotal
            ? 'PAID'
            : sessionPaid > 0 ? 'PARTIAL' : 'OPEN';
        await client.query(
            `UPDATE pos_billing_sessions SET session_total = $3, status = $4, closed_at = $5
             WHERE id = $1 AND salon_id = $2`,
            [
                sessionId,
                salonId,
                sessionTotal,
                status,
                status === 'PAID' ? new Date() : null,
            ]
        );
    }

    private singleOfferRequestId(lines: PricedLine[]): string | null {
        const ids = lines.map((line) => line.offerPurchaseRequestId).filter((id): id is string => id !== null);
        if (new Set(ids).size > 1) {
            throw new ApiError(400, 'A bill can contain only one package or combo sale');
        }
        return ids[0] ?? null;
    }

    private billType(lines: PricedLine[]): string {
        const hasOffer = lines.some((line) => line.itemType === 'PACKAGE' || line.itemType === 'COMBO');
        const hasService = lines.some((line) => line.itemType === 'SERVICE');
        const hasProduct = lines.some((line) => line.itemType === 'PRODUCT');
        if (hasOffer && !hasService && !hasProduct) return 'OFFER';
        if (hasOffer || (hasService && hasProduct)) return 'COMBINED';
        return hasProduct ? 'PRODUCT' : 'SERVICE';
    }

    private async approveAdvanceClaim(
        client: PoolClient,
        salonId: string,
        claim: {
            id: string;
            customerAccountId: string;
            paymentMode: PosTenderMode;
            amount: string;
            transactionReference: string | null;
            status: string;
        },
        actorAccountId: string
    ) {
        const inserted = await client.query<{ id: string }>(
            `INSERT INTO pos_customer_advance_entries (
                salon_id, customer_account_id, payment_claim_id, amount, remaining_amount
             ) VALUES ($1, $2, $3, $4, $4)
             ON CONFLICT (payment_claim_id) DO NOTHING
             RETURNING id`,
            [salonId, claim.customerAccountId, claim.id, claim.amount]
        );
        const entry = inserted.rows[0] ?? (await client.query<{ id: string }>(
            `SELECT id FROM pos_customer_advance_entries WHERE payment_claim_id = $1`,
            [claim.id]
        )).rows[0];
        await client.query(
            `UPDATE pos_payment_claims
             SET status = 'APPROVED', reviewed_by_account_id = $3,
                 reviewed_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND salon_id = $2`,
            [claim.id, salonId, actorAccountId]
        );
        await this.addClaimEvent(
            client,
            claim.id,
            salonId,
            claim.status === 'REJECTED' ? 'REAPPROVED' : 'APPROVED',
            actorAccountId
        );
        return { id: claim.id, advanceEntryId: entry.id, status: 'APPROVED' };
    }

    private async addClaimEvent(
        client: PoolClient,
        claimId: string,
        salonId: string,
        status: 'APPROVED' | 'REJECTED' | 'REAPPROVED',
        actorAccountId: string,
        reason?: string
    ) {
        await client.query(
            `INSERT INTO pos_payment_claim_events (
                payment_claim_id, salon_id, status, actor_account_id, reason
             ) VALUES ($1, $2, $3, $4, $5)`,
            [claimId, salonId, status, actorAccountId, reason ?? null]
        );
    }

    private async getEffectiveCategorySetting(
        client: PoolClient,
        salonId: string,
        billId: string,
        category: string
    ) {
        const result = await client.query<{
            allowPackage: boolean;
            allowCombo: boolean;
            allowLoyalty: boolean;
        }>(
            `SELECT COALESCE(override.allow_package, setting.allow_package, FALSE) AS "allowPackage",
                    COALESCE(override.allow_combo, setting.allow_combo, FALSE) AS "allowCombo",
                    COALESCE(override.allow_loyalty, setting.allow_loyalty, FALSE) AS "allowLoyalty"
             FROM (SELECT 1) AS singleton
             LEFT JOIN salon_pos_category_settings AS setting
               ON setting.salon_id = $1 AND setting.category = $3
             LEFT JOIN pos_bill_category_overrides AS override
               ON override.bill_id = $2 AND override.salon_id = $1
              AND override.category = $3`,
            [salonId, billId, category]
        );
        return result.rows[0] ?? {
            allowPackage: false,
            allowCombo: false,
            allowLoyalty: false,
        };
    }

    private async redeemPackageAllocation(
        client: PoolClient,
        salonId: string,
        redemption: WalletRedemptionRow,
        allocation: WalletAllocation,
        actorAccountId: string,
        index: number
    ) {
        if (!allocation.entitlementId || !allocation.serviceId) {
            throw new ApiError(409, 'Package redemption is missing its entitlement or service');
        }
        const entitlement = await client.query<{
            requestId: string;
            remainingValue: string;
            maxUses: number | null;
            usedCount: number;
        }>(
            `SELECT subscription.purchase_request_id AS "requestId",
                    subscription.remaining_value::text AS "remainingValue",
                    balance.max_uses AS "maxUses", balance.used_count AS "usedCount"
             FROM customer_package_subscriptions AS subscription
             JOIN customer_package_service_balances AS balance
               ON balance.subscription_id = subscription.id
              AND balance.salon_id = subscription.salon_id
              AND balance.service_id = $3
             JOIN salon_services AS service
               ON service.id = balance.service_id AND service.salon_id = balance.salon_id
             WHERE subscription.id = $1 AND subscription.salon_id = $2
               AND subscription.customer_account_id = $4
               AND subscription.payment_status = 'PAID'
               AND subscription.status = 'ACTIVE'
               AND subscription.expires_at > CURRENT_TIMESTAMP
               AND service.base_price = $5
             FOR UPDATE OF subscription, balance`,
            [
                allocation.entitlementId, salonId, allocation.serviceId,
                redemption.customerAccountId, allocation.amount,
            ]
        );
        const active = entitlement.rows[0];
        if (!active || Number(active.remainingValue) < allocation.amount) {
            throw new ApiError(409, 'Package credit changed or is insufficient for this service');
        }
        if (active.maxUses !== null && active.usedCount >= active.maxUses) {
            throw new ApiError(409, 'Package use limit is exhausted for this service');
        }
        const updatedUse = await client.query(
            `UPDATE customer_package_service_balances
             SET used_count = used_count + 1
             WHERE subscription_id = $1 AND salon_id = $2 AND service_id = $3
               AND (max_uses IS NULL OR used_count < max_uses)`,
            [allocation.entitlementId, salonId, allocation.serviceId]
        );
        if (!updatedUse.rowCount) throw new ApiError(409, 'Package service usage limit is exhausted');
        const updatedCredit = await client.query(
            `UPDATE customer_package_subscriptions
             SET remaining_value = remaining_value - $2
             WHERE id = $1 AND salon_id = $3 AND remaining_value >= $2`,
            [allocation.entitlementId, allocation.amount, salonId]
        );
        if (!updatedCredit.rowCount) throw new ApiError(409, 'Package credit is insufficient');
        await client.query(
            `UPDATE pos_bill_items SET is_covered_by_plan = TRUE
             WHERE id = $1 AND bill_id = $2 AND salon_id = $3 AND removed_at IS NULL`,
            [allocation.billItemId, redemption.billId, salonId]
        );
        await client.query(
            `UPDATE customer_package_subscriptions AS subscription
             SET status = 'EXHAUSTED'
             WHERE subscription.id = $1 AND subscription.salon_id = $2
               AND (
                   subscription.remaining_value = 0 OR NOT EXISTS (
                       SELECT 1 FROM customer_package_service_balances AS balance
                       WHERE balance.subscription_id = subscription.id
                         AND balance.salon_id = subscription.salon_id
                         AND (balance.max_uses IS NULL OR balance.used_count < balance.max_uses)
                   )
               )`,
            [allocation.entitlementId, salonId]
        );
        await client.query(
            `INSERT INTO salon_offer_ledger (
                salon_id, customer_account_id, purchase_request_id, entry_type,
                amount, service_id, bill_id, idempotency_key, metadata
             ) VALUES ($1, $2, $3, 'PACKAGE_REDEMPTION', $4, $5, $6, $7, $8::jsonb)`,
            [
                salonId,
                redemption.customerAccountId,
                active.requestId,
                -allocation.amount,
                allocation.serviceId,
                redemption.billId,
                `pos-wallet:${redemption.id}:package:${index}`,
                JSON.stringify({
                    entitlementId: allocation.entitlementId,
                    serviceId: allocation.serviceId,
                    currentServicePrice: allocation.amount,
                    billItemId: allocation.billItemId,
                    redemptionId: redemption.id,
                }),
            ]
        );
        await this.insertWalletPayment(
            client, salonId, redemption, actorAccountId,
            'PLAN', 'PACKAGE', allocation.amount,
            `pos-wallet:${redemption.id}:package:${index}`,
            { entitlementId: allocation.entitlementId, serviceId: allocation.serviceId }
        );
    }

    private async redeemComboAllocations(
        client: PoolClient,
        salonId: string,
        redemption: WalletRedemptionRow,
        allocations: WalletAllocation[],
        actorAccountId: string,
        index: number
    ) {
        const entitlementId = allocations[0]?.entitlementId;
        if (!entitlementId || allocations.some((allocation) => !allocation.serviceId)) {
            throw new ApiError(409, 'Combo redemption is missing its service selection');
        }
        const entitlement = await client.query<{
            requestId: string;
            servicesSnapshot: Array<{ serviceId: string }>;
        }>(
            `SELECT purchase.purchase_request_id AS "requestId",
                    request.services_snapshot AS "servicesSnapshot"
             FROM customer_combo_purchases AS purchase
             JOIN salon_offer_purchase_requests AS request
               ON request.id = purchase.purchase_request_id
              AND request.salon_id = purchase.salon_id
             WHERE purchase.id = $1 AND purchase.salon_id = $2
               AND purchase.customer_account_id = $3
               AND purchase.payment_status = 'PAID'
               AND purchase.status = 'ACTIVE'
               AND purchase.expires_at > CURRENT_TIMESTAMP
             FOR UPDATE OF purchase`,
            [entitlementId, salonId, redemption.customerAccountId]
        );
        const active = entitlement.rows[0];
        if (!active) throw new ApiError(409, 'Active combo entitlement was not found');
        const expected = active.servicesSnapshot.map(({ serviceId }) => serviceId).sort();
        const actual = allocations.map((allocation) => allocation.serviceId as string).sort();
        if (
            expected.length !== actual.length ||
            expected.some((serviceId, serviceIndex) => serviceId !== actual[serviceIndex])
        ) {
            throw new ApiError(409, 'Every service in a combo must be redeemed together');
        }
        const updated = await client.query(
            `UPDATE customer_combo_purchases SET status = 'USED'
             WHERE id = $1 AND salon_id = $2 AND status = 'ACTIVE'`,
            [entitlementId, salonId]
        );
        if (!updated.rowCount) throw new ApiError(409, 'Combo was already redeemed');
        for (const allocation of allocations) {
            await client.query(
                `UPDATE pos_bill_items SET is_covered_by_plan = TRUE
                 WHERE id = $1 AND bill_id = $2 AND salon_id = $3 AND removed_at IS NULL`,
                [allocation.billItemId, redemption.billId, salonId]
            );
        }
        const amount = roundMoney(allocations.reduce((sum, allocation) => sum + allocation.amount, 0));
        await client.query(
            `INSERT INTO salon_offer_ledger (
                salon_id, customer_account_id, purchase_request_id, entry_type,
                amount, bill_id, idempotency_key, metadata
             ) VALUES ($1, $2, $3, 'COMBO_REDEMPTION', 0, $4, $5, $6::jsonb)`,
            [
                salonId, redemption.customerAccountId, active.requestId, redemption.billId,
                `pos-wallet:${redemption.id}:combo:${index}`,
                JSON.stringify({
                    comboPurchaseId: entitlementId,
                    serviceIds: expected,
                    billItemIds: allocations.map(({ billItemId }) => billItemId),
                    redemptionId: redemption.id,
                }),
            ]
        );
        await this.insertWalletPayment(
            client, salonId, redemption, actorAccountId,
            'PLAN', 'COMBO', amount,
            `pos-wallet:${redemption.id}:combo:${index}`,
            { comboPurchaseId: entitlementId, serviceIds: expected }
        );
    }

    private async redeemLoyaltyAllocation(
        client: PoolClient,
        salonId: string,
        redemption: WalletRedemptionRow,
        amount: number,
        actorAccountId: string,
        index: number
    ) {
        const idempotencyKey = `pos-wallet:${redemption.id}:loyalty:${index}`;
        await client.query(
            `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
            [`${redemption.customerAccountId}:${salonId}:pos-wallet`]
        );
        const otherReservations = await client.query<{ amount: string }>(
            `SELECT COALESCE(SUM((item.value->>'amount')::numeric), 0)::text AS amount
             FROM pos_wallet_redemptions AS other
             CROSS JOIN LATERAL jsonb_array_elements(other.allocation) AS item(value)
             WHERE other.customer_account_id = $1 AND other.salon_id = $2
               AND other.id <> $3
               AND other.status IN ('OTP_PENDING', 'OTP_VERIFIED')
               AND other.expires_at > CURRENT_TIMESTAMP
               AND item.value->>'type' = 'LOYALTY'`,
            [redemption.customerAccountId, salonId, redemption.id]
        );
        const availableValue = await this.loyalty.getAvailableRedemptionValue(
            client,
            redemption.customerAccountId,
            salonId
        );
        if (availableValue - Number(otherReservations.rows[0].amount) < amount) {
            throw new ApiError(409, 'Loyalty point balance is insufficient or reserved');
        }
        const pointsSpent = await this.loyalty.redeemForPos(
            client,
            redemption.customerAccountId,
            salonId,
            redemption.billId,
            amount,
            idempotencyKey
        );
        await this.insertWalletPayment(
            client, salonId, redemption, actorAccountId,
            'POINTS', 'LOYALTY', amount,
            idempotencyKey,
            { redemptionId: redemption.id, pointsSpent }
        );
    }

    private async insertWalletPayment(
        client: PoolClient,
        salonId: string,
        redemption: WalletRedemptionRow,
        actorAccountId: string,
        paymentMode: 'PLAN' | 'POINTS',
        sourceType: 'PACKAGE' | 'COMBO' | 'LOYALTY',
        amount: number,
        idempotencyKey: string,
        metadata: Record<string, unknown>
    ) {
        const payment = await client.query<{ id: string }>(
            `INSERT INTO pos_payments (
                session_id, salon_id, bill_id, payment_mode, source_type,
                amount, status, recorded_by_account_id, approved_by_account_id,
                idempotency_key
             )
             SELECT session_id, salon_id, id, $3, $4, $5, 'SUCCESS', $6, $6, $7
             FROM pos_bills WHERE id = $1 AND salon_id = $2
             RETURNING id`,
            [
                redemption.billId, salonId, paymentMode, sourceType,
                amount, actorAccountId, idempotencyKey,
            ]
        );
        if (!payment.rows[0]) throw new ApiError(404, 'POS bill was not found');
        await client.query(
            `INSERT INTO pos_payment_events (
                payment_id, salon_id, event_type, actor_account_id, metadata
             ) VALUES ($1, $2, 'APPROVED', $3, $4::jsonb)`,
            [payment.rows[0].id, salonId, actorAccountId, JSON.stringify(metadata)]
        );
    }

    private async withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const result = await operation(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}
