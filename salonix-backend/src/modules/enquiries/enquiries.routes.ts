import type { FastifyPluginAsync } from 'fastify';
import { AuthMiddleware } from '../auth/auth.middleware.js';
import { RbacMiddleware } from '../rbac/rbac.middleware.js';
import { EnquiriesController } from './enquiries.controller.js';
import { EnquiriesRepository } from './enquiries.repository.js';
import { EnquiriesService } from './enquiries.service.js';
import { pool } from '../../bootstrap/db.connect.js';

const authMiddleware = new AuthMiddleware();
const rbacMiddleware = new RbacMiddleware();

export const enquiriesRoutes: FastifyPluginAsync = async (app) => {
    const controller = new EnquiriesController(
        new EnquiriesService(new EnquiriesRepository(pool))
    );
    const authenticate = (
        request: Parameters<typeof authMiddleware.verifyToken>[0],
        reply: Parameters<typeof authMiddleware.verifyToken>[1]
    ) => authMiddleware.verifyToken(request, reply);
    const enquiryManager = {
        preHandler: [authenticate, rbacMiddleware.check('staff:manage')],
    };

    app.post('/salons/:salonId/enquiries', (request, reply) =>
        controller.create(request, reply)
    );
    app.get('/salons/:salonId/enquiries', enquiryManager, (request) =>
        controller.list(request)
    );
    app.patch(
        '/salons/:salonId/enquiries/:enquiryId',
        enquiryManager,
        (request) => controller.updateStatus(request)
    );
    app.get(
        '/salons/:salonId/enquiries/:enquiryId/responses',
        enquiryManager,
        (request) => controller.listResponses(request)
    );
    app.post(
        '/salons/:salonId/enquiries/:enquiryId/responses',
        enquiryManager,
        (request, reply) => controller.addResponse(request, reply)
    );
};
