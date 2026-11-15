import { z } from 'zod';

export const salonTaxRateTypeSchema = z.enum([
    'SERVICE',
    'PRODUCT',
    'PACKAGE',
    'COMBO',
    'CONSUMABLE',
]);

export const createSalonTaxRateSchema = z.object({
    name: z.string().trim().min(1).max(100),
    itemType: salonTaxRateTypeSchema,
    rate: z.number().finite().min(0).max(100),
    isActive: z.boolean().default(true),
});

export const updateSalonTaxRateSchema = z.object({
    name: z.string().trim().min(1).max(100).optional(),
    rate: z.number().finite().min(0).max(100).optional(),
    isActive: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, 'At least one field is required');
