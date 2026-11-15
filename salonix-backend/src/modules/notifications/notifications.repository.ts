import { prisma } from '../../bootstrap/db.connect';
import { ApiError } from '../../shared/errors/ApiError.js';
import {
    NotificationHistory,
    NotificationLog,
    NotificationPreferences,
    NotificationQuery,
    NotificationRequest,
} from './notifications.types';

export class NotificationsRepository {
    async logNotification(data: NotificationRequest): Promise<NotificationLog> {
        const notification = await prisma.accountNotification.create({
            data: {
                accountId: data.userId,
                salonId: data.salonId,
                title: data.title,
                body: data.message,
                channel: data.channel,
                priority: data.priority,
                metadata: data.metadata ?? {},
            },
        });
        return this.toNotificationLog(notification);
    }

    async getNotificationHistory(
        userId: string,
        query: NotificationQuery
    ): Promise<NotificationHistory> {
        const where = { accountId: userId };
        const [notifications, total, unreadCount] = await Promise.all([
            prisma.accountNotification.findMany({
                where,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                take: query.limit,
                skip: query.offset,
            }),
            prisma.accountNotification.count({ where }),
            prisma.accountNotification.count({ where: { ...where, status: { not: 'READ' } } }),
        ]);
        return {
            items: notifications.map((notification) => this.toNotificationLog(notification)),
            total,
            unreadCount,
        };
    }

    async markRead(userId: string, notificationId: string): Promise<void> {
        const result = await prisma.accountNotification.updateMany({
            where: { id: notificationId, accountId: userId, status: { not: 'READ' } },
            data: { status: 'READ', readAt: new Date() },
        });
        if (result.count === 0) {
            const notification = await prisma.accountNotification.findFirst({
                where: { id: notificationId, accountId: userId },
                select: { id: true },
            });
            if (!notification) throw new ApiError(404, 'Notification not found');
        }
    }

    async getPreferences(userId: string): Promise<NotificationPreferences> {
        const preferences = await prisma.customerNotificationPreference.findUnique({
            where: { customerAccountId: userId },
        });
        return {
            pushEnabled: preferences?.pushEnabled ?? true,
            emailEnabled: preferences?.emailEnabled ?? true,
            smsEnabled: preferences?.smsEnabled ?? false,
            whatsappEnabled: preferences?.whatsappEnabled ?? false,
        };
    }

    async updatePreferences(
        userId: string,
        preferences: NotificationPreferences
    ): Promise<NotificationPreferences> {
        const updated = await prisma.customerNotificationPreference.upsert({
            where: { customerAccountId: userId },
            create: { customerAccountId: userId, ...preferences },
            update: preferences,
        });
        return {
            pushEnabled: updated.pushEnabled,
            emailEnabled: updated.emailEnabled,
            smsEnabled: updated.smsEnabled,
            whatsappEnabled: updated.whatsappEnabled,
        };
    }

    private toNotificationLog(
        notification: Awaited<ReturnType<typeof prisma.accountNotification.create>>
    ): NotificationLog {
        return {
            id: notification.id,
            userId: notification.accountId,
            salonId: notification.salonId ?? undefined,
            title: notification.title,
            message: notification.body,
            status: notification.status as NotificationLog['status'],
            createdAt: notification.createdAt,
            channel: notification.channel,
            priority: notification.priority as NotificationLog['priority'],
            metadata: notification.metadata,
        };
    }
}
