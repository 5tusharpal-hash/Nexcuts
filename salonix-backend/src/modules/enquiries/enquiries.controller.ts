import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../../shared/errors/ApiError.js';
import { requireRouteParam } from '../../shared/utils/request.js';
import { EnquiriesService } from './enquiries.service.js';
import {
    createEnquiryResponseSchema,
    createEnquirySchema,
    enquiryItemParamsSchema,
    enquiryListQuerySchema,
    enquiryParamsSchema,
    enquiryResponsesQuerySchema,
    updateEnquiryStatusSchema,
} from './enquiries.validation.js';

export class EnquiriesController {
    constructor(private readonly service: EnquiriesService) {}

    async create(request: FastifyRequest, reply: FastifyReply) {
        const { salonId } = enquiryParamsSchema.parse({ salonId: requireRouteParam(request.params, 'salonId') });
        const input = createEnquirySchema.parse(request.body);
        const result = await this.service.createEnquiry(
            { ...input, branchId: salonId },
            request.ip
        );
        return reply.status(201).send({ success: true, data: result });
    }

    async list(request: FastifyRequest) {
        const { salonId } = enquiryParamsSchema.parse({ salonId: requireRouteParam(request.params, 'salonId') });
        const query = enquiryListQuerySchema.parse(request.query);
        const result = await this.service.listEnquiries(salonId, query);
        return {
            success: true,
            data: result.items,
            pagination: {
                limit: query.limit,
                offset: query.offset,
                total: result.total,
            },
        };
    }

    async updateStatus(request: FastifyRequest) {
        const params = enquiryItemParamsSchema.parse(request.params);
        const input = updateEnquiryStatusSchema.parse(request.body);
        await this.service.updateStatus(params.salonId, params.enquiryId, input);
        return { success: true };
    }

    async addResponse(request: FastifyRequest, reply: FastifyReply) {
        if (!request.user || request.user.account_type !== 'SALON') {
            throw new ApiError(403, 'A salon account is required to respond to enquiries');
        }
        const params = enquiryItemParamsSchema.parse(request.params);
        const input = createEnquiryResponseSchema.parse(request.body);
        await this.service.addResponse(
            params.salonId,
            params.enquiryId,
            request.user.id,
            input.note,
            input.isExternalReply
        );
        return reply.status(201).send({ success: true });
    }

    async listResponses(request: FastifyRequest) {
        const params = enquiryItemParamsSchema.parse(request.params);
        const query = enquiryResponsesQuerySchema.parse(request.query);
        const result = await this.service.listResponses(
            params.salonId,
            params.enquiryId,
            query.limit,
            query.offset
        );
        return {
            success: true,
            data: result.items,
            pagination: {
                limit: query.limit,
                offset: query.offset,
                total: result.total,
            },
        };
    }
}
