import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../../shared/errors/ApiError.js';
import { requireRouteParam } from '../../shared/utils/request.js';
import { SalonOfferingsService } from './salon_offerings.service.js';
import {
    attachOfferBillSchema,
    confirmOfferSettlementSchema,
    createComboSchema,
    createManualOfferSaleSchema,
    createPackageSchema,
    createPurchaseRequestSchema,
    listOfferingsQuerySchema,
    listPurchaseRequestsQuerySchema,
    redeemComboSchema,
    redeemPackageSchema,
    rejectOfferPurchaseSchema,
    updateComboSchema,
    updateOfferSaleQuoteSchema,
    updatePackageSchema,
} from './salon_offerings.validation.js';
import type { OfferType } from './salon_offerings.types.js';

export class SalonOfferingsController {
    constructor(private readonly service: SalonOfferingsService) {}

    async listOfferings(request: FastifyRequest, offerType?: OfferType, publicOnly = false) {
        const query = listOfferingsQuerySchema.parse(request.query);
        return {
            success: true,
            data: await this.service.listOfferings(
                this.getSalonId(request),
                { ...query, type: offerType ?? query.type },
                publicOnly
            ),
        };
    }

    async getOffering(request: FastifyRequest, offerType: OfferType, publicOnly = false) {
        const offer = await this.service.getOffering(
            this.getSalonId(request),
            requireRouteParam(request.params, offerType === 'PACKAGE' ? 'packageId' : 'comboId'),
            offerType,
            publicOnly
        );
        if (!offer || (publicOnly && offer.status !== 'LISTED')) {
            throw new ApiError(404, 'Package or combo was not found');
        }
        return { success: true, data: offer };
    }

    async createPackage(request: FastifyRequest, reply: FastifyReply) {
        const result = await this.service.createPackage(
            this.getSalonId(request),
            this.getAccountId(request),
            createPackageSchema.parse(request.body)
        );
        return reply.status(201).send({ success: true, data: result });
    }

    async updatePackage(request: FastifyRequest) {
        const result = await this.service.updatePackage(
            this.getSalonId(request),
            requireRouteParam(request.params, 'packageId'),
            this.getAccountId(request),
            updatePackageSchema.parse(request.body)
        );
        return { success: true, data: result };
    }

    async createCombo(request: FastifyRequest, reply: FastifyReply) {
        const result = await this.service.createCombo(
            this.getSalonId(request),
            this.getAccountId(request),
            createComboSchema.parse(request.body)
        );
        return reply.status(201).send({ success: true, data: result });
    }

    async updateCombo(request: FastifyRequest) {
        const result = await this.service.updateCombo(
            this.getSalonId(request),
            requireRouteParam(request.params, 'comboId'),
            this.getAccountId(request),
            updateComboSchema.parse(request.body)
        );
        return { success: true, data: result };
    }

    async createPurchaseRequest(request: FastifyRequest, reply: FastifyReply) {
        const result = await this.service.createPurchaseRequest(
            this.getCustomerAccountId(request),
            this.getSalonId(request),
            createPurchaseRequestSchema.parse(request.body)
        );
        return reply.status(201).send({ success: true, data: result });
    }

    async createManualSale(request: FastifyRequest, reply: FastifyReply) {
        const result = await this.service.createManualSale(
            this.getSalonId(request),
            this.getAccountId(request),
            createManualOfferSaleSchema.parse(request.body)
        );
        return reply.status(201).send({ success: true, data: result });
    }

    async listPurchaseRequests(request: FastifyRequest) {
        const query = listPurchaseRequestsQuerySchema.parse(request.query);
        return {
            success: true,
            data: await this.service.listPurchaseRequests(this.getSalonId(request), query),
        };
    }

    async getSalonPurchaseRequest(request: FastifyRequest) {
        const result = await this.service.getPurchaseRequest(
            this.getSalonId(request),
            requireRouteParam(request.params, 'requestId')
        );
        if (!result) throw new ApiError(404, 'Offer purchase request was not found');
        return { success: true, data: result };
    }

    async listMyPurchases(request: FastifyRequest) {
        const query = listOfferingsQuerySchema.parse(request.query);
        return {
            success: true,
            data: await this.service.listMyPurchases(
                this.getCustomerAccountId(request),
                query.limit,
                query.offset
            ),
        };
    }

    async getMyPurchaseRequest(request: FastifyRequest) {
        const result = await this.service.getPurchaseRequest(
            this.getSalonId(request),
            requireRouteParam(request.params, 'requestId'),
            this.getCustomerAccountId(request)
        );
        if (!result) throw new ApiError(404, 'Offer purchase request was not found');
        return { success: true, data: result };
    }

    async startCheckout(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.startCheckout(
                this.getSalonId(request),
                requireRouteParam(request.params, 'requestId'),
                this.getAccountId(request)
            ),
        };
    }

    async updateSaleQuote(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.updateSaleQuote(
                this.getSalonId(request),
                requireRouteParam(request.params, 'requestId'),
                this.getAccountId(request),
                updateOfferSaleQuoteSchema.parse(request.body)
            ),
        };
    }

    async rejectPurchaseRequest(request: FastifyRequest) {
        const { reason } = rejectOfferPurchaseSchema.parse(request.body);
        return {
            success: true,
            data: await this.service.rejectPurchaseRequest(
                this.getSalonId(request),
                requireRouteParam(request.params, 'requestId'),
                this.getAccountId(request),
                reason
            ),
        };
    }

    async attachDraftBill(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.attachDraftBill(
                this.getSalonId(request),
                requireRouteParam(request.params, 'requestId'),
                this.getAccountId(request),
                attachOfferBillSchema.parse(request.body)
            ),
        };
    }

    async confirmSettlement(request: FastifyRequest) {
        const body = confirmOfferSettlementSchema.parse(request.body);
        return {
            success: true,
            data: await this.service.confirmSettlement(
                this.getSalonId(request),
                requireRouteParam(request.params, 'requestId'),
                this.getAccountId(request),
                body.billId,
                body.idempotencyKey
            ),
        };
    }

    async redeemPackage(request: FastifyRequest) {
        const body = redeemPackageSchema.parse(request.body);
        return {
            success: true,
            data: await this.service.redeemPackage(
                this.getSalonId(request),
                requireRouteParam(request.params, 'subscriptionId'),
                this.getAccountId(request),
                body.serviceId,
                body.billId,
                body.idempotencyKey
            ),
        };
    }

    async redeemCombo(request: FastifyRequest) {
        const body = redeemComboSchema.parse(request.body);
        return {
            success: true,
            data: await this.service.redeemCombo(
                this.getSalonId(request),
                requireRouteParam(request.params, 'comboPurchaseId'),
                this.getAccountId(request),
                body.serviceIds,
                body.billId,
                body.idempotencyKey
            ),
        };
    }

    async listLedger(request: FastifyRequest) {
        const query = listOfferingsQuerySchema.parse(request.query);
        return {
            success: true,
            data: await this.service.listLedger(
                this.getSalonId(request),
                requireRouteParam(request.params, 'customerAccountId'),
                query.limit,
                query.offset
            ),
        };
    }

    async listMyLedger(request: FastifyRequest) {
        const query = listOfferingsQuerySchema.parse(request.query);
        return {
            success: true,
            data: await this.service.listLedger(
                this.getSalonId(request),
                this.getCustomerAccountId(request),
                query.limit,
                query.offset
            ),
        };
    }

    private getSalonId(request: FastifyRequest) {
        return requireRouteParam(request.params, 'salonId');
    }

    private getAccountId(request: FastifyRequest) {
        if (!request.user) throw new ApiError(401, 'Authentication required');
        return request.user.id;
    }

    private getCustomerAccountId(request: FastifyRequest) {
        if (!request.user) throw new ApiError(401, 'Authentication required');
        if (request.user.account_type !== 'CUSTOMER') {
            throw new ApiError(403, 'A customer account is required');
        }
        return request.user.id;
    }
}
