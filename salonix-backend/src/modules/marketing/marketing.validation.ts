import { z } from 'zod';

export const createMarketingCampaignSchema = z.object({
    name: z.string().trim().min(1).max(255),
    titleTemplate: z.string().trim().min(1).max(255),
    bodyTemplate: z.string().trim().min(1).max(4000),
    scheduledAt: z.string().datetime().optional(),
    channels: z.array(z.enum(['IN_APP', 'EMAIL', 'WHATSAPP']))
        .min(1)
        .max(3)
        .refine((channels) => new Set(channels).size === channels.length, 'Channels must be unique')
        .optional(),
}).strict();

export const sendMarketingCampaignSchema = z.object({
    channel: z.enum(['IN_APP', 'EMAIL', 'WHATSAPP']),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const marketingDeliveryQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const queueJoinConsentSchema = z.object({
    serviceId: z.string().uuid(),
    marketingConsent: z.boolean(),
}).strict();
