import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../../bootstrap/db.connect.js';
import { AuthMiddleware } from '../auth/auth.middleware.js';
import { RbacMiddleware } from '../rbac/rbac.middleware.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsRepository } from './analytics.repository.js';
import { AnalyticsService } from './analytics.service.js';

const authMiddleware = new AuthMiddleware();
const rbacMiddleware = new RbacMiddleware();

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
    const controller = new AnalyticsController(
        new AnalyticsService(new AnalyticsRepository(pool))
    );
    const analyticsViewer = {
        preHandler: [
            (request: Parameters<typeof authMiddleware.verifyToken>[0], reply: Parameters<typeof authMiddleware.verifyToken>[1]) =>
                authMiddleware.verifyToken(request, reply),
            rbacMiddleware.check('billing:view'),
        ],
    };

    app.get('/salons/:salonId/analytics/branch-reports', analyticsViewer, (request) =>
        controller.getBranchReport(request)
    );
    app.get('/salons/:salonId/analytics/churn-alerts', analyticsViewer, (request) =>
        controller.getChurnAlerts(request)
    );
};
