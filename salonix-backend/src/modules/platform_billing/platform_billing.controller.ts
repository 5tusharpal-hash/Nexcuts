import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../shared/errors/ApiError.js';
import { requireRouteParam } from '../../shared/utils/request.js';
import { PlatformBillingRepository } from './platform_billing.repository.js';
import { PlatformBillingService } from './platform_billing.service.js';
import type {
    PlatformAddonPurchaseRequest,
    PlatformConsolidatedCheckoutRequest,
} from './platform_billing.types.js';

const providerSchema = z.object({
    provider: z.enum(['RAZORPAY', 'STRIPE']),
});

const consolidatedCheckoutSchema: z.ZodType<PlatformConsolidatedCheckoutRequest> = z.object({
    provider: z.enum(['RAZORPAY', 'STRIPE']),
    invoiceIds: z.array(z.string().uuid()).min(1).max(50),
}).superRefine((value, context) => {
    if (new Set(value.invoiceIds.map((invoiceId) => invoiceId.toLowerCase())).size !== value.invoiceIds.length) {
        context.addIssue({
            code: 'custom',
            path: ['invoiceIds'],
            message: 'Invoice IDs must be unique',
        });
    }
});

const addonPurchaseSchema: z.ZodType<PlatformAddonPurchaseRequest> = z.object({
    activationMode: z.enum(['IMMEDIATE_PRORATED', 'NEXT_CYCLE']),
    provider: z.enum(['RAZORPAY', 'STRIPE']).optional(),
}).superRefine((value, context) => {
    if (value.activationMode === 'IMMEDIATE_PRORATED' && !value.provider) {
        context.addIssue({
            code: 'custom',
            path: ['provider'],
            message: 'A payment provider is required for immediate add-on purchases',
        });
    }
});

const salonBillingProfileSchema = z.object({
    stateCode: z.string().regex(/^\d{2}$/),
    gstin: z.string()
        .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/)
        .nullable()
        .optional(),
});

const platformGstSchema = z.object({
    enabled: z.boolean(),
    sellerGstin: z.string()
        .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/)
        .nullable()
        .optional(),
    sellerStateCode: z.string().regex(/^\d{2}$/).nullable().optional(),
    ratePercent: z.number().finite().min(0).max(28),
}).superRefine((value, context) => {
    if (value.enabled) {
        if (!value.sellerGstin || !value.sellerStateCode || value.ratePercent <= 0) {
            context.addIssue({
                code: 'custom',
                path: ['enabled'],
                message: 'Enabled GST requires a seller GSTIN, state code, and positive tax rate',
            });
        } else if (value.sellerGstin.slice(0, 2) !== value.sellerStateCode) {
            context.addIssue({
                code: 'custom',
                path: ['sellerStateCode'],
                message: 'Seller GSTIN state prefix must match the configured state code',
            });
        }
    }
});

export class PlatformBillingController {
    constructor(
        private readonly service: PlatformBillingService,
        private readonly repository: PlatformBillingRepository
    ) {}

    async generateInvoice(request: FastifyRequest, reply: FastifyReply) {
        const salonId = requireRouteParam(request.params, 'salonId');
        const invoice = await this.service.processMonthlyBilling(salonId);
        return reply.status(201).send({ success: true, data: invoice });
    }

    async listInvoices(request: FastifyRequest) {
        const salonId = requireRouteParam(request.params, 'salonId');
        return { success: true, data: await this.service.listInvoices(salonId) };
    }

    async createCheckout(request: FastifyRequest, reply: FastifyReply) {
        const salonId = requireRouteParam(request.params, 'salonId');
        const invoiceId = requireRouteParam(request.params, 'invoiceId');
        const { provider } = providerSchema.parse(request.body);
        const checkout = await this.service.createConsolidatedCheckout(
            salonId,
            [invoiceId],
            provider,
            this.requireIdempotencyKey(request)
        );
        return reply.status(201).send({ success: true, data: checkout });
    }

    async createConsolidatedCheckout(request: FastifyRequest, reply: FastifyReply) {
        const salonId = requireRouteParam(request.params, 'salonId');
        const input = consolidatedCheckoutSchema.parse(request.body);
        const checkout = await this.service.createConsolidatedCheckout(
            salonId,
            input.invoiceIds,
            input.provider,
            this.requireIdempotencyKey(request)
        );
        return reply.status(201).send({ success: true, data: checkout });
    }

    async purchaseAddon(request: FastifyRequest, reply: FastifyReply) {
        const salonId = requireRouteParam(request.params, 'salonId');
        const addonId = z.string().uuid().parse(requireRouteParam(request.params, 'addonId'));
        const input = addonPurchaseSchema.parse(request.body);
        const purchase = await this.service.purchaseAddon(
            salonId,
            addonId,
            input,
            this.requireIdempotencyKey(request)
        );
        return reply.status(201).send({ success: true, data: purchase });
    }

    async checkStatus(request: FastifyRequest) {
        const salonId = requireRouteParam(request.params, 'salonId');
        const active = await this.service.checkSubscriptionStatus(salonId);
        return { success: true, data: { active } };
    }

    async getSalonBillingProfile(request: FastifyRequest) {
        const salonId = requireRouteParam(request.params, 'salonId');
        return { success: true, data: await this.repository.getSalonBillingProfile(salonId) };
    }

    async updateSalonBillingProfile(request: FastifyRequest) {
        const salonId = requireRouteParam(request.params, 'salonId');
        const user = this.requireUser(request);
        const input = salonBillingProfileSchema.parse(request.body);
        if (input.gstin && input.gstin.slice(0, 2) !== input.stateCode) {
            throw new ApiError(400, 'GSTIN state prefix must match the salon state code');
        }
        const profile = await this.repository.updateSalonBillingProfile(
            salonId,
            input.stateCode,
            input.gstin ?? null,
            user.id
        );
        return { success: true, data: profile };
    }

    async getPlatformGstSettings(request: FastifyRequest) {
        this.requireAdmin(request);
        return { success: true, data: await this.repository.getPlatformGstSettings() };
    }

    async updatePlatformGstSettings(request: FastifyRequest) {
        const user = this.requireAdmin(request);
        const input = platformGstSchema.parse(request.body);
        return {
            success: true,
            data: await this.repository.updatePlatformGstSettings({
                enabled: input.enabled,
                sellerGstin: input.sellerGstin ?? null,
                sellerStateCode: input.sellerStateCode ?? null,
                ratePercent: input.ratePercent,
            }, user.id),
        };
    }

    async reconcilePayment(request: FastifyRequest) {
        this.requireAdmin(request);
        const paymentId = z.string().uuid().parse(requireRouteParam(request.params, 'paymentId'));
        return { success: true, data: await this.service.reconcilePayment(paymentId) };
    }

    async stripeWebhook(request: FastifyRequest) {
        const rawBody = request.rawBody;
        if (!rawBody) throw new ApiError(400, 'Webhook request body is unavailable');
        const signature = request.headers['stripe-signature'];
        const processed = await this.service.processStripeWebhook(
            rawBody,
            typeof signature === 'string' ? signature : undefined
        );
        return { success: true, data: { processed } };
    }

    async razorpayWebhook(request: FastifyRequest) {
        const rawBody = request.rawBody;
        if (!rawBody) throw new ApiError(400, 'Webhook request body is unavailable');
        const signature = request.headers['x-razorpay-signature'];
        const eventId = request.headers['x-razorpay-event-id'];
        const processed = await this.service.processRazorpayWebhook(
            rawBody,
            typeof signature === 'string' ? signature : undefined,
            typeof eventId === 'string' ? eventId : undefined
        );
        return { success: true, data: { processed } };
    }

    private requireUser(request: FastifyRequest) {
        if (!request.user) throw new ApiError(401, 'Authentication required');
        return request.user;
    }

    private requireIdempotencyKey(request: FastifyRequest) {
        const key = request.headers['idempotency-key'];
        if (typeof key !== 'string' || key.trim().length < 8 || key.length > 255) {
            throw new ApiError(400, 'A valid Idempotency-Key header is required');
        }
        return key.trim();
    }

    private requireAdmin(request: FastifyRequest) {
        const user = this.requireUser(request);
        if (!user.is_super_admin) throw new ApiError(403, 'Platform administrator access is required');
        return user;
    }
}
