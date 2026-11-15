import type { FastifyPluginAsync } from 'fastify';
import { PosBillingController } from './pos_billing.controller';
import { PosBillingService } from './pos_billing.service';
import { PosBillingRepository } from './pos_billing.repository';

export const posBillingRoutes: FastifyPluginAsync = async (app) => {
    const repository = new PosBillingRepository();
    const service = new PosBillingService(repository);
    const controller = new PosBillingController(service);

    app.post('/checkout', (request, reply) => controller.checkout(request, reply));
    app.get('/bill/:id', (request, reply) => controller.getBill(request, reply));
};
