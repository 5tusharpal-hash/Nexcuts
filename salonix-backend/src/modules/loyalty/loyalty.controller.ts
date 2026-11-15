import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../shared/errors/ApiError.js';
import { requireRouteParam } from '../../shared/utils/request.js';
import { LoyaltyService } from './loyalty.service.js';
import { loyaltyListQuerySchema, updateLoyaltyProgramSchema } from './loyalty.validation.js';

export class LoyaltyController {
    constructor(private readonly service: LoyaltyService) {}

    async getProgram(request: FastifyRequest) {
        const program = await this.service.getProgram(this.salonId(request));
        return { success: true, data: program };
    }

    async updateProgram(request: FastifyRequest) {
        const program = await this.service.updateProgram(
            this.salonId(request),
            this.accountId(request),
            updateLoyaltyProgramSchema.parse(request.body)
        );
        return { success: true, data: program };
    }

    async getPublicProgram(request: FastifyRequest) {
        const program = await this.service.getPublicProgram(this.salonId(request));
        return { success: true, data: program };
    }

    async getMyWallet(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.getCustomerWallet(this.customerAccountId(request), this.salonId(request)),
        };
    }

    async listMyLedger(request: FastifyRequest) {
        const query = loyaltyListQuerySchema.parse(request.query);
        return {
            success: true,
            data: await this.service.listCustomerLedger(
                this.customerAccountId(request),
                this.salonId(request),
                query.limit,
                query.offset
            ),
        };
    }

    async getSalonCustomerWallet(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.getCustomerWallet(
                this.customerRouteId(request),
                this.salonId(request)
            ),
        };
    }

    async listSalonCustomerLedger(request: FastifyRequest) {
        const query = loyaltyListQuerySchema.parse(request.query);
        return {
            success: true,
            data: await this.service.listCustomerLedger(
                this.customerRouteId(request),
                this.salonId(request),
                query.limit,
                query.offset
            ),
        };
    }

    async listProgramEvents(request: FastifyRequest) {
        const query = loyaltyListQuerySchema.parse(request.query);
        return {
            success: true,
            data: await this.service.listProgramEvents(
                this.salonId(request),
                query.limit,
                query.offset
            ),
        };
    }

    async previewBill(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.previewBill(
                this.salonId(request),
                requireRouteParam(request.params, 'billId')
            ),
        };
    }

    private salonId(request: FastifyRequest): string {
        return requireRouteParam(request.params, 'salonId');
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

    private customerRouteId(request: FastifyRequest): string {
        return z.string().uuid().parse(requireRouteParam(request.params, 'customerAccountId'));
    }
}
