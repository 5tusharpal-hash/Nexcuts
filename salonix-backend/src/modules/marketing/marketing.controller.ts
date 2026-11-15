import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../../shared/errors/ApiError.js';
import { requireRouteParam } from '../../shared/utils/request.js';
import { QueueService } from '../queue/queue.service.js';
import { MarketingRepository } from './marketing.repository.js';
import { MarketingService } from './marketing.service.js';
import {
    createMarketingCampaignSchema,
    marketingDeliveryQuerySchema,
    queueJoinConsentSchema,
    sendMarketingCampaignSchema,
} from './marketing.validation.js';

export class MarketingController {
    constructor(
        private readonly service: MarketingService,
        private readonly repository: MarketingRepository,
        private readonly queueService: QueueService
    ) {}

    async createCampaign(request: FastifyRequest, reply: FastifyReply) {
        const salonId = requireRouteParam(request.params, 'salonId');
        const input = createMarketingCampaignSchema.parse(request.body);
        const campaign = await this.service.createCampaign(
            salonId,
            input.name,
            input.titleTemplate,
            input.bodyTemplate,
            input.scheduledAt ? new Date(input.scheduledAt) : undefined,
            input.channels
        );
        return reply.status(201).send({ success: true, data: campaign });
    }

    async sendCampaign(request: FastifyRequest) {
        const salonId = requireRouteParam(request.params, 'salonId');
        const campaignId = requireRouteParam(request.params, 'campaignId');
        const input = sendMarketingCampaignSchema.parse(request.body);
        return {
            success: true,
            data: await this.service.sendCampaign(salonId, campaignId, input.channel, input.limit),
        };
    }

    async listDeliveries(request: FastifyRequest) {
        const salonId = requireRouteParam(request.params, 'salonId');
        const campaignId = requireRouteParam(request.params, 'campaignId');
        const query = marketingDeliveryQuerySchema.parse(request.query);
        const result = await this.repository.listDeliveries(
            salonId,
            campaignId,
            query.limit,
            query.offset
        );
        return {
            success: true,
            data: result.items,
            pagination: { ...query, total: result.total },
        };
    }

    async joinQueue(request: FastifyRequest, reply: FastifyReply) {
        const user = this.requireCustomer(request);
        const salonId = requireRouteParam(request.params, 'salonId');
        const input = queueJoinConsentSchema.parse(request.body);
        const result = await this.queueService.joinQueue(
            user.id,
            salonId,
            input.serviceId,
            'NORMAL',
            input.marketingConsent
        );
        return reply.status(201).send({
            success: true,
            data: {
                ...result,
                marketingConsent: input.marketingConsent,
            },
        });
    }

    async getConsent(request: FastifyRequest) {
        const user = this.requireCustomer(request);
        const salonId = requireRouteParam(request.params, 'salonId');
        return {
            success: true,
            data: await this.repository.currentConsent(salonId, user.id),
        };
    }

    async optOut(request: FastifyRequest) {
        const user = this.requireCustomer(request);
        const salonId = requireRouteParam(request.params, 'salonId');
        await this.repository.optOut(salonId, user.id);
        return { success: true, data: { marketingConsent: false } };
    }

    private requireCustomer(request: FastifyRequest) {
        if (!request.user) throw new ApiError(401, 'Authentication required');
        if (request.user.account_type !== 'CUSTOMER') {
            throw new ApiError(403, 'A customer account is required');
        }
        return request.user;
    }
}
