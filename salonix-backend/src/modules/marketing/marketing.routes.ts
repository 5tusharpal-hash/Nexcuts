import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../../bootstrap/db.connect.js';
import { AuthMiddleware } from '../auth/auth.middleware.js';
import { RbacMiddleware } from '../rbac/rbac.middleware.js';
import { QueueRepository } from '../queue/queue.repository.js';
import { QueueService } from '../queue/queue.service.js';
import { EmailIntegration } from '../../integrations/email/email.integration.js';
import { WhatsAppIntegration } from '../../integrations/whatsapp/whatsapp.integration.js';
import { MarketingController } from './marketing.controller.js';
import { MarketingRepository } from './marketing.repository.js';
import { MarketingService } from './marketing.service.js';

const authMiddleware = new AuthMiddleware();
const rbacMiddleware = new RbacMiddleware();

export const marketingRoutes: FastifyPluginAsync = async (app) => {
    const repository = new MarketingRepository(pool);
    const service = new MarketingService(
        repository,
        new EmailIntegration(),
        new WhatsAppIntegration()
    );
    const controller = new MarketingController(
        service,
        repository,
        new QueueService(new QueueRepository())
    );
    const authenticate = (
        request: Parameters<typeof authMiddleware.verifyToken>[0],
        reply: Parameters<typeof authMiddleware.verifyToken>[1]
    ) => authMiddleware.verifyToken(request, reply);
    const customerAuth = { preHandler: [authenticate] };
    const campaignManager = {
        preHandler: [authenticate, rbacMiddleware.check('marketing:manage')],
    };

    app.post('/me/salons/:salonId/queue-entries', customerAuth, (request, reply) =>
        controller.joinQueue(request, reply)
    );
    app.get('/me/salons/:salonId/marketing-consent', customerAuth, (request) =>
        controller.getConsent(request)
    );
    app.delete('/me/salons/:salonId/marketing-consent', customerAuth, (request) =>
        controller.optOut(request)
    );
    app.post('/salons/:salonId/marketing/campaigns', campaignManager, (request, reply) =>
        controller.createCampaign(request, reply)
    );
    app.post(
        '/salons/:salonId/marketing/campaigns/:campaignId/deliveries',
        campaignManager,
        (request) => controller.sendCampaign(request)
    );
    app.get(
        '/salons/:salonId/marketing/campaigns/:campaignId/deliveries',
        campaignManager,
        (request) => controller.listDeliveries(request)
    );
};
