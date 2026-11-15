import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { pool } from '../../bootstrap/db.connect.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import type { PaymentProvider } from '../../integrations/payments/platform-payment-gateway.js';
import type { B2BInvoice } from './platform_billing.types.js';

export type { PaymentProvider } from '../../integrations/payments/platform-payment-gateway.js';

interface GstSettings {
    enabled: boolean;
    sellerGstin: string | null;
    sellerStateCode: string | null;
    ratePercent: number;
}

interface PaymentSetup {
    paymentId: string;
    invoiceId: string;
    invoiceNumber: string;
    salonId: string;
    organizationId: string;
    amount: number;
    allocations: Array<{
        invoiceId: string;
        invoiceNumber: string;
        salonId: string;
        amount: number;
    }>;
    providerReference?: string;
    checkoutUrl?: string | null;
    expiresAt?: Date | null;
    publicKey?: string | null;
}

interface WebhookResult {
    eventId: string;
    eventType: string;
    provider: PaymentProvider;
    providerReference: string;
    paymentId?: string;
    success: boolean;
    amount?: number;
    currency?: string;
}

interface AddonPurchaseSetup {
    purchaseId: string;
    salonId: string;
    addonId: string;
    activationMode: 'IMMEDIATE_PRORATED' | 'NEXT_CYCLE';
    status: 'SCHEDULED' | 'PENDING_PAYMENT' | 'ACTIVE' | 'CANCELLED';
    amount: number;
    effectiveAt: string;
    invoiceId: string | null;
}

interface InvoiceRow extends QueryResultRow {
    id: string;
    organizationId: string;
    salonId: string;
    invoiceNumber: string;
    amount: string;
    billingPeriodStart: Date;
    billingPeriodEnd: Date;
    status: string;
    createdAt: Date;
    paidAt: Date | null;
    subtotal?: string;
    taxAmount?: string;
    taxType?: string;
    cgstAmount?: string;
    sgstAmount?: string;
    igstAmount?: string;
    gstNumber?: string | null;
    sellerGstin?: string | null;
    sellerStateCode?: string | null;
    buyerStateCode?: string | null;
    currency?: string;
    invoiceKind?: string;
}

export class PlatformBillingRepository {
    async getSubscription(salonId: string) {
        const result = await pool.query<{
            id: string;
            organizationId: string;
            salonId: string;
            planId: string;
            planType: string;
            status: string;
            startDate: Date;
            endDate: Date;
            monthlyFee: string;
        }>(
            `SELECT subscription.id,
                    subscription.organization_id AS "organizationId",
                    subscription.salon_id AS "salonId",
                    subscription.plan_id AS "planId",
                    plan.key AS "planType",
                    subscription.status,
                    subscription.billing_cycle_start AS "startDate",
                    subscription.billing_cycle_end AS "endDate",
                    plan.monthly_price::text AS "monthlyFee"
             FROM platform_subscriptions AS subscription
             JOIN platform_plan_catalog AS plan ON plan.id = subscription.plan_id
             WHERE subscription.salon_id = $1
               AND subscription.status = 'ACTIVE'
               AND subscription.billing_cycle_start <= CURRENT_DATE
               AND subscription.billing_cycle_end >= CURRENT_DATE
             ORDER BY subscription.billing_cycle_end DESC
             LIMIT 1`,
            [salonId]
        );
        const row = result.rows[0];
        return row ? { ...row, monthlyFee: Number(row.monthlyFee) } : null;
    }

    async createInvoice(salonId: string, periodStart: Date, periodEnd: Date): Promise<B2BInvoice> {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const salonLock = await client.query(
                'SELECT id FROM salons WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
                [salonId]
            );
            if (!salonLock.rowCount) throw new ApiError(404, 'Salon not found');
            const existing = await client.query<InvoiceRow>(
                `SELECT id, organization_id AS "organizationId", salon_id AS "salonId",
                        invoice_kind AS "invoiceKind",
                        invoice_number AS "invoiceNumber", total_amount::text AS amount,
                        billing_period_start AS "billingPeriodStart",
                        billing_period_end AS "billingPeriodEnd", status,
                        created_at AS "createdAt", paid_at AS "paidAt",
                        subtotal::text AS subtotal, tax_amount::text AS "taxAmount",
                        tax_type AS "taxType", cgst_amount::text AS "cgstAmount",
                        sgst_amount::text AS "sgstAmount", igst_amount::text AS "igstAmount",
                        gst_number AS "gstNumber", seller_gstin AS "sellerGstin",
                        seller_state_code AS "sellerStateCode",
                        buyer_state_code AS "buyerStateCode", currency
                 FROM platform_salon_invoices
                 WHERE salon_id = $1 AND billing_period_start = $2 AND billing_period_end = $3
                   AND invoice_kind = 'SUBSCRIPTION'
                 FOR UPDATE`,
                [salonId, periodStart, periodEnd]
            );
            if (existing.rows[0]) {
                await client.query('COMMIT');
                return this.toInvoice(existing.rows[0]);
            }

            const subscriptionResult = await client.query<{
                organizationId: string;
                name: string;
                monthlyPrice: string;
            }>(
                `SELECT subscription.organization_id AS "organizationId",
                        plan.name,
                        plan.monthly_price::text AS "monthlyPrice"
                 FROM platform_subscriptions AS subscription
                 JOIN platform_plan_catalog AS plan ON plan.id = subscription.plan_id
                 WHERE subscription.salon_id = $1
                   AND subscription.status = 'ACTIVE'
                   AND subscription.billing_cycle_start <= $3
                   AND subscription.billing_cycle_end >= $2
                 ORDER BY subscription.billing_cycle_end DESC
                 LIMIT 1
                 FOR SHARE OF subscription, plan`,
                [salonId, periodStart, periodEnd]
            );
            const subscription = subscriptionResult.rows[0];
            if (!subscription) throw new ApiError(404, 'Salon has no active subscription for this billing period');

            const profileResult = await client.query<{
                gstin: string | null;
                stateCode: string;
            }>(
                `SELECT profile.gstin, profile.state_code AS "stateCode"
                 FROM salon_billing_profiles AS profile
                 WHERE profile.salon_id = $1
                 FOR SHARE`,
                [salonId]
            );
            const settingsResult = await client.query<{
                enabled: boolean;
                sellerGstin: string | null;
                sellerStateCode: string | null;
                ratePercent: string;
            }>(
                `SELECT is_enabled AS enabled, seller_gstin AS "sellerGstin",
                        seller_state_code AS "sellerStateCode", rate_percent::text AS "ratePercent"
                 FROM platform_gst_settings WHERE id = 1 FOR SHARE`
            );
            const gstSettings = this.toGstSettings(settingsResult.rows[0]);
            const buyer = profileResult.rows[0];
            if (gstSettings.enabled && !buyer) {
                throw new ApiError(409, 'Set the salon billing state before creating a GST invoice');
            }

            const addonResult = await client.query<{
                purchaseId: string | null;
                addonId: string;
                name: string;
                amount: string;
            }>(
                `SELECT NULL::uuid AS "purchaseId", addon.id AS "addonId",
                        addon.name, addon.price::text AS amount
                 FROM platform_salon_addons AS salon_addon
                 JOIN platform_addons AS addon ON addon.id = salon_addon.addon_id
                 WHERE salon_addon.salon_id = $1
                   AND salon_addon.status = 'ACTIVE'
                   AND addon.is_active = TRUE
                   AND addon.is_recurring = TRUE
                   AND EXISTS (
                       SELECT 1 FROM platform_addon_purchases AS purchase
                       WHERE purchase.salon_id = salon_addon.salon_id
                         AND purchase.addon_id = salon_addon.addon_id
                         AND purchase.status = 'ACTIVE'
                         AND purchase.effective_at < $2
                   )
                 UNION ALL
                 SELECT purchase.id AS "purchaseId", addon.id AS "addonId",
                        addon.name, purchase.amount::text AS amount
                 FROM platform_addon_purchases AS purchase
                 JOIN platform_addons AS addon ON addon.id = purchase.addon_id
                 WHERE purchase.salon_id = $1
                   AND purchase.status = 'SCHEDULED'
                   AND purchase.activation_mode = 'NEXT_CYCLE'
                   AND purchase.effective_at BETWEEN $2 AND $3
                 ORDER BY "addonId", "purchaseId"`,
                [salonId, periodStart, periodEnd]
            );
            const items = [
                {
                    itemType: 'BASE_PLAN',
                    description: `${subscription.name} subscription`,
                    amount: this.roundCurrency(Number(subscription.monthlyPrice)),
                    purchaseId: null as string | null,
                },
                ...addonResult.rows.map((addon) => ({
                    itemType: 'ADDON',
                    description: `${addon.name} add-on`,
                    amount: this.roundCurrency(Number(addon.amount)),
                    purchaseId: addon.purchaseId,
                })),
            ];
            const subtotal = this.roundCurrency(items.reduce((sum, item) => sum + item.amount, 0));
            const itemsWithTax = items.map((item) => ({
                ...item,
                taxAmount: gstSettings.enabled
                    ? this.roundCurrency(item.amount * gstSettings.ratePercent / 100)
                    : 0,
            }));
            const taxAmount = this.roundCurrency(
                itemsWithTax.reduce((sum, item) => sum + item.taxAmount, 0)
            );
            const localSupply = gstSettings.enabled
                && buyer?.stateCode === gstSettings.sellerStateCode;
            const cgstAmount = localSupply ? this.roundCurrency(taxAmount / 2) : 0;
            const sgstAmount = localSupply ? this.roundCurrency(taxAmount - cgstAmount) : 0;
            const igstAmount = gstSettings.enabled && !localSupply ? taxAmount : 0;
            const taxType = !gstSettings.enabled
                ? 'NONE'
                : localSupply ? 'CGST_SGST' : 'IGST';
            const invoiceId = randomUUID();
            const invoiceNumber = `SALONIX-${Date.now()}-${invoiceId.slice(0, 8).toUpperCase()}`;
            const totalAmount = this.roundCurrency(subtotal + taxAmount);
            if (totalAmount > 9_999_999_999.99) {
                throw new ApiError(400, 'Invoice total exceeds the supported amount');
            }
            const invoiceResult = await client.query<InvoiceRow>(
                `INSERT INTO platform_salon_invoices (
                    id, organization_id, salon_id, invoice_kind, invoice_number, billing_period_start,
                    billing_period_end, gst_number, subtotal, tax_amount, total_amount,
                    seller_gstin, seller_state_code, buyer_state_code, tax_type,
                    cgst_amount, sgst_amount, igst_amount, currency, status
                 ) VALUES (
                    $1, $2, $3, 'SUBSCRIPTION', $4, $5, $6, $7, $8, $9, $10, $11,
                    $12, $13, $14, $15, $16, $17, 'INR', 'UNPAID'
                 )
                 RETURNING id, organization_id AS "organizationId", salon_id AS "salonId",
                           invoice_kind AS "invoiceKind",
                           invoice_number AS "invoiceNumber", total_amount::text AS amount,
                           billing_period_start AS "billingPeriodStart",
                           billing_period_end AS "billingPeriodEnd", status,
                            created_at AS "createdAt", paid_at AS "paidAt",
                            subtotal::text AS subtotal, tax_amount::text AS "taxAmount",
                            tax_type AS "taxType", cgst_amount::text AS "cgstAmount",
                            sgst_amount::text AS "sgstAmount", igst_amount::text AS "igstAmount",
                            gst_number AS "gstNumber", seller_gstin AS "sellerGstin",
                            seller_state_code AS "sellerStateCode",
                            buyer_state_code AS "buyerStateCode", currency`,
                [
                    invoiceId,
                    subscription.organizationId,
                    salonId,
                    invoiceNumber,
                    periodStart,
                    periodEnd,
                    buyer?.gstin ?? null,
                    subtotal,
                    taxAmount,
                    totalAmount,
                    gstSettings.enabled ? gstSettings.sellerGstin : null,
                    gstSettings.enabled ? gstSettings.sellerStateCode : null,
                    buyer?.stateCode ?? null,
                    taxType,
                    cgstAmount,
                    sgstAmount,
                    igstAmount,
                ]
            );
            for (const item of itemsWithTax) {
                await client.query(
                    `INSERT INTO platform_salon_invoice_items
                        (invoice_id, item_type, description, amount, tax_amount)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [invoiceId, item.itemType, item.description, item.amount, item.taxAmount]
                );
                if (item.purchaseId) {
                    await client.query(
                        `UPDATE platform_addon_purchases
                         SET status = 'PENDING_PAYMENT', invoice_id = $2
                         WHERE id = $1 AND status = 'SCHEDULED'`,
                        [item.purchaseId, invoiceId]
                    );
                }
            }
            await client.query('COMMIT');
            const row = invoiceResult.rows[0];
            return {
                ...this.toInvoice(row),
                subtotal: Number(row.subtotal),
                taxAmount: Number(row.taxAmount),
                taxType: row.taxType as B2BInvoice['taxType'],
                cgstAmount: Number(row.cgstAmount),
                sgstAmount: Number(row.sgstAmount),
                igstAmount: Number(row.igstAmount),
                buyerGstin: row.gstNumber ?? null,
                sellerGstin: row.sellerGstin ?? null,
                sellerStateCode: row.sellerStateCode ?? null,
                buyerStateCode: row.buyerStateCode ?? null,
                currency: row.currency ?? 'INR',
            };
        } catch (error) {
            await this.rollback(client);
            if (this.isUniqueViolation(error)) {
                const existing = await this.getInvoiceByPeriod(salonId, periodStart, periodEnd);
                if (existing) return existing;
            }
            throw error;
        } finally {
            client.release();
        }
    }

    async listInvoices(salonId: string): Promise<B2BInvoice[]> {
        const result = await pool.query<InvoiceRow>(
            `SELECT id, organization_id AS "organizationId", salon_id AS "salonId",
                    invoice_kind AS "invoiceKind",
                    invoice_number AS "invoiceNumber", total_amount::text AS amount,
                    billing_period_start AS "billingPeriodStart",
                    billing_period_end AS "billingPeriodEnd", status,
                    created_at AS "createdAt", paid_at AS "paidAt",
                    subtotal::text AS subtotal, tax_amount::text AS "taxAmount",
                    tax_type AS "taxType", cgst_amount::text AS "cgstAmount",
                    sgst_amount::text AS "sgstAmount", igst_amount::text AS "igstAmount",
                    gst_number AS "gstNumber", seller_gstin AS "sellerGstin",
                    seller_state_code AS "sellerStateCode",
                    buyer_state_code AS "buyerStateCode", currency
             FROM platform_salon_invoices
             WHERE salon_id = $1
             ORDER BY created_at DESC
             LIMIT 100`,
            [salonId]
        );
        return result.rows.map((row) => ({
            ...this.toInvoice(row),
            subtotal: Number(row.subtotal),
            taxAmount: Number(row.taxAmount),
            taxType: row.taxType as B2BInvoice['taxType'],
            cgstAmount: Number(row.cgstAmount),
            sgstAmount: Number(row.sgstAmount),
            igstAmount: Number(row.igstAmount),
            buyerGstin: row.gstNumber ?? null,
            sellerGstin: row.sellerGstin ?? null,
            sellerStateCode: row.sellerStateCode ?? null,
            buyerStateCode: row.buyerStateCode ?? null,
            currency: row.currency ?? 'INR',
        }));
    }

    async createAddonPurchase(
        salonId: string,
        addonId: string,
        activationMode: 'IMMEDIATE_PRORATED' | 'NEXT_CYCLE',
        idempotencyKey: string
    ): Promise<AddonPurchaseSetup> {
        const key = idempotencyKey.trim();
        if (key.length < 8 || key.length > 255) {
            throw new ApiError(400, 'A valid Idempotency-Key header is required');
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const salonResult = await client.query<{ organizationId: string }>(
                `SELECT organization_id AS "organizationId"
                 FROM salons
                 WHERE id = $1 AND deleted_at IS NULL
                 FOR UPDATE`,
                [salonId]
            );
            const organizationId = salonResult.rows[0]?.organizationId;
            if (!organizationId) throw new ApiError(404, 'Salon not found');
            await client.query(
                'SELECT id FROM salon_organizations WHERE id = $1 FOR UPDATE',
                [organizationId]
            );
            const scopedIdempotencyKey = this.hashIdempotencyKey(organizationId, key);

            const retry = await client.query<{
                purchaseId: string;
                salonId: string;
                addonId: string;
                activationMode: AddonPurchaseSetup['activationMode'];
                status: AddonPurchaseSetup['status'];
                amount: string;
                effectiveAt: string;
                invoiceId: string | null;
            }>(
                `SELECT id AS "purchaseId", salon_id AS "salonId", addon_id AS "addonId",
                        activation_mode AS "activationMode", status,
                        amount::text AS amount, effective_at::text AS "effectiveAt",
                        invoice_id AS "invoiceId"
                 FROM platform_addon_purchases
                 WHERE organization_id = $1 AND idempotency_key = $2
                 FOR UPDATE`,
                [organizationId, scopedIdempotencyKey]
            );
            if (retry.rows[0]) {
                const purchase = retry.rows[0];
                if (
                    purchase.salonId !== salonId ||
                    purchase.addonId !== addonId ||
                    purchase.activationMode !== activationMode
                ) {
                    throw new ApiError(409, 'Idempotency key was already used for a different add-on purchase');
                }
                await client.query('COMMIT');
                return {
                    ...purchase,
                    amount: Number(purchase.amount),
                };
            }

            const addonResult = await client.query<{
                name: string;
                price: string;
                isRecurring: boolean;
            }>(
                `SELECT name, price::text AS price, is_recurring AS "isRecurring"
                 FROM platform_addons
                 WHERE id = $1 AND is_active = TRUE
                 FOR SHARE`,
                [addonId]
            );
            const addon = addonResult.rows[0];
            if (!addon) throw new ApiError(404, 'Active platform add-on was not found');
            if (!addon.isRecurring) {
                throw new ApiError(409, 'Billing-cycle purchase options are only available for recurring add-ons');
            }
            const activeAddon = await client.query(
                `SELECT id FROM platform_salon_addons
                 WHERE salon_id = $1 AND addon_id = $2 AND status = 'ACTIVE'
                 FOR UPDATE`,
                [salonId, addonId]
            );
            if (activeAddon.rowCount) throw new ApiError(409, 'This add-on is already active for the salon');
            const pendingPurchase = await client.query(
                `SELECT id FROM platform_addon_purchases
                 WHERE salon_id = $1 AND addon_id = $2
                   AND status IN ('SCHEDULED', 'PENDING_PAYMENT')
                 FOR UPDATE`,
                [salonId, addonId]
            );
            if (pendingPurchase.rowCount) {
                throw new ApiError(409, 'This add-on already has a pending purchase');
            }

            const subscriptionResult = await client.query<{
                billingCycleStart: string;
                billingCycleEnd: string;
                today: string;
            }>(
                `SELECT billing_cycle_start::text AS "billingCycleStart",
                        billing_cycle_end::text AS "billingCycleEnd",
                        CURRENT_DATE::text AS today
                 FROM platform_subscriptions
                 WHERE salon_id = $1 AND status = 'ACTIVE'
                   AND billing_cycle_start <= CURRENT_DATE
                   AND billing_cycle_end >= CURRENT_DATE
                 ORDER BY billing_cycle_end DESC
                 LIMIT 1
                 FOR UPDATE`,
                [salonId]
            );
            const subscription = subscriptionResult.rows[0];
            if (!subscription) throw new ApiError(404, 'Salon has no active billing cycle');

            const monthlyPrice = this.roundCurrency(Number(addon.price));
            if (!Number.isFinite(monthlyPrice) || monthlyPrice <= 0) {
                throw new ApiError(409, 'Add-on price must be greater than zero');
            }
            const purchaseId = randomUUID();
            if (activationMode === 'NEXT_CYCLE') {
                const effectiveAt = new Date(
                    Date.parse(`${subscription.billingCycleEnd}T00:00:00.000Z`) + 86_400_000
                ).toISOString().slice(0, 10);
                const existingInvoice = await client.query(
                    `SELECT id FROM platform_salon_invoices
                     WHERE salon_id = $1 AND billing_period_start = $2
                       AND invoice_kind = 'SUBSCRIPTION'
                     LIMIT 1`,
                    [salonId, effectiveAt]
                );
                if (existingInvoice.rowCount) {
                    throw new ApiError(409, 'The next-cycle invoice already exists; choose immediate prorated billing');
                }
                const result = await client.query<{
                    status: AddonPurchaseSetup['status'];
                    effectiveAt: string;
                }>(
                    `INSERT INTO platform_addon_purchases (
                        id, organization_id, salon_id, addon_id, activation_mode,
                        status, amount, effective_at, idempotency_key
                     ) VALUES ($1, $2, $3, $4, 'NEXT_CYCLE', 'SCHEDULED', $5, $6, $7)
                     RETURNING status, effective_at::text AS "effectiveAt"`,
                    [
                        purchaseId,
                        organizationId,
                        salonId,
                        addonId,
                        monthlyPrice,
                        effectiveAt,
                        scopedIdempotencyKey,
                    ]
                );
                await client.query('COMMIT');
                return {
                    purchaseId,
                    salonId,
                    addonId,
                    activationMode,
                    status: result.rows[0].status,
                    amount: monthlyPrice,
                    effectiveAt: result.rows[0].effectiveAt,
                    invoiceId: null,
                };
            }

            const startDate = Date.parse(`${subscription.billingCycleStart}T00:00:00.000Z`);
            const todayDate = Date.parse(`${subscription.today}T00:00:00.000Z`);
            const endDate = Date.parse(`${subscription.billingCycleEnd}T00:00:00.000Z`);
            const cycleDays = Math.floor((endDate - startDate) / 86_400_000) + 1;
            const remainingDays = Math.floor((endDate - todayDate) / 86_400_000) + 1;
            if (cycleDays <= 0 || remainingDays <= 0 || todayDate < startDate || todayDate > endDate) {
                throw new ApiError(409, 'The active billing cycle dates are invalid');
            }
            const amount = this.roundCurrency(monthlyPrice * remainingDays / cycleDays);
            if (amount <= 0) throw new ApiError(409, 'Prorated add-on amount must be greater than zero');

            const profileResult = await client.query<{ gstin: string | null; stateCode: string }>(
                `SELECT gstin, state_code AS "stateCode"
                 FROM salon_billing_profiles WHERE salon_id = $1 FOR SHARE`,
                [salonId]
            );
            const settingsResult = await client.query<{
                enabled: boolean;
                sellerGstin: string | null;
                sellerStateCode: string | null;
                ratePercent: string;
            }>(
                `SELECT is_enabled AS enabled, seller_gstin AS "sellerGstin",
                        seller_state_code AS "sellerStateCode", rate_percent::text AS "ratePercent"
                 FROM platform_gst_settings WHERE id = 1 FOR SHARE`
            );
            const gstSettings = this.toGstSettings(settingsResult.rows[0]);
            const buyer = profileResult.rows[0];
            if (gstSettings.enabled && !buyer) {
                throw new ApiError(409, 'Set the salon billing state before purchasing a taxable add-on');
            }
            const taxAmount = gstSettings.enabled
                ? this.roundCurrency(amount * gstSettings.ratePercent / 100)
                : 0;
            const localSupply = gstSettings.enabled
                && buyer?.stateCode === gstSettings.sellerStateCode;
            const taxType = !gstSettings.enabled ? 'NONE' : localSupply ? 'CGST_SGST' : 'IGST';
            const cgstAmount = localSupply ? this.roundCurrency(taxAmount / 2) : 0;
            const sgstAmount = localSupply ? this.roundCurrency(taxAmount - cgstAmount) : 0;
            const igstAmount = gstSettings.enabled && !localSupply ? taxAmount : 0;
            const totalAmount = this.roundCurrency(amount + taxAmount);
            if (totalAmount > 9_999_999_999.99) {
                throw new ApiError(400, 'Add-on invoice total exceeds the supported amount');
            }
            const invoiceId = randomUUID();
            const invoiceNumber = `SALONIX-${Date.now()}-${invoiceId.slice(0, 8).toUpperCase()}`;
            const invoiceResult = await client.query<InvoiceRow>(
                `INSERT INTO platform_salon_invoices (
                    id, organization_id, salon_id, invoice_kind, invoice_number,
                    billing_period_start, billing_period_end, gst_number, subtotal,
                    tax_amount, total_amount, seller_gstin, seller_state_code,
                    buyer_state_code, tax_type, cgst_amount, sgst_amount, igst_amount,
                    currency, status
                 ) VALUES (
                    $1, $2, $3, 'ADDON_ADJUSTMENT', $4, $5, $6, $7, $8, $9, $10,
                    $11, $12, $13, $14, $15, $16, $17, 'INR', 'UNPAID'
                 )
                 RETURNING id, organization_id AS "organizationId", salon_id AS "salonId",
                           invoice_kind AS "invoiceKind", invoice_number AS "invoiceNumber",
                           total_amount::text AS amount,
                           billing_period_start AS "billingPeriodStart",
                           billing_period_end AS "billingPeriodEnd", status,
                           created_at AS "createdAt", paid_at AS "paidAt",
                           subtotal::text AS subtotal, tax_amount::text AS "taxAmount",
                           tax_type AS "taxType", cgst_amount::text AS "cgstAmount",
                           sgst_amount::text AS "sgstAmount", igst_amount::text AS "igstAmount",
                           gst_number AS "gstNumber", seller_gstin AS "sellerGstin",
                           seller_state_code AS "sellerStateCode",
                           buyer_state_code AS "buyerStateCode", currency`,
                [
                    invoiceId,
                    organizationId,
                    salonId,
                    invoiceNumber,
                    subscription.today,
                    subscription.billingCycleEnd,
                    buyer?.gstin ?? null,
                    amount,
                    taxAmount,
                    totalAmount,
                    gstSettings.enabled ? gstSettings.sellerGstin : null,
                    gstSettings.enabled ? gstSettings.sellerStateCode : null,
                    buyer?.stateCode ?? null,
                    taxType,
                    cgstAmount,
                    sgstAmount,
                    igstAmount,
                ]
            );
            await client.query(
                `INSERT INTO platform_salon_invoice_items
                    (invoice_id, item_type, description, amount, tax_amount)
                 VALUES ($1, 'ADDON', $2, $3, $4)`,
                [
                    invoiceId,
                    `${addon.name} add-on, prorated ${remainingDays}/${cycleDays} days`,
                    amount,
                    taxAmount,
                ]
            );
            await client.query(
                `INSERT INTO platform_addon_purchases (
                    id, organization_id, salon_id, addon_id, invoice_id,
                    activation_mode, status, amount, effective_at, idempotency_key
                 ) VALUES ($1, $2, $3, $4, $5, 'IMMEDIATE_PRORATED',
                           'PENDING_PAYMENT', $6, $7, $8)`,
                [
                    purchaseId,
                    organizationId,
                    salonId,
                    addonId,
                    invoiceId,
                    amount,
                    subscription.today,
                    scopedIdempotencyKey,
                ]
            );
            const invoice = invoiceResult.rows[0];
            if (!invoice) throw new ApiError(500, 'Add-on adjustment invoice was not created');
            await client.query('COMMIT');
            return {
                purchaseId,
                salonId,
                addonId,
                activationMode,
                status: 'PENDING_PAYMENT',
                amount,
                effectiveAt: subscription.today,
                invoiceId,
            };
        } catch (error) {
            await this.rollback(client);
            throw error;
        } finally {
            client.release();
        }
    }

    async updateSalonBillingProfile(
        salonId: string,
        stateCode: string,
        gstin: string | null,
        actorId: string
    ) {
        const result = await pool.query(
            `INSERT INTO salon_billing_profiles (salon_id, state_code, gstin, updated_by_account_id)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (salon_id) DO UPDATE SET
                state_code = EXCLUDED.state_code,
                gstin = EXCLUDED.gstin,
                updated_by_account_id = EXCLUDED.updated_by_account_id,
                updated_at = CURRENT_TIMESTAMP
             RETURNING salon_id AS "salonId", state_code AS "stateCode",
                       gstin, updated_at AS "updatedAt"`,
            [salonId, stateCode, gstin, actorId]
        );
        return result.rows[0];
    }

    async getSalonBillingProfile(salonId: string) {
        const result = await pool.query(
            `SELECT salon_id AS "salonId", state_code AS "stateCode", gstin,
                    updated_at AS "updatedAt"
             FROM salon_billing_profiles WHERE salon_id = $1`,
            [salonId]
        );
        return result.rows[0] ?? null;
    }

    async getPlatformGstSettings() {
        const result = await pool.query(
            `SELECT is_enabled AS enabled, seller_gstin AS "sellerGstin",
                    seller_state_code AS "sellerStateCode", rate_percent::text AS "ratePercent",
                    updated_at AS "updatedAt"
             FROM platform_gst_settings WHERE id = 1`
        );
        const row = result.rows[0];
        return row ? { ...row, ratePercent: Number(row.ratePercent) } : {
            enabled: false,
            sellerGstin: null,
            sellerStateCode: null,
            ratePercent: 0,
            updatedAt: null,
        };
    }

    async updatePlatformGstSettings(input: GstSettings, actorId: string) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const previous = await client.query(
                `SELECT is_enabled AS enabled, seller_gstin AS "sellerGstin",
                        seller_state_code AS "sellerStateCode", rate_percent::text AS "ratePercent"
                 FROM platform_gst_settings WHERE id = 1 FOR UPDATE`
            );
            const result = await client.query(
                `INSERT INTO platform_gst_settings (
                    id, is_enabled, seller_gstin, seller_state_code, rate_percent, updated_by_account_id
                 ) VALUES (1, $1, $2, $3, $4, $5)
                 ON CONFLICT (id) DO UPDATE SET
                    is_enabled = EXCLUDED.is_enabled,
                    seller_gstin = EXCLUDED.seller_gstin,
                    seller_state_code = EXCLUDED.seller_state_code,
                    rate_percent = EXCLUDED.rate_percent,
                    updated_by_account_id = EXCLUDED.updated_by_account_id,
                    updated_at = CURRENT_TIMESTAMP
                 RETURNING is_enabled AS enabled, seller_gstin AS "sellerGstin",
                           seller_state_code AS "sellerStateCode",
                           rate_percent::text AS "ratePercent", updated_at AS "updatedAt"`,
                [
                    input.enabled,
                    input.enabled ? input.sellerGstin : null,
                    input.enabled ? input.sellerStateCode : null,
                    input.enabled ? input.ratePercent : 0,
                    actorId,
                ]
            );
            await client.query(
                `INSERT INTO audit_logs (
                    actor_account_id, actor_context, action, resource_type, resource_id, changes
                 ) VALUES ($1, 'ADMIN', 'PLATFORM_GST_SETTINGS_UPDATED',
                           'PLATFORM_GST_SETTINGS', '1', $2::jsonb)`,
                [
                    actorId,
                    JSON.stringify({
                        before: previous.rows[0] ?? null,
                        after: {
                            enabled: result.rows[0].enabled,
                            sellerGstin: result.rows[0].sellerGstin,
                            sellerStateCode: result.rows[0].sellerStateCode,
                            ratePercent: Number(result.rows[0].ratePercent),
                        },
                    }),
                ]
            );
            await client.query('COMMIT');
            return { ...result.rows[0], ratePercent: Number(result.rows[0].ratePercent) };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async createPayment(salonId: string, invoiceId: string, provider: PaymentProvider): Promise<PaymentSetup> {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const invoiceResult = await client.query<{
                id: string;
                organizationId: string;
                salonId: string;
                invoiceNumber: string;
                totalAmount: string;
                status: string;
                remainingAmount: string;
            }>(
                `SELECT id, organization_id AS "organizationId", salon_id AS "salonId",
                        invoice_number AS "invoiceNumber", total_amount::text AS "totalAmount", status,
                        GREATEST(
                            platform_salon_invoices.total_amount - COALESCE((
                                SELECT SUM(link.amount_applied)
                                FROM platform_consolidated_bill_invoices AS link
                                JOIN platform_consolidated_bills AS bill
                                  ON bill.id = link.consolidated_bill_id
                                WHERE link.invoice_id = platform_salon_invoices.id
                                  AND bill.status = 'PAID'
                            ), 0),
                            0
                        )::text AS "remainingAmount"
                 FROM platform_salon_invoices
                 WHERE id = $1 AND salon_id = $2
                 FOR UPDATE`,
                [invoiceId, salonId]
            );
            const invoice = invoiceResult.rows[0];
            if (!invoice) throw new ApiError(404, 'Invoice not found');
            if (!['UNPAID', 'PARTIAL'].includes(invoice.status)) {
                throw new ApiError(409, 'Invoice is not available for payment');
            }

            await client.query(
                `UPDATE platform_payments
                 SET status = 'FAILED', completed_at = CURRENT_TIMESTAMP
                 WHERE status = 'PENDING' AND provider = 'STRIPE'
                   AND expires_at <= CURRENT_TIMESTAMP
                   AND consolidated_bill_id IN (
                       SELECT consolidated_bill_id FROM platform_consolidated_bill_invoices
                       WHERE invoice_id = $1
                   )`,
                [invoiceId]
            );
            await client.query(
                `UPDATE platform_consolidated_bills AS bill
                 SET status = 'FAILED'
                 WHERE bill.id IN (
                    SELECT link.consolidated_bill_id
                    FROM platform_consolidated_bill_invoices AS link
                    WHERE link.invoice_id = $1
                 )
                   AND bill.status = 'PENDING'
                   AND NOT EXISTS (
                       SELECT 1 FROM platform_payments AS payment
                       WHERE payment.consolidated_bill_id = bill.id AND payment.status = 'PENDING'
                   )`,
                [invoiceId]
            );
            const activePayment = await client.query<{
                id: string;
                provider: string;
                providerReference: string | null;
                checkoutUrl: string | null;
            }>(
                `SELECT payment.id, payment.provider,
                        payment.provider_reference AS "providerReference",
                        payment.checkout_url AS "checkoutUrl"
                 FROM platform_payments AS payment
                 JOIN platform_consolidated_bill_invoices AS link
                   ON link.consolidated_bill_id = payment.consolidated_bill_id
                 WHERE link.invoice_id = $1 AND payment.status = 'PENDING'
                   AND (
                       payment.provider = 'RAZORPAY'
                       OR (payment.provider = 'STRIPE' AND payment.expires_at > CURRENT_TIMESTAMP)
                   )
                 LIMIT 1`,
                [invoiceId]
            );
            const active = activePayment.rows[0];
            if (active) {
                if (active.provider !== provider || !active.providerReference) {
                    throw new ApiError(409, 'A payment checkout is already pending for this invoice');
                }
                await client.query('COMMIT');
                return {
                    paymentId: active.id,
                    invoiceId: invoice.id,
                    invoiceNumber: invoice.invoiceNumber,
                    salonId: invoice.salonId,
                    organizationId: invoice.organizationId,
                    amount: Number(invoice.remainingAmount),
                    allocations: [{
                        invoiceId: invoice.id,
                        invoiceNumber: invoice.invoiceNumber,
                        salonId: invoice.salonId,
                        amount: Number(invoice.remainingAmount),
                    }],
                    providerReference: active.providerReference,
                    checkoutUrl: active.checkoutUrl,
                };
            }
            const amount = Number(invoice.remainingAmount);
            if (!Number.isFinite(amount) || amount <= 0) {
                throw new ApiError(409, 'Invoice total must be positive before payment');
            }
            const billResult = await client.query<{ id: string }>(
                `INSERT INTO platform_consolidated_bills (organization_id, total_amount, status)
                 VALUES ($1, $2, 'PENDING')
                 RETURNING id`,
                [invoice.organizationId, amount]
            );
            const consolidatedBillId = billResult.rows[0].id;
            await client.query(
                `INSERT INTO platform_consolidated_bill_invoices
                    (consolidated_bill_id, organization_id, invoice_id, amount_applied)
                 VALUES ($1, $2, $3, $4)`,
                [consolidatedBillId, invoice.organizationId, invoice.id, amount]
            );
            const paymentId = randomUUID();
            await client.query(
                `INSERT INTO platform_payments (
                    id, consolidated_bill_id, amount, payment_method, provider, currency, expires_at
                 ) VALUES (
                    $1, $2, $3, $4, $4, 'INR',
                    CASE WHEN $4 = 'STRIPE' THEN CURRENT_TIMESTAMP + INTERVAL '30 minutes' ELSE NULL END
                 )`,
                [paymentId, consolidatedBillId, amount, provider]
            );
            await client.query('COMMIT');
            return {
                paymentId,
                invoiceId: invoice.id,
                invoiceNumber: invoice.invoiceNumber,
                salonId: invoice.salonId,
                organizationId: invoice.organizationId,
                amount,
                allocations: [{
                    invoiceId: invoice.id,
                    invoiceNumber: invoice.invoiceNumber,
                    salonId: invoice.salonId,
                    amount,
                }],
            };
        } catch (error) {
            await this.rollback(client);
            throw error;
        } finally {
            client.release();
        }
    }

    async createConsolidatedPayment(
        organizationId: string,
        invoiceIds: string[],
        provider: PaymentProvider,
        idempotencyKey: string
    ): Promise<PaymentSetup> {
        idempotencyKey = idempotencyKey.trim();
        const normalizedInvoiceIds = invoiceIds.map((invoiceId) => invoiceId.toLowerCase());
        const sortedInvoiceIds = [...new Set(normalizedInvoiceIds)].sort();
        if (
            sortedInvoiceIds.length === 0 ||
            sortedInvoiceIds.length !== invoiceIds.length ||
            sortedInvoiceIds.length > 50
        ) {
            throw new ApiError(400, 'Provide between 1 and 50 unique invoice IDs');
        }
        if (idempotencyKey.trim().length < 8 || idempotencyKey.length > 255) {
            throw new ApiError(400, 'A valid payment idempotency key is required');
        }
        const scopedIdempotencyKey = this.hashIdempotencyKey(organizationId, idempotencyKey);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
                [scopedIdempotencyKey]
            );
            const retry = await client.query<{
                id: string;
                organizationId: string;
                provider: string;
                status: string;
                providerReference: string | null;
                checkoutUrl: string | null;
                expiresAt: Date | null;
            }>(
                `SELECT payment.id, bill.organization_id AS "organizationId",
                        payment.provider, payment.status,
                        payment.provider_reference AS "providerReference",
                        payment.checkout_url AS "checkoutUrl",
                        payment.expires_at AS "expiresAt"
                 FROM platform_payments AS payment
                 JOIN platform_consolidated_bills AS bill
                   ON bill.id = payment.consolidated_bill_id
                 WHERE payment.idempotency_key = $1
                 FOR UPDATE OF payment, bill`,
                [scopedIdempotencyKey]
            );
            if (retry.rows[0]) {
                const payment = retry.rows[0];
                const priorAllocations = await client.query<{
                    invoiceId: string;
                    invoiceNumber: string;
                    salonId: string;
                    amount: string;
                }>(
                    `SELECT invoice.id AS "invoiceId", invoice.invoice_number AS "invoiceNumber",
                            invoice.salon_id AS "salonId", link.amount_applied::text AS amount
                     FROM platform_consolidated_bill_invoices AS link
                     JOIN platform_salon_invoices AS invoice ON invoice.id = link.invoice_id
                     JOIN platform_payments AS payment
                       ON payment.consolidated_bill_id = link.consolidated_bill_id
                     WHERE payment.id = $1
                     ORDER BY invoice.id`,
                    [payment.id]
                );
                if (
                    payment.organizationId !== organizationId ||
                    payment.provider !== provider ||
                    priorAllocations.rows.map(({ invoiceId }) => invoiceId).join(',') !==
                        sortedInvoiceIds.join(',')
                ) {
                    throw new ApiError(409, 'Idempotency key was already used for a different payment request');
                }
                await client.query('COMMIT');
                return this.toPaymentSetup(
                    payment.id,
                    organizationId,
                    priorAllocations.rows.map((row) => ({
                        ...row,
                        amount: Number(row.amount),
                    })),
                    payment.providerReference,
                    payment.checkoutUrl,
                    payment.expiresAt
                );
            }

            await client.query(
                `UPDATE platform_payments
                 SET status = 'FAILED', completed_at = CURRENT_TIMESTAMP
                 WHERE status = 'PENDING'
                   AND (
                       (provider = 'STRIPE' AND expires_at <= CURRENT_TIMESTAMP)
                       OR (provider_reference IS NULL
                           AND created_at <= CURRENT_TIMESTAMP - INTERVAL '15 minutes')
                   )
                   AND consolidated_bill_id IN (
                       SELECT link.consolidated_bill_id
                       FROM platform_consolidated_bill_invoices AS link
                       JOIN platform_salon_invoices AS invoice ON invoice.id = link.invoice_id
                       WHERE invoice.organization_id = $1
                         AND link.invoice_id = ANY($2::uuid[])
                   )`,
                [organizationId, sortedInvoiceIds]
            );
            await client.query(
                `UPDATE platform_consolidated_bills AS bill
                 SET status = 'FAILED'
                 WHERE bill.status = 'PENDING'
                   AND bill.id IN (
                       SELECT link.consolidated_bill_id
                       FROM platform_consolidated_bill_invoices AS link
                       JOIN platform_salon_invoices AS invoice ON invoice.id = link.invoice_id
                       WHERE invoice.organization_id = $1
                         AND link.invoice_id = ANY($2::uuid[])
                   )
                   AND NOT EXISTS (
                       SELECT 1 FROM platform_payments AS payment
                       WHERE payment.consolidated_bill_id = bill.id AND payment.status = 'PENDING'
                   )`,
                [organizationId, sortedInvoiceIds]
            );

            const invoiceResult = await client.query<{
                id: string;
                organizationId: string;
                salonId: string;
                invoiceNumber: string;
                status: string;
                remainingAmount: string;
            }>(
                `SELECT invoice.id, invoice.organization_id AS "organizationId",
                        invoice.salon_id AS "salonId",
                        invoice.invoice_number AS "invoiceNumber", invoice.status,
                        GREATEST(
                            invoice.total_amount - COALESCE((
                                SELECT SUM(link.amount_applied)
                                FROM platform_consolidated_bill_invoices AS link
                                JOIN platform_consolidated_bills AS bill
                                  ON bill.id = link.consolidated_bill_id
                                WHERE link.invoice_id = invoice.id AND bill.status = 'PAID'
                            ), 0),
                            0
                        )::text AS "remainingAmount"
                 FROM platform_salon_invoices AS invoice
                 WHERE invoice.organization_id = $1
                   AND invoice.id = ANY($2::uuid[])
                 ORDER BY invoice.id
                 FOR UPDATE OF invoice`,
                [organizationId, sortedInvoiceIds]
            );
            if (invoiceResult.rows.length !== sortedInvoiceIds.length) {
                throw new ApiError(404, 'One or more invoices were not found in this organization');
            }
            if (invoiceResult.rows.some((invoice) => !['UNPAID', 'PARTIAL'].includes(invoice.status))) {
                throw new ApiError(409, 'Every invoice must be unpaid or partially paid');
            }

            const allocations = invoiceResult.rows.map((invoice) => ({
                invoiceId: invoice.id,
                invoiceNumber: invoice.invoiceNumber,
                salonId: invoice.salonId,
                amount: Number(invoice.remainingAmount),
            }));
            if (allocations.some(({ amount }) => !Number.isFinite(amount) || amount <= 0)) {
                throw new ApiError(409, 'Every selected invoice must have an outstanding balance');
            }
            const amount = this.roundCurrency(
                allocations.reduce((sum, allocation) => sum + allocation.amount, 0)
            );
            if (amount > 9_999_999_999.99) {
                throw new ApiError(400, 'Consolidated payment exceeds the supported amount');
            }
            const activeResult = await client.query<{
                id: string;
                provider: string;
                providerReference: string | null;
                checkoutUrl: string | null;
                expiresAt: Date | null;
                invoiceIds: string[];
                amounts: string[];
            }>(
                `SELECT payment.id, payment.provider,
                        payment.provider_reference AS "providerReference",
                        payment.checkout_url AS "checkoutUrl",
                        payment.expires_at AS "expiresAt",
                        ARRAY(
                            SELECT link.invoice_id::text
                            FROM platform_consolidated_bill_invoices AS link
                            WHERE link.consolidated_bill_id = payment.consolidated_bill_id
                            ORDER BY link.invoice_id
                        ) AS "invoiceIds",
                        ARRAY(
                            SELECT link.amount_applied::text
                            FROM platform_consolidated_bill_invoices AS link
                            WHERE link.consolidated_bill_id = payment.consolidated_bill_id
                            ORDER BY link.invoice_id
                        ) AS amounts
                 FROM platform_payments AS payment
                 WHERE payment.status = 'PENDING'
                   AND payment.consolidated_bill_id IN (
                       SELECT link.consolidated_bill_id
                       FROM platform_consolidated_bill_invoices AS link
                       WHERE link.invoice_id = ANY($1::uuid[])
                   )
                 ORDER BY payment.created_at
                 LIMIT 1
                 FOR UPDATE OF payment`,
                [sortedInvoiceIds]
            );
            const active = activeResult.rows[0];
            if (active) {
                if (
                    active.provider !== provider ||
                    active.invoiceIds.join(',') !== sortedInvoiceIds.join(',')
                ) {
                    throw new ApiError(409, 'A payment checkout is already pending for a selected invoice');
                }
                await client.query('COMMIT');
                return this.toPaymentSetup(
                    active.id,
                    organizationId,
                    allocations.map((allocation, index) => ({
                        ...allocation,
                        amount: Number(active.amounts[index]),
                    })),
                    active.providerReference,
                    active.checkoutUrl,
                    active.expiresAt
                );
            }

            const consolidatedBill = await client.query<{ id: string }>(
                `INSERT INTO platform_consolidated_bills (organization_id, total_amount, status)
                 VALUES ($1, $2, 'PENDING')
                 RETURNING id`,
                [organizationId, amount]
            );
            for (const allocation of allocations) {
                await client.query(
                    `INSERT INTO platform_consolidated_bill_invoices
                        (consolidated_bill_id, organization_id, invoice_id, amount_applied)
                     VALUES ($1, $2, $3, $4)`,
                    [
                        consolidatedBill.rows[0].id,
                        organizationId,
                        allocation.invoiceId,
                        allocation.amount,
                    ]
                );
            }
            const paymentId = randomUUID();
            await client.query(
                `INSERT INTO platform_payments (
                    id, consolidated_bill_id, amount, payment_method, provider,
                    currency, expires_at, idempotency_key
                 ) VALUES (
                    $1, $2, $3, $4, $4, 'INR',
                    CASE WHEN $4 = 'STRIPE' THEN CURRENT_TIMESTAMP + INTERVAL '30 minutes' ELSE NULL END,
                    $5
                 )`,
                [paymentId, consolidatedBill.rows[0].id, amount, provider, scopedIdempotencyKey]
            );
            await client.query('COMMIT');
            return this.toPaymentSetup(paymentId, organizationId, allocations);
        } catch (error) {
            await this.rollback(client);
            throw error;
        } finally {
            client.release();
        }
    }

    async createConsolidatedPaymentForSalon(
        salonId: string,
        invoiceIds: string[],
        provider: PaymentProvider,
        idempotencyKey: string
    ): Promise<PaymentSetup> {
        const result = await pool.query<{ organizationId: string }>(
            `SELECT organization_id AS "organizationId"
             FROM salons
             WHERE id = $1 AND deleted_at IS NULL`,
            [salonId]
        );
        const organizationId = result.rows[0]?.organizationId;
        if (!organizationId) throw new ApiError(404, 'Salon not found');
        return this.createConsolidatedPayment(
            organizationId,
            invoiceIds,
            provider,
            idempotencyKey
        );
    }

    private toPaymentSetup(
        paymentId: string,
        organizationId: string,
        allocations: PaymentSetup['allocations'],
        providerReference?: string | null,
        checkoutUrl?: string | null,
        expiresAt?: Date | null
    ): PaymentSetup {
        const first = allocations[0];
        if (!first) throw new ApiError(500, 'Consolidated payment has no invoice allocation');
        return {
            paymentId,
            invoiceId: first.invoiceId,
            invoiceNumber: first.invoiceNumber,
            salonId: first.salonId,
            organizationId,
            amount: this.roundCurrency(allocations.reduce((sum, row) => sum + row.amount, 0)),
            allocations,
            providerReference: providerReference ?? undefined,
            checkoutUrl,
            expiresAt,
        };
    }

    async saveCheckoutDetails(
        paymentId: string,
        providerReference: string,
        checkoutUrl: string | null,
        expiresAt: Date | null
    ) {
        const result = await pool.query(
            `UPDATE platform_payments
             SET provider_reference = $2, checkout_url = $3, expires_at = $4,
                 checkout_claimed_at = NULL
             WHERE id = $1 AND status = 'PENDING'
               AND (provider_reference IS NULL OR provider_reference = $2)`,
            [paymentId, providerReference, checkoutUrl, expiresAt]
        );
        if (!result.rowCount) throw new ApiError(409, 'Payment checkout is no longer pending');
    }

    async claimCheckoutCreation(paymentId: string): Promise<boolean> {
        const result = await pool.query(
            `UPDATE platform_payments
             SET checkout_claimed_at = CURRENT_TIMESTAMP
             WHERE id = $1
               AND status = 'PENDING'
               AND provider_reference IS NULL
               AND (
                   checkout_claimed_at IS NULL
                   OR checkout_claimed_at <= CURRENT_TIMESTAMP - INTERVAL '2 minutes'
               )
             RETURNING id`,
            [paymentId]
        );
        return result.rowCount === 1;
    }

    async getPaymentForReconciliation(paymentId: string) {
        const result = await pool.query<{
            id: string;
            provider: PaymentProvider | null;
            providerReference: string | null;
            status: string;
        }>(
            `SELECT id, provider, provider_reference AS "providerReference", status
             FROM platform_payments
             WHERE id = $1`,
            [paymentId]
        );
        const payment = result.rows[0];
        if (!payment) throw new ApiError(404, 'Platform payment was not found');
        return payment;
    }

    async failPaymentSetup(paymentId: string) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query<{ consolidatedBillId: string }>(
                `UPDATE platform_payments
                 SET status = 'FAILED', completed_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND status = 'PENDING'
                 RETURNING consolidated_bill_id AS "consolidatedBillId"`,
                [paymentId]
            );
            if (result.rows[0]) {
                await client.query(
                    `UPDATE platform_consolidated_bills
                     SET status = 'FAILED'
                     WHERE id = $1 AND status = 'PENDING'
                       AND NOT EXISTS (
                           SELECT 1 FROM platform_payments
                           WHERE consolidated_bill_id = $1 AND status = 'PENDING'
                       )`,
                    [result.rows[0].consolidatedBillId]
                );
            }
            await client.query('COMMIT');
        } catch (error) {
            await this.rollback(client);
            throw error;
        } finally {
            client.release();
        }
    }

    async processWebhook(input: WebhookResult): Promise<boolean> {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const event = await client.query(
                `INSERT INTO platform_payment_webhook_events (provider, event_id, event_type)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (provider, event_id) DO NOTHING
                 RETURNING id`,
                [input.provider, input.eventId, input.eventType]
            );
            if (!event.rowCount) {
                await client.query('COMMIT');
                return false;
            }

            const paymentResult = await client.query<{
                id: string;
                amount: string;
                currency: string;
                provider: string;
                status: string;
                providerReference: string | null;
                consolidatedBillId: string;
                organizationId: string;
                billAmount: string;
            }>(
                `SELECT payment.id, payment.amount::text AS amount, payment.currency,
                        payment.provider, payment.status,
                        payment.provider_reference AS "providerReference",
                        bill.id AS "consolidatedBillId",
                        bill.organization_id AS "organizationId",
                        bill.total_amount::text AS "billAmount"
                 FROM platform_payments AS payment
                 JOIN platform_consolidated_bills AS bill
                   ON bill.id = payment.consolidated_bill_id
                 WHERE payment.provider_reference = $2
                   AND payment.provider = $3
                   AND ($1::text IS NULL OR payment.id::text = $1)
                 FOR UPDATE OF payment, bill`,
                [input.paymentId ?? null, input.providerReference, input.provider]
            );
            const payment = paymentResult.rows[0];
            if (!payment || payment.providerReference !== input.providerReference) {
                throw new ApiError(400, 'Webhook does not match a known payment');
            }
            if (input.amount !== undefined && Math.round(input.amount * 100) !== Math.round(Number(payment.amount) * 100)) {
                throw new ApiError(400, 'Webhook payment amount does not match the payment');
            }
            if (input.currency && input.currency.toUpperCase() !== payment.currency) {
                throw new ApiError(400, 'Webhook payment currency does not match the payment');
            }
            if (Number(payment.billAmount) !== Number(payment.amount)) {
                throw new ApiError(409, 'Payment amount does not match the consolidated bill');
            }
            if (
                payment.status !== 'PENDING' &&
                !(payment.status === 'FAILED' && input.success)
            ) {
                await client.query('COMMIT');
                return false;
            }

            if (input.success) {
                const allocationResult = await client.query<{
                    invoiceId: string;
                    salonId: string;
                    amount: string;
                }>(
                    `SELECT link.invoice_id AS "invoiceId",
                            invoice.salon_id AS "salonId",
                            link.amount_applied::text AS amount
                     FROM platform_consolidated_bill_invoices AS link
                     JOIN platform_salon_invoices AS invoice ON invoice.id = link.invoice_id
                     WHERE link.consolidated_bill_id = $1
                     ORDER BY invoice.id
                     FOR UPDATE OF invoice`,
                    [payment.consolidatedBillId]
                );
                const allocations = allocationResult.rows;
                const allocatedAmount = this.roundCurrency(
                    allocations.reduce((sum, allocation) => sum + Number(allocation.amount), 0)
                );
                if (!allocations.length || allocatedAmount !== Number(payment.amount)) {
                    throw new ApiError(409, 'Payment allocations do not match the captured payment amount');
                }
                await client.query(
                    `UPDATE platform_payments
                     SET status = 'SUCCESS', completed_at = CURRENT_TIMESTAMP
                     WHERE id = $1`,
                    [payment.id]
                );
                await client.query(
                    `UPDATE platform_consolidated_bills
                     SET status = 'PAID', paid_at = CURRENT_TIMESTAMP
                     WHERE id = $1`,
                    [payment.consolidatedBillId]
                );
                for (const allocation of allocations) {
                    const appliedAmount = Number(allocation.amount);
                    await client.query(
                        `UPDATE platform_salon_invoices AS invoice
                         SET status = CASE
                               WHEN invoice.total_amount <= (
                                   SELECT COALESCE(SUM(link.amount_applied), 0)
                                   FROM platform_consolidated_bill_invoices AS link
                                   JOIN platform_consolidated_bills AS bill
                                     ON bill.id = link.consolidated_bill_id
                                   WHERE link.invoice_id = invoice.id AND bill.status = 'PAID'
                               ) THEN 'PAID'
                               ELSE 'PARTIAL'
                             END,
                             paid_at = CASE
                               WHEN invoice.total_amount <= (
                                   SELECT COALESCE(SUM(link.amount_applied), 0)
                                   FROM platform_consolidated_bill_invoices AS link
                                   JOIN platform_consolidated_bills AS bill
                                     ON bill.id = link.consolidated_bill_id
                                   WHERE link.invoice_id = invoice.id AND bill.status = 'PAID'
                               ) THEN CURRENT_TIMESTAMP
                               ELSE NULL
                             END
                         WHERE invoice.id = $1`,
                        [allocation.invoiceId]
                    );
                    await client.query(
                        `INSERT INTO platform_financial_ledger
                            (organization_id, salon_id, transaction_type, amount, reason, invoice_id)
                         VALUES ($1, $2, 'CREDIT', $3, $4, $5)`,
                        [
                            payment.organizationId,
                            allocation.salonId,
                            appliedAmount,
                            `Invoice paid through ${input.provider}`,
                            allocation.invoiceId,
                        ]
                    );
                    const activated = await client.query<{
                        salonId: string;
                        addonId: string;
                    }>(
                        `UPDATE platform_addon_purchases AS purchase
                         SET status = 'ACTIVE'
                         FROM platform_salon_invoices AS invoice
                         WHERE purchase.invoice_id = invoice.id
                           AND invoice.id = $1
                           AND invoice.status = 'PAID'
                           AND purchase.status = 'PENDING_PAYMENT'
                         RETURNING purchase.salon_id AS "salonId",
                                   purchase.addon_id AS "addonId"`,
                        [allocation.invoiceId]
                    );
                    for (const purchase of activated.rows) {
                        await client.query(
                            `INSERT INTO platform_salon_addons
                                (salon_id, addon_id, status, activated_at, cancelled_at)
                             VALUES ($1, $2, 'ACTIVE', CURRENT_TIMESTAMP, NULL)
                             ON CONFLICT (salon_id, addon_id)
                             DO UPDATE SET status = 'ACTIVE',
                                           activated_at = CURRENT_TIMESTAMP,
                                           cancelled_at = NULL`,
                            [purchase.salonId, purchase.addonId]
                        );
                    }
                }
            } else {
                await client.query(
                    `UPDATE platform_payments
                     SET status = 'FAILED', completed_at = CURRENT_TIMESTAMP
                     WHERE id = $1`,
                    [payment.id]
                );
                await client.query(
                    `UPDATE platform_consolidated_bills
                     SET status = 'FAILED'
                     WHERE id = $1 AND status = 'PENDING'
                       AND NOT EXISTS (
                           SELECT 1 FROM platform_payments
                           WHERE consolidated_bill_id = $1 AND status = 'PENDING'
                       )`,
                    [payment.consolidatedBillId]
                );
            }
            await client.query('COMMIT');
            return true;
        } catch (error) {
            await this.rollback(client);
            throw error;
        } finally {
            client.release();
        }
    }

    private async getInvoiceByPeriod(salonId: string, periodStart: Date, periodEnd: Date) {
        const result = await pool.query<InvoiceRow>(
            `SELECT id, organization_id AS "organizationId", salon_id AS "salonId",
                    invoice_kind AS "invoiceKind",
                    invoice_number AS "invoiceNumber", total_amount::text AS amount,
                    billing_period_start AS "billingPeriodStart",
                    billing_period_end AS "billingPeriodEnd", status,
                    created_at AS "createdAt", paid_at AS "paidAt",
                    subtotal::text AS subtotal, tax_amount::text AS "taxAmount",
                    tax_type AS "taxType", cgst_amount::text AS "cgstAmount",
                    sgst_amount::text AS "sgstAmount", igst_amount::text AS "igstAmount",
                    gst_number AS "gstNumber", seller_gstin AS "sellerGstin",
                    seller_state_code AS "sellerStateCode",
                    buyer_state_code AS "buyerStateCode", currency
             FROM platform_salon_invoices
             WHERE salon_id = $1 AND billing_period_start = $2 AND billing_period_end = $3
               AND invoice_kind = 'SUBSCRIPTION'`,
            [salonId, periodStart, periodEnd]
        );
        return result.rows[0] ? this.toInvoice(result.rows[0]) : null;
    }

    private toGstSettings(row?: {
        enabled: boolean;
        sellerGstin: string | null;
        sellerStateCode: string | null;
        ratePercent: string;
    }): GstSettings {
        return row ? {
            enabled: row.enabled,
            sellerGstin: row.sellerGstin,
            sellerStateCode: row.sellerStateCode,
            ratePercent: Number(row.ratePercent),
        } : {
            enabled: false,
            sellerGstin: null,
            sellerStateCode: null,
            ratePercent: 0,
        };
    }

    private toInvoice(row: InvoiceRow): B2BInvoice {
        return {
            id: row.id,
            organizationId: row.organizationId,
            salonId: row.salonId,
            ...(row.invoiceKind === undefined
                ? {}
                : { invoiceKind: row.invoiceKind as B2BInvoice['invoiceKind'] }),
            invoiceNumber: row.invoiceNumber,
            amount: Number(row.amount),
            billingPeriodStart: row.billingPeriodStart,
            billingPeriodEnd: row.billingPeriodEnd,
            status: row.status,
            createdAt: row.createdAt,
            paidAt: row.paidAt ?? undefined,
            ...(row.subtotal === undefined ? {} : { subtotal: Number(row.subtotal) }),
            ...(row.taxAmount === undefined ? {} : { taxAmount: Number(row.taxAmount) }),
            ...(row.taxType === undefined ? {} : { taxType: row.taxType as B2BInvoice['taxType'] }),
            ...(row.cgstAmount === undefined ? {} : { cgstAmount: Number(row.cgstAmount) }),
            ...(row.sgstAmount === undefined ? {} : { sgstAmount: Number(row.sgstAmount) }),
            ...(row.igstAmount === undefined ? {} : { igstAmount: Number(row.igstAmount) }),
            ...(row.gstNumber === undefined ? {} : { buyerGstin: row.gstNumber }),
            ...(row.sellerGstin === undefined ? {} : { sellerGstin: row.sellerGstin }),
            ...(row.sellerStateCode === undefined ? {} : { sellerStateCode: row.sellerStateCode }),
            ...(row.buyerStateCode === undefined ? {} : { buyerStateCode: row.buyerStateCode }),
            ...(row.currency === undefined ? {} : { currency: row.currency }),
        };
    }

    private roundCurrency(value: number) {
        return Math.round((value + Number.EPSILON) * 100) / 100;
    }

    private hashIdempotencyKey(organizationId: string, key: string) {
        return createHash('sha256')
            .update(`${organizationId}:${key.trim()}`)
            .digest('hex');
    }

    private async rollback(client: PoolClient) {
        await client.query('ROLLBACK');
    }

    private isUniqueViolation(error: unknown) {
        return typeof error === 'object'
            && error !== null
            && 'code' in error
            && error.code === '23505';
    }
}
