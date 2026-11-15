import type { FastifyPluginAsync } from 'fastify';
import { AuthMiddleware } from '../auth/auth.middleware.js';
import { RbacMiddleware } from '../rbac/rbac.middleware.js';
import { SalonTaxRatesController } from './salon_tax_rates.controller.js';
import { SalonTaxRatesRepository } from './salon_tax_rates.repository.js';

const authMiddleware = new AuthMiddleware();
const rbacMiddleware = new RbacMiddleware();

export const salonTaxRatesRoutes: FastifyPluginAsync = async (app) => {
    const controller = new SalonTaxRatesController(new SalonTaxRatesRepository());
    const authorized = {
        preHandler: [
            (
                request: Parameters<typeof authMiddleware.verifyToken>[0],
                reply: Parameters<typeof authMiddleware.verifyToken>[1]
            ) => authMiddleware.verifyToken(request, reply),
            rbacMiddleware.check('billing:manage'),
        ],
    };

    app.get('/salons/:salonId/pos-tax-rates', authorized, (request) => controller.list(request));
    app.post('/salons/:salonId/pos-tax-rates', authorized, (request, reply) =>
        controller.create(request, reply)
    );
    app.patch('/salons/:salonId/pos-tax-rates/:taxRateId', authorized, (request) =>
        controller.update(request)
    );
    app.delete('/salons/:salonId/pos-tax-rates/:taxRateId', authorized, (request) =>
        controller.deactivate(request)
    );
};
