import { z } from 'zod';

export const customerLedgerQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const customerLedgerBillParamsSchema = z.object({
    billId: z.string().uuid(),
});
