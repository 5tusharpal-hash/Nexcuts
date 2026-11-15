import { z } from 'zod';

const uuid = z.string().uuid();

export const dateRangeQuerySchema = z.object({
    from: z.string().date(),
    to: z.string().date(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
}).refine((value) => value.from <= value.to, {
    path: ['to'],
    message: 'End date must be on or after start date',
});

export const createHolidaySchema = z.object({
    date: z.string().date(),
    name: z.string().trim().min(1).max(160),
    isPaid: z.boolean().default(true),
    note: z.string().trim().max(1000).optional(),
});

export const createLeaveTypeSchema = z.object({
    name: z.string().trim().min(1).max(100),
    isPaid: z.boolean().default(true),
    deductsBalance: z.boolean().default(true),
    isEmergency: z.boolean().default(false),
});

export const createLeaveRequestSchema = z.object({
    leaveTypeId: uuid,
    startsOn: z.string().date(),
    endsOn: z.string().date(),
    requestedDays: z.number().finite().positive().max(366).multipleOf(0.5),
    reason: z.string().trim().min(1).max(2000),
}).refine((value) => value.startsOn <= value.endsOn, {
    path: ['endsOn'],
    message: 'Leave end date must be on or after start date',
}).refine((value) => {
    const start = Date.parse(`${value.startsOn}T00:00:00Z`);
    const end = Date.parse(`${value.endsOn}T00:00:00Z`);
    return value.requestedDays <= (end - start) / 86_400_000 + 1;
}, {
    path: ['requestedDays'],
    message: 'Requested leave days cannot exceed the selected date range',
});

export const reviewLeaveRequestSchema = z.object({
    status: z.enum(['APPROVED', 'REJECTED']),
    note: z.string().trim().max(1000).optional(),
});

export const createLeaveLedgerEntrySchema = z.object({
    leaveTypeId: uuid,
    daysChange: z.number().finite().refine((value) => value !== 0).multipleOf(0.5).min(-366).max(366),
    note: z.string().trim().min(1).max(1000),
});

export const membershipParamSchema = z.object({ membershipId: uuid });
export const requestParamSchema = z.object({ requestId: uuid });
export const holidayParamSchema = z.object({ holidayId: uuid });
export const workParamSchema = z.object({ workId: uuid });
export const tipRequestParamSchema = z.object({ tipRequestId: uuid });

export const createServiceWorkSchema = z.object({
    membershipId: uuid,
    serviceId: uuid,
    sourceType: z.enum(['QUEUE', 'POS']),
    sourceId: uuid,
});

export const createTipRequestSchema = z.object({
    billId: uuid,
    membershipId: uuid,
    amount: z.number().finite().positive().max(99999999.99),
    idempotencyKey: z.string().trim().min(8).max(255),
});

export const reviewTipRequestSchema = z.object({
    status: z.enum(['APPROVED', 'REJECTED']),
    note: z.string().trim().max(1000).optional(),
});

export const createTipRefundRequestSchema = z.object({
    tipRequestId: uuid,
    amount: z.number().finite().positive().multipleOf(0.01).max(99999999.99),
    reason: z.string().trim().min(1).max(1000),
    idempotencyKey: z.string().trim().min(8).max(255),
});

export const reviewTipRefundRequestSchema = z.object({
    status: z.enum(['APPROVED', 'REJECTED']),
    note: z.string().trim().max(1000).optional(),
});

export const completeTipRefundRequestSchema = z.object({
    payoutReference: z.string().trim().min(1).max(255).optional(),
    note: z.string().trim().min(1).max(1000),
});

export const tipRefundRequestParamSchema = z.object({ refundRequestId: uuid });

export const tipListQuerySchema = dateRangeQuerySchema.extend({
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
});

export const tipRefundListQuerySchema = dateRangeQuerySchema.extend({
    status: z.enum(['PENDING', 'PAYOUT_PENDING', 'REJECTED', 'COMPLETED']).optional(),
});

export const leaveListQuerySchema = dateRangeQuerySchema.extend({
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
});
