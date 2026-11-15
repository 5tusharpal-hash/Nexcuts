import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import { PlatformPaymentGateway } from '../../integrations/payments/platform-payment-gateway.js';
import { PlatformBillingRepository } from './platform_billing.repository.js';
import type { PaymentProvider } from './platform_billing.repository.js';
import type {
    PlatformAddonPurchaseRequest,
    PlatformAddonPurchaseResponse,
    PlatformConsolidatedCheckoutResponse,
} from './platform_billing.types.js';

const stripeEventSchema = z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    data: z.object({
        object: z.object({
            id: z.string().min(1),
            metadata: z.record(z.string(), z.string()).optional(),
            client_reference_id: z.string().nullable().optional(),
            payment_status: z.string().optional(),
            amount_total: z.number().optional(),
            currency: z.string().optional(),
        }).passthrough(),
    }),
});

const razorpayEventSchema = z.object({
    event: z.string().min(1),
    payload: z.object({
        payment: z.object({
            entity: z.object({
                id: z.string().min(1).optional(),
                order_id: z.string().min(1).nullable().optional(),
                amount: z.number().nullable().optional(),
                currency: z.string().nullable().optional(),
            }).passthrough().optional(),
        }).optional(),
        order: z.object({
            entity: z.object({
                id: z.string().min(1).optional(),
                amount_paid: z.number().nullable().optional(),
                currency: z.string().nullable().optional(),
            }).passthrough().optional(),
        }).optional(),
    }),
});

export class PlatformBillingService {
    constructor(
        private readonly repository: PlatformBillingRepository,
        private readonly paymentGateway = new PlatformPaymentGateway()
    ) {}

    async processMonthlyBilling(salonId: string) {
        const subscription = await this.repository.getSubscription(salonId);
        if (!subscription) throw new ApiError(404, 'Salon has no active subscription');
        return this.repository.createInvoice(
            salonId,
            subscription.startDate,
            subscription.endDate
        );
    }

    async listInvoices(salonId: string) {
        return this.repository.listInvoices(salonId);
    }

    async checkSubscriptionStatus(salonId: string): Promise<boolean> {
        const subscription = await this.repository.getSubscription(salonId);
        return !!subscription && subscription.status === 'ACTIVE';
    }

    async createCheckout(
        salonId: string,
        invoiceId: string,
        provider: PaymentProvider,
        idempotencyKey: string
    ) {
        return this.createConsolidatedCheckout(salonId, [invoiceId], provider, idempotencyKey);
    }

    async createConsolidatedCheckout(
        salonId: string,
        invoiceIds: string[],
        provider: PaymentProvider,
        idempotencyKey: string
    ): Promise<PlatformConsolidatedCheckoutResponse> {
        if (provider === 'STRIPE') {
            if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
                throw new ApiError(503, 'Stripe billing is not configured');
            }
            if (!env.PLATFORM_BILLING_RETURN_URL) {
                throw new ApiError(503, 'Stripe billing return URL is not configured');
            }
        } else if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !env.RAZORPAY_WEBHOOK_SECRET) {
            throw new ApiError(503, 'Razorpay billing is not configured');
        }

        const setup = await this.repository.createConsolidatedPaymentForSalon(
            salonId,
            invoiceIds,
            provider,
            idempotencyKey
        );
        let providerReference = setup.providerReference;
        let checkoutUrl = setup.checkoutUrl ?? null;
        let expiresAt = setup.expiresAt ?? null;
        if (!providerReference) {
            const claimed = await this.repository.claimCheckoutCreation(setup.paymentId);
            if (!claimed) {
                throw new ApiError(409, 'Payment checkout is being created; retry with the same Idempotency-Key');
            }
            const checkout = await this.paymentGateway.createCheckout(provider, {
                paymentId: setup.paymentId,
                organizationId: setup.organizationId,
                invoiceNumbers: setup.allocations.map(({ invoiceNumber }) => invoiceNumber),
                amount: setup.amount,
            });
            providerReference = checkout.providerReference;
            checkoutUrl = checkout.checkoutUrl;
            expiresAt = checkout.expiresAt;
            await this.repository.saveCheckoutDetails(
                setup.paymentId,
                providerReference,
                checkoutUrl,
                expiresAt
            );
        }
        if (provider === 'STRIPE' && !checkoutUrl) {
            throw new ApiError(409, 'Stripe checkout URL is unavailable for the pending payment');
        }

        const allocations = setup.allocations.map((allocation) => ({
            ...allocation,
            amount: Number(allocation.amount.toFixed(2)),
        }));
        const response = {
            provider,
            paymentId: setup.paymentId,
            organizationId: setup.organizationId,
            invoiceId: setup.invoiceId,
            invoiceNumber: setup.invoiceNumber,
            invoiceIds: allocations.map(({ invoiceId }) => invoiceId),
            invoiceNumbers: allocations.map(({ invoiceNumber }) => invoiceNumber),
            allocations,
            amount: setup.amount,
            currency: 'INR' as const,
            ...(expiresAt ? { expiresAt } : {}),
        };
        if (provider === 'STRIPE') {
            return { ...response, checkoutUrl, sessionId: providerReference };
        }
        const keyId = env.RAZORPAY_KEY_ID;
        if (!keyId) throw new ApiError(503, 'Razorpay billing is not configured');
        return {
            ...response,
            keyId,
            orderId: providerReference,
            amountMinor: Math.round(setup.amount * 100),
        };
    }

    async purchaseAddon(
        salonId: string,
        addonId: string,
        input: PlatformAddonPurchaseRequest,
        idempotencyKey: string
    ): Promise<PlatformAddonPurchaseResponse> {
        const purchase = await this.repository.createAddonPurchase(
            salonId,
            addonId,
            input.activationMode,
            idempotencyKey
        );
        if (purchase.status !== 'PENDING_PAYMENT' || !purchase.invoiceId || !input.provider) {
            return purchase;
        }
        const checkout = await this.createConsolidatedCheckout(
            salonId,
            [purchase.invoiceId],
            input.provider,
            idempotencyKey
        );
        return { ...purchase, checkout };
    }

    async reconcilePayment(paymentId: string) {
        const payment = await this.repository.getPaymentForReconciliation(paymentId);
        if (payment.status === 'SUCCESS' || payment.status === 'REFUNDED') {
            return { paymentId, status: payment.status, processed: false };
        }
        if (!payment.provider || !payment.providerReference) {
            throw new ApiError(409, 'Payment has no provider checkout to reconcile');
        }
        const providerStatus = await this.paymentGateway.getPaymentStatus(
            payment.provider,
            payment.providerReference
        );
        if (providerStatus.status === 'PENDING') {
            return { paymentId, status: providerStatus.status, processed: false };
        }
        if (
            providerStatus.status === 'SUCCESS' &&
            (providerStatus.amount === null || !providerStatus.currency)
        ) {
            throw new ApiError(502, 'Provider status response is missing amount or currency');
        }
        const processed = await this.repository.processWebhook({
            eventId: `reconciliation:${payment.id}:${providerStatus.status}`,
            eventType: `reconciliation.${providerStatus.status.toLowerCase()}`,
            provider: payment.provider,
            providerReference: payment.providerReference,
            paymentId: payment.id,
            success: providerStatus.status === 'SUCCESS',
            ...(providerStatus.amount === null ? {} : { amount: providerStatus.amount }),
            ...(providerStatus.currency === null ? {} : { currency: providerStatus.currency }),
        });
        return { paymentId, status: providerStatus.status, processed };
    }

    async processStripeWebhook(rawBody: Buffer, signature: string | undefined) {
        if (!env.STRIPE_WEBHOOK_SECRET) {
            throw new ApiError(503, 'Stripe webhook verification is not configured');
        }
        this.verifyStripeSignature(rawBody, signature);
        let parsed: unknown;
        try {
            parsed = JSON.parse(rawBody.toString('utf8'));
        } catch {
            throw new ApiError(400, 'Stripe webhook body is invalid JSON');
        }
        const event = stripeEventSchema.parse(parsed);
        const session = event.data.object;
        const succeeded = event.type === 'checkout.session.completed'
            || event.type === 'checkout.session.async_payment_succeeded';
        const failed = event.type === 'checkout.session.async_payment_failed'
            || event.type === 'checkout.session.expired';
        if (!succeeded && !failed) return false;
        if (succeeded && session.payment_status !== 'paid') return false;
        if (succeeded && (session.amount_total === undefined || !session.currency)) {
            throw new ApiError(400, 'Stripe checkout event is missing its amount or currency');
        }
        const paymentId = session.metadata?.payment_id ?? session.client_reference_id ?? undefined;
        return this.repository.processWebhook({
            eventId: event.id,
            eventType: event.type,
            provider: 'STRIPE',
            providerReference: session.id,
            paymentId,
            success: succeeded,
            amount: session.amount_total === undefined ? undefined : session.amount_total / 100,
            currency: session.currency,
        });
    }

    async processRazorpayWebhook(
        rawBody: Buffer,
        signature: string | undefined,
        providerEventId?: string
    ) {
        if (!env.RAZORPAY_WEBHOOK_SECRET) {
            throw new ApiError(503, 'Razorpay webhook verification is not configured');
        }
        this.verifyRazorpaySignature(rawBody, signature);
        let parsed: unknown;
        try {
            parsed = JSON.parse(rawBody.toString('utf8'));
        } catch {
            throw new ApiError(400, 'Razorpay webhook body is invalid JSON');
        }
        const event = razorpayEventSchema.parse(parsed);
        const payment = event.payload.payment?.entity;
        const order = event.payload.order?.entity;
        const success = event.event === 'payment.captured' || event.event === 'order.paid';
        const failed = event.event === 'payment.failed';
        if (!success && !failed) return false;
        const reference = payment?.order_id ?? order?.id;
        if (!reference) throw new ApiError(400, 'Razorpay webhook has no order reference');
        const amount = payment?.amount ?? order?.amount_paid;
        const currency = payment?.currency ?? order?.currency;
        if (success && (amount == null || !currency)) {
            throw new ApiError(400, 'Razorpay payment event is missing its amount or currency');
        }
        return this.repository.processWebhook({
            eventId: providerEventId?.trim() || (
                payment?.id
                    ? `${event.event}:${payment.id}`
                    : `${event.event}:${reference}`
            ),
            eventType: event.event,
            provider: 'RAZORPAY',
            providerReference: reference,
            success,
            ...(amount == null ? {} : { amount: amount / 100 }),
            ...(currency ? { currency } : {}),
        });
    }

    private verifyStripeSignature(rawBody: Buffer, header: string | undefined) {
        if (!header) throw new ApiError(400, 'Stripe signature header is missing');
        const parts = header.split(',').map((part) => part.split('='));
        const timestamp = parts.find(([key]) => key === 't')?.[1];
        const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
        if (!timestamp || signatures.length === 0 || !/^\d+$/.test(timestamp)) {
            throw new ApiError(400, 'Stripe signature header is invalid');
        }
        if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
            throw new ApiError(400, 'Stripe webhook timestamp is outside the allowed window');
        }
        const expected = createHmac('sha256', env.STRIPE_WEBHOOK_SECRET!)
            .update(`${timestamp}.${rawBody.toString('utf8')}`)
            .digest();
        const valid = signatures.some((signature) => {
            if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
            return timingSafeEqual(Buffer.from(signature, 'hex'), expected);
        });
        if (!valid) throw new ApiError(400, 'Stripe webhook signature is invalid');
    }

    private verifyRazorpaySignature(rawBody: Buffer, signature: string | undefined) {
        if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) {
            throw new ApiError(400, 'Razorpay signature header is missing or invalid');
        }
        const expected = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET!)
            .update(rawBody)
            .digest();
        if (!timingSafeEqual(Buffer.from(signature, 'hex'), expected)) {
            throw new ApiError(400, 'Razorpay webhook signature is invalid');
        }
    }
}
