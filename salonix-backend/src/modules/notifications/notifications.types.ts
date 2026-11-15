import type { Prisma } from '../../generated/prisma/client.js';

export interface NotificationRequest {
    userId: string;
    salonId?: string;
    title: string;
    message: string;
    channel: 'WHATSAPP' | 'SMS' | 'PUSH' | 'EMAIL' | 'IN_APP';
    priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
    metadata?: Prisma.InputJsonValue;
}

export interface NotificationLog {
    id: string;
    userId: string;
    salonId?: string;
    title: string;
    message: string;
    status: 'PENDING' | 'SENT' | 'FAILED' | 'READ';
    createdAt: Date;
    channel: string;
    priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
    metadata: unknown;
}

export interface NotificationQuery {
    limit: number;
    offset: number;
}

export interface NotificationPreferences {
    pushEnabled: boolean;
    emailEnabled: boolean;
    smsEnabled: boolean;
    whatsappEnabled: boolean;
}

export interface NotificationHistory {
    items: NotificationLog[];
    total: number;
    unreadCount: number;
}
