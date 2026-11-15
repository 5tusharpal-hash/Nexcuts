import { z } from 'zod';

const dateTimeSchema = z.string().datetime({ offset: true }).transform((value) => new Date(value));

export const branchAnalyticsQuerySchema = z.object({
    startDate: dateTimeSchema,
    endDate: dateTimeSchema,
}).refine(({ startDate, endDate }) => startDate < endDate, {
    message: 'endDate must be after startDate',
    path: ['endDate'],
});

export const churnAlertQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
