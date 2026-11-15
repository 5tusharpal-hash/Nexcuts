import type { FastifyRequest } from 'fastify';
import { requireRouteParam } from '../../shared/utils/request.js';
import { DiscoveryService } from './discovery.service.js';
import {
    discoveryQuerySchema,
    publicSalonSlugSchema,
    salonSearchQuerySchema,
} from './discovery.validation.js';

export class DiscoveryController {
    constructor(private readonly service: DiscoveryService) {}

    async getProfile(request: FastifyRequest) {
        const slug = publicSalonSlugSchema.parse(requireRouteParam(request.params, 'slug'));
        return {
            success: true,
            data: await this.service.getPublicProfile(slug),
        };
    }

    async getGallery(request: FastifyRequest) {
        const slug = publicSalonSlugSchema.parse(requireRouteParam(request.params, 'slug'));
        const query = discoveryQuerySchema.parse(request.query);
        const result = await this.service.getPublicGallery(slug, query);
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

    async searchPublicSalons(request: FastifyRequest) {
        const query = salonSearchQuerySchema.parse(request.query);
        const result = await this.service.searchPublicSalons(query);
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
