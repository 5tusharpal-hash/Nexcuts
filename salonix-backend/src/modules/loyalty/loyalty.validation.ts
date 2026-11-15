import { z } from 'zod';
import { LOYALTY_CATEGORIES } from './loyalty.types.js';

const category = z.enum(LOYALTY_CATEGORIES);

export const updateLoyaltyProgramSchema = z.object({
    minimumSpend: z.number().finite().nonnegative().max(99_999_999.99),
    rewardPercentage: z.number().finite().min(0).max(100),
    pointConversionRate: z.number().finite().positive().max(9_999.9999),
    pointsExpiryDays: z.number().int().min(1).max(3650).default(365),
    eligibleCategories: z.array(category).max(LOYALTY_CATEGORIES.length)
        .refine((values) => new Set(values).size === values.length, {
            message: 'Eligible categories must be unique',
        }),
    isActive: z.boolean(),
}).superRefine((value, context) => {
    if (value.isActive && value.eligibleCategories.length === 0) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['eligibleCategories'],
            message: 'An active loyalty program needs at least one eligible category',
        });
    }
});

export const loyaltyListQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
});
