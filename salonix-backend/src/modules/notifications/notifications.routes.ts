import type { FastifyPluginAsync } from 'fastify';
import { AuthMiddleware } from '../auth/auth.middleware.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsRepository } from './notifications.repository.js';
import { NotificationService } from './notifications.service.js';

const authMiddleware = new AuthMiddleware();

export const notificationsRoutes: FastifyPluginAsync = async (app) => {
    const controller = new NotificationsController(
        new NotificationService(new NotificationsRepository())
    );
    const authenticated = {
        preHandler: (
            request: Parameters<typeof authMiddleware.verifyToken>[0],
            reply: Parameters<typeof authMiddleware.verifyToken>[1]
        ) => authMiddleware.verifyToken(request, reply),
    };

    app.get('/me/notifications', authenticated, (request) =>
        controller.getHistory(request)
    );
    app.patch('/me/notifications/:notificationId', authenticated, (request) =>
        controller.markRead(request)
    );
    app.get('/me/notification-preferences', authenticated, (request) =>
        controller.getPreferences(request)
    );
    app.put('/me/notification-preferences', authenticated, (request) =>
        controller.updatePreferences(request)
    );
};
