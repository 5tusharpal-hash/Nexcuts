import { NotificationsRepository } from './notifications.repository.js';
import {
    NotificationPreferences,
    NotificationQuery,
    NotificationRequest,
} from './notifications.types.js';

export class NotificationService {
    constructor(private readonly repository: NotificationsRepository) {}

    async getHistory(accountId: string, query: NotificationQuery) {
        return this.repository.getNotificationHistory(accountId, query);
    }

    async markRead(accountId: string, notificationId: string) {
        await this.repository.markRead(accountId, notificationId);
    }

    async getPreferences(accountId: string) {
        return this.repository.getPreferences(accountId);
    }

    async updatePreferences(
        accountId: string,
        preferences: NotificationPreferences
    ) {
        return this.repository.updatePreferences(accountId, preferences);
    }

    async createInAppNotification(
        notification: Omit<NotificationRequest, 'channel'>
    ) {
        return this.repository.logNotification({
            ...notification,
            channel: 'IN_APP',
        });
    }
}
