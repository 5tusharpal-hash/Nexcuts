import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../../shared/errors/ApiError.js';
import { requireRouteParam } from '../../shared/utils/request.js';
import { PosBillingWorkflowService } from './pos_billing.workflow.service.js';
import {
    confirmPosBillSchema,
    allocateAdvanceSchema,
    createAdvanceClaimSchema,
    createWalletRedemptionSchema,
    createPaymentClaimSchema,
    createPosSessionSchema,
    issueBillVersionSchema,
    posBillCategoryOverrideSchema,
    posCategorySettingSchema,
    posBillItemsSchema,
    posListQuerySchema,
    posTaxCategorySchema,
    recordPosPaymentSchema,
    reviewPaymentClaimSchema,
    createPosRefundSchema,
    reviewPosRefundSchema,
    reviewWalletRedemptionSchema,
    verifyWalletRedemptionSchema,
} from './pos_billing.validation.js';

export class PosBillingWorkflowController {
    constructor(private readonly service: PosBillingWorkflowService) {}

    async createSession(request: FastifyRequest, reply: FastifyReply) {
        const result = await this.service.createSession(
            this.salonId(request),
            this.accountId(request),
            createPosSessionSchema.parse(request.body)
        );
        return reply.status(201).send({ success: true, data: result });
    }

    async createBill(request: FastifyRequest, reply: FastifyReply) {
        const result = await this.service.createBill(
            this.salonId(request),
            requireRouteParam(request.params, 'sessionId'),
            this.accountId(request),
            posBillItemsSchema.parse(request.body).items
        );
        return reply.status(201).send({ success: true, data: result });
    }

    async updateBill(request: FastifyRequest) {
        const result = await this.service.updateBill(
            this.salonId(request),
            requireRouteParam(request.params, 'billId'),
            this.accountId(request),
            posBillItemsSchema.parse(request.body).items
        );
        return { success: true, data: result };
    }

    async issueBill(request: FastifyRequest, reply: FastifyReply) {
        const body = issueBillVersionSchema.parse(request.body ?? {});
        const result = await this.service.issueBill(
            this.salonId(request),
            requireRouteParam(request.params, 'billId'),
            this.accountId(request),
            body.customerMessage
        );
        return reply.status(201).send({ success: true, data: result });
    }

    async confirmBill(request: FastifyRequest) {
        const result = await this.service.confirmBill(
            this.salonId(request),
            requireRouteParam(request.params, 'billId'),
            confirmPosBillSchema.parse(request.body).versionId,
            this.accountId(request)
        );
        return { success: true, data: result };
    }

    async recordPayment(request: FastifyRequest) {
        const result = await this.service.recordPayment(
            this.salonId(request),
            requireRouteParam(request.params, 'billId'),
            this.accountId(request),
            recordPosPaymentSchema.parse(request.body)
        );
        return { success: true, data: result };
    }

    async createPaymentClaim(request: FastifyRequest, reply: FastifyReply) {
        const result = await this.service.createPaymentClaim(
            this.salonId(request),
            this.customerAccountId(request),
            this.accountId(request),
            createPaymentClaimSchema.parse(request.body)
        );
        return reply.status(201).send({ success: true, data: result });
    }

    async createAdvanceClaim(request: FastifyRequest, reply: FastifyReply) {
        const result = await this.service.createAdvanceClaim(
            this.salonId(request),
            this.customerAccountId(request),
            this.accountId(request),
            createAdvanceClaimSchema.parse(request.body)
        );
        return reply.status(201).send({ success: true, data: result });
    }

    async allocateAdvance(request: FastifyRequest) {
        const body = allocateAdvanceSchema.parse(request.body);
        const result = await this.service.allocateAdvance(
            this.salonId(request),
            requireRouteParam(request.params, 'billId'),
            this.accountId(request),
            {
                advanceEntryId: body.advanceEntryId,
                amount: body.amount,
                idempotencyKey: body.idempotencyKey,
                billId: requireRouteParam(request.params, 'billId'),
            }
        );
        return { success: true, data: result };
    }

    async createWalletRedemption(request: FastifyRequest, reply: FastifyReply) {
        const { channel, recipient } = this.customerOtpRecipient(request);
        const result = await this.service.createWalletRedemption(
            this.salonId(request),
            this.customerAccountId(request),
            channel,
            recipient,
            request.ip,
            createWalletRedemptionSchema.parse(request.body)
        );
        return reply.status(201).send({ success: true, data: result });
    }

    async verifyWalletRedemption(request: FastifyRequest) {
        const { code } = verifyWalletRedemptionSchema.parse(request.body);
        const { channel, recipient } = this.customerOtpRecipient(request);
        const result = await this.service.verifyWalletRedemption(
            this.salonId(request),
            this.customerAccountId(request),
            channel,
            recipient,
            code,
            request.ip,
            requireRouteParam(request.params, 'redemptionId')
        );
        return { success: true, data: result };
    }

    async reviewWalletRedemption(request: FastifyRequest) {
        const result = await this.service.reviewWalletRedemption(
            this.salonId(request),
            requireRouteParam(request.params, 'redemptionId'),
            this.accountId(request),
            reviewWalletRedemptionSchema.parse(request.body)
        );
        return { success: true, data: result };
    }

    async listPaymentClaims(request: FastifyRequest) {
        const query = posListQuerySchema.parse(request.query);
        return {
            success: true,
            data: await this.service.listPaymentClaims(this.salonId(request), query.limit, query.offset),
        };
    }

    async reviewPaymentClaim(request: FastifyRequest) {
        const result = await this.service.reviewPaymentClaim(
            this.salonId(request),
            requireRouteParam(request.params, 'claimId'),
            this.accountId(request),
            reviewPaymentClaimSchema.parse(request.body)
        );
        return { success: true, data: result };
    }

    async getBill(request: FastifyRequest) {
        const bill = await this.service.getBill(
            this.salonId(request),
            requireRouteParam(request.params, 'billId')
        );
        if (!bill) throw new ApiError(404, 'POS bill was not found');
        return { success: true, data: bill };
    }

    async getCustomerBill(request: FastifyRequest) {
        const bill = await this.service.getCustomerBill(
            this.salonId(request),
            this.customerAccountId(request),
            requireRouteParam(request.params, 'billId')
        );
        if (!bill) throw new ApiError(404, 'POS bill was not found');
        return { success: true, data: bill };
    }

    async listCustomerBills(request: FastifyRequest) {
        const query = posListQuerySchema.parse(request.query);
        return {
            success: true,
            data: await this.service.listCustomerBills(
                this.salonId(request),
                this.customerAccountId(request),
                query.limit,
                query.offset
            ),
        };
    }

    async createRefund(request: FastifyRequest, reply: FastifyReply) {
        const result = await this.service.createRefund(
            this.salonId(request),
            requireRouteParam(request.params, 'billId'),
            this.accountId(request),
            createPosRefundSchema.parse(request.body)
        );
        return reply.status(201).send({ success: true, data: result });
    }

    async listRefunds(request: FastifyRequest) {
        const query = posListQuerySchema.parse(request.query);
        return {
            success: true,
            data: await this.service.listRefunds(
                this.salonId(request),
                query.limit,
                query.offset
            ),
        };
    }

    async reviewRefund(request: FastifyRequest) {
        const result = await this.service.reviewRefund(
            this.salonId(request),
            requireRouteParam(request.params, 'refundId'),
            this.accountId(request),
            reviewPosRefundSchema.parse(request.body)
        );
        return { success: true, data: result };
    }

    async listBills(request: FastifyRequest) {
        const query = posListQuerySchema.parse(request.query);
        return {
            success: true,
            data: await this.service.listBills(this.salonId(request), query.limit, query.offset),
        };
    }

    async listCategorySettings(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.getCategorySettings(this.salonId(request)),
        };
    }

    async updateCategorySetting(request: FastifyRequest) {
        const category = posTaxCategorySchema.parse(
            requireRouteParam(request.params, 'category')
        );
        const result = await this.service.updateCategorySetting(
            this.salonId(request),
            category,
            this.accountId(request),
            posCategorySettingSchema.parse(request.body)
        );
        return { success: true, data: result };
    }

    async updateBillCategoryOverride(request: FastifyRequest) {
        const category = posTaxCategorySchema.parse(
            requireRouteParam(request.params, 'category')
        );
        const result = await this.service.updateBillCategoryOverride(
            this.salonId(request),
            requireRouteParam(request.params, 'billId'),
            category,
            this.accountId(request),
            posBillCategoryOverrideSchema.parse(request.body)
        );
        return { success: true, data: result };
    }

    private accountId(request: FastifyRequest): string {
        if (!request.user) throw new ApiError(401, 'Authentication required');
        return request.user.id;
    }

    private customerAccountId(request: FastifyRequest): string {
        if (!request.user) throw new ApiError(401, 'Authentication required');
        if (request.user.account_type !== 'CUSTOMER') {
            throw new ApiError(403, 'A customer account is required for this operation');
        }
        return request.user.id;
    }

    private customerOtpRecipient(request: FastifyRequest) {
        const user = request.user;
        if (!user) throw new ApiError(401, 'Authentication required');
        if (user.account_type !== 'CUSTOMER') {
            throw new ApiError(403, 'A customer account is required for wallet verification');
        }
        if (user.phone_verified_at) {
            return { channel: 'phone' as const, recipient: user.phone_number };
        }
        if (user.email && user.email_verified_at) {
            return { channel: 'email' as const, recipient: user.email };
        }
        throw new ApiError(403, 'A verified phone number or email is required for wallet redemption');
    }

    private salonId(request: FastifyRequest): string {
        return requireRouteParam(request.params, 'salonId');
    }
}
