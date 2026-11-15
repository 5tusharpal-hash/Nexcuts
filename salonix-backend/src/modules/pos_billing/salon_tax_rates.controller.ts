import type { FastifyReply, FastifyRequest } from 'fastify';
import { requireRouteParam } from '../../shared/utils/request.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import { SalonTaxRatesRepository } from './salon_tax_rates.repository.js';
import {
    createSalonTaxRateSchema,
    updateSalonTaxRateSchema,
} from './salon_tax_rates.validation.js';

export class SalonTaxRatesController {
    constructor(private readonly repository: SalonTaxRatesRepository) {}

    async list(request: FastifyRequest) {
        return {
            success: true,
            data: await this.repository.list(this.salonId(request)),
        };
    }

    async create(request: FastifyRequest, reply: FastifyReply) {
        const rate = await this.repository.create(
            this.salonId(request),
            createSalonTaxRateSchema.parse(request.body)
        );
        return reply.status(201).send({ success: true, data: rate });
    }

    async update(request: FastifyRequest) {
        return {
            success: true,
            data: await this.repository.update(
                this.salonId(request),
                requireRouteParam(request.params, 'taxRateId'),
                updateSalonTaxRateSchema.parse(request.body)
            ),
        };
    }

    async deactivate(request: FastifyRequest) {
        await this.repository.deactivate(
            this.salonId(request),
            requireRouteParam(request.params, 'taxRateId')
        );
        return { success: true, data: { active: false } };
    }

    private salonId(request: FastifyRequest) {
        const id = requireRouteParam(request.params, 'salonId');
        if (!request.user) throw new ApiError(401, 'Authentication required');
        return id;
    }
}
