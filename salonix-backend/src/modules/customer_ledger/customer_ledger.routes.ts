import type { FastifyPluginAsync } from 'fastify';
import { AuthMiddleware } from '../auth/auth.middleware.js';
import { CustomerLedgerController } from './customer_ledger.controller.js';
import { CustomerLedgerService } from './customer_ledger.service.js';
import { CustomerLedgerRepository } from './customer_ledger.repository.js';

const authMiddleware = new AuthMiddleware();

export const customerLedgerRoutes: FastifyPluginAsync = async (app) => {
    const repository = new CustomerLedgerRepository();
    const service = new CustomerLedgerService(repository);
    const controller = new CustomerLedgerController(service);
    const authenticated = {
        preHandler: (
            request: Parameters<typeof authMiddleware.verifyToken>[0],
            reply: Parameters<typeof authMiddleware.verifyToken>[1]
        ) => authMiddleware.verifyToken(request, reply),
    };

    app.get('/me/customer-ledger', authenticated, (request, reply) =>
        controller.getTimeline(request, reply)
    );
    app.get('/me/customer-ledger/bills/:billId', authenticated, (request, reply) =>
        controller.getDetails(request, reply)
    );
};
