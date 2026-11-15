import type { FastifyPluginAsync } from 'fastify';
import { AuthMiddleware } from '../auth/auth.middleware.js';
import { QueueController } from './queue.controller.js';
import { QueueService } from './queue.service.js';
import { QueueRepository } from './queue.repository.js';

const authMiddleware = new AuthMiddleware();

export const queueRoutes: FastifyPluginAsync = async (app) => {
    const repository = new QueueRepository();
    const service = new QueueService(repository);
    const controller = new QueueController(service);
    const authenticated = {
        preHandler: (
            request: Parameters<typeof authMiddleware.verifyToken>[0],
            reply: Parameters<typeof authMiddleware.verifyToken>[1]
        ) => authMiddleware.verifyToken(request, reply),
    };

    app.post('/join', authenticated, (request, reply) => controller.join(request, reply));
    app.post('/call-next', authenticated, (request, reply) => controller.callNext(request, reply));
    app.post('/:entryId/complete', authenticated, (request, reply) => controller.markCompleted(request, reply));
    app.post('/:entryId/no-show', authenticated, (request, reply) => controller.markNoShow(request, reply));
    app.post('/:entryId/leave', authenticated, (request, reply) => controller.leave(request, reply));
    app.get('/position', authenticated, (request, reply) => controller.getPosition(request, reply));
    app.get('/advanced-plan', authenticated, (request, reply) => controller.getAdvancedPlan(request, reply));
    app.post('/assignments/override', authenticated, (request, reply) => controller.overrideAssignment(request, reply));
    app.post('/service-overruns', authenticated, (request, reply) => controller.reportOverrun(request, reply));
    app.get('/closing-requests', authenticated, (request, reply) => controller.getClosingRequests(request, reply));
    app.post('/closing-requests/:requestId/decision', authenticated, (request, reply) => controller.decideClosingRequest(request, reply));
};
