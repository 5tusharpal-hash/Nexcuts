import { z } from 'zod';

export const enquiryParamsSchema = z.object({
    salonId: z.string().uuid(),
});

export const enquiryItemParamsSchema = enquiryParamsSchema.extend({
    enquiryId: z.string().uuid(),
});

export const createEnquirySchema = z.object({
    customerName: z.string().trim().min(1).max(255),
    customerPhone: z.string().regex(/^\+[1-9]\d{7,14}$/),
    customerEmail: z.string().email().max(320).optional(),
    serviceInterest: z.string().trim().max(1000).optional(),
    message: z.string().trim().min(1).max(5000),
});

const paginationQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const enquiryListQuerySchema = paginationQuerySchema.extend({
    status: z.enum(['NEW', 'CONTACTED', 'NEGOTIATING', 'CLOSED']).optional(),
});
export const enquiryResponsesQuerySchema = paginationQuerySchema;

export const updateEnquiryStatusSchema = z.object({
    status: z.enum(['CONTACTED', 'NEGOTIATING', 'CLOSED']),
});

export const createEnquiryResponseSchema = z.object({
    note: z.string().trim().min(1).max(2000),
    isExternalReply: z.boolean().default(false),
});
