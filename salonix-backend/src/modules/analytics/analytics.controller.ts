import type { FastifyRequest } from 'fastify';
import { requireRouteParam } from '../../shared/utils/request.js';
import { AnalyticsService } from './analytics.service.js';
import {
    branchAnalyticsQuerySchema,
    churnAlertQuerySchema,
} from './analytics.validation.js';

export class AnalyticsController {
    constructor(private readonly service: AnalyticsService) {}

    async getBranchReport(request: FastifyRequest) {
        const query = branchAnalyticsQuerySchema.parse(request.query);
        return {
            success: true,
            data: await this.service.generateBranchReport(
                requireRouteParam(request.params, 'salonId'),
                query.startDate,
                query.endDate
            ),
        };
    }

    async getChurnAlerts(request: FastifyRequest) {
        const query = churnAlertQuerySchema.parse(request.query);
        return {
            success: true,
            data: await this.service.getChurnAlerts(
                requireRouteParam(request.params, 'salonId'),
                query.limit,
                query.offset
            ),
            pagination: query,
        };
    }
}
