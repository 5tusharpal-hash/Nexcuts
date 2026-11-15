import type { FastifyPluginAsync } from 'fastify';
import { AuthMiddleware } from '../auth/auth.middleware.js';
import { RbacMiddleware } from '../rbac/rbac.middleware.js';
import { LoyaltyController } from './loyalty.controller.js';
import { LoyaltyService } from './loyalty.service.js';
import { LoyaltyRepository } from './loyalty.repository.js';

const authMiddleware = new AuthMiddleware();
const rbacMiddleware = new RbacMiddleware();

export const loyaltyRoutes: FastifyPluginAsync = async (app) => {
    const repository = new LoyaltyRepository();
    const service = new LoyaltyService(repository);
    const controller = new LoyaltyController(service);
    const authenticate = (
        request: Parameters<typeof authMiddleware.verifyToken>[0],
        reply: Parameters<typeof authMiddleware.verifyToken>[1]
    ) => authMiddleware.verifyToken(request, reply);
    const offerManager = {
        preHandler: [authenticate, rbacMiddleware.check('offers:manage')],
    };
    const billingManager = {
        preHandler: [authenticate, rbacMiddleware.check('billing:manage')],
    };
    const customerAuth = { preHandler: [authenticate] };

    app.get('/salons/:salonId/loyalty-program', (request) =>
        controller.getPublicProgram(request)
    );
    app.get('/salons/:salonId/loyalty-program/settings', offerManager, (request) =>
        controller.getProgram(request)
    );
    app.put('/salons/:salonId/loyalty-program', offerManager, (request) =>
        controller.updateProgram(request)
    );
    app.get('/salons/:salonId/loyalty-program/events', offerManager, (request) =>
        controller.listProgramEvents(request)
    );
    app.get(
        '/salons/:salonId/customers/:customerAccountId/loyalty-wallet',
        billingManager,
        (request) => controller.getSalonCustomerWallet(request)
    );
    app.get(
        '/salons/:salonId/customers/:customerAccountId/loyalty-ledger',
        offerManager,
        (request) => controller.listSalonCustomerLedger(request)
    );
    app.get('/me/salons/:salonId/loyalty-wallet', customerAuth, (request) =>
        controller.getMyWallet(request)
    );
    app.get('/me/salons/:salonId/loyalty-ledger', customerAuth, (request) =>
        controller.listMyLedger(request)
    );
    app.post(
        '/salons/:salonId/pos-bills/:billId/loyalty-point-previews',
        billingManager,
        (request) => controller.previewBill(request)
    );
};
