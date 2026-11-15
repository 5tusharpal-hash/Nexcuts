import { z } from 'zod';

export const notificationQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const notificationParamsSchema = z.object({
    notificationId: z.string().uuid(),
});

export const markNotificationReadSchema = z.object({
    read: z.literal(true),
});

export const notificationPreferencesSchema = z.object({
    pushEnabled: z.boolean(),
    emailEnabled: z.boolean(),
    smsEnabled: z.boolean(),
    whatsappEnabled: z.boolean(),
});
