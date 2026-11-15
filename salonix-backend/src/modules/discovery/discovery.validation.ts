import { z } from 'zod';

export const publicSalonSlugSchema = z.string().trim().min(1).max(255);

export const discoveryQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const salonSearchQuerySchema = discoveryQuerySchema.extend({
    query: z.string().trim().min(1).max(120).optional(),
    city: z.string().trim().min(1).max(120).optional(),
    service: z.string().trim().min(1).max(120).optional(),
}).refine(
    (value) => Boolean(value.query || value.city || value.service),
    'Provide at least one of query, city, or service'
);
