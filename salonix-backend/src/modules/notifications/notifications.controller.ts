import type { FastifyRequest } from 'fastify';
import { ApiError } from '../../shared/errors/ApiError.js';
import { requireRouteParam } from '../../shared/utils/request.js';
import { NotificationService } from './notifications.service.js';
import {
    markNotificationReadSchema,
    notificationParamsSchema,
    notificationPreferencesSchema,
    notificationQuerySchema,
} from './notifications.validation.js';

export class NotificationsController {
    constructor(private readonly service: NotificationService) {}

    async getHistory(request: FastifyRequest) {
        const query = notificationQuerySchema.parse(request.query);
        return {
            success: true,
            data: await this.service.getHistory(this.customerId(request), query),
        };
    }

    async markRead(request: FastifyRequest) {
        const { notificationId } = notificationParamsSchema.parse({
            notificationId: requireRouteParam(request.params, 'notificationId'),
        });
        markNotificationReadSchema.parse(request.body);
        await this.service.markRead(this.customerId(request), notificationId);
        return { success: true };
    }

    async getPreferences(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.getPreferences(this.customerId(request)),
        };
    }

    async updatePreferences(request: FastifyRequest) {
        const preferences = notificationPreferencesSchema.parse(request.body);
        return {
            success: true,
            data: await this.service.updatePreferences(
                this.customerId(request),
                preferences
            ),
        };
    }

    private customerId(request: FastifyRequest): string {
        if (!request.user || request.user.account_type !== 'CUSTOMER') {
            throw new ApiError(403, 'A customer account is required');
        }
        return request.user.id;
    }
}
