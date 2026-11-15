import { z } from 'zod';

const uuid = z.string().uuid();
const positive = z.number().finite().positive().max(99999999.99);
const contentUnit = z.enum(['ML', 'GRAM', 'UNIT']);
const baseUnit = z.enum(['ML', 'GRAM', 'UNIT', 'PACK']);

export const inventoryPageQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
});

export const inventoryProductListQuerySchema = inventoryPageQuerySchema.extend({
    inventoryType: z.enum(['RETAIL', 'SALON_USE', 'LEGACY_UNCLASSIFIED']).optional(),
    includeInactive: z.preprocess(
        (value) => value === true || value === 'true',
        z.boolean()
    ).default(false),
});

export const inventoryServiceUsageQuerySchema = inventoryPageQuerySchema.extend({
    productId: uuid.optional(),
});

export const createInventoryProductSchema = z.object({
    inventoryType: z.enum(['RETAIL', 'SALON_USE']),
    name: z.string().trim().min(1).max(255),
    sku: z.string().trim().max(100).optional(),
    description: z.string().trim().max(5000).optional(),
    category: z.string().trim().max(100).optional(),
    baseUnit,
    contentQuantity: positive.optional(),
    contentUnit: contentUnit.optional(),
    reorderLevel: z.number().finite().nonnegative().max(99999999.99).default(0),
    lowStockAlertEnabled: z.boolean().default(false),
    costPrice: z.number().finite().nonnegative().max(99999999.99).optional(),
    retailPrice: z.number().finite().nonnegative().max(99999999.99).optional(),
    barcodes: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
}).superRefine((value, context) => {
    if ((value.contentQuantity === undefined) !== (value.contentUnit === undefined)) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['contentQuantity'],
            message: 'Content quantity and unit must be provided together',
        });
    }
    if (value.inventoryType === 'RETAIL' && value.retailPrice === undefined) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['retailPrice'],
            message: 'Retail products require a retail price',
        });
    }
    if (value.baseUnit !== 'UNIT' && value.baseUnit !== 'PACK') {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['baseUnit'],
            message: 'New inventory products must be tracked as whole units or packs',
        });
    }
});

export const updateInventoryProductSchema = z.object({
    name: z.string().trim().min(1).max(255).optional(),
    sku: z.string().trim().max(100).nullable().optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    category: z.string().trim().max(100).nullable().optional(),
    contentQuantity: positive.nullable().optional(),
    contentUnit: contentUnit.nullable().optional(),
    reorderLevel: z.number().finite().nonnegative().max(99999999.99).optional(),
    lowStockAlertEnabled: z.boolean().optional(),
    costPrice: z.number().finite().nonnegative().max(99999999.99).nullable().optional(),
    retailPrice: z.number().finite().nonnegative().max(99999999.99).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, 'At least one field must be provided');

export const classifyLegacyProductSchema = z.object({
    inventoryType: z.enum(['RETAIL', 'SALON_USE']),
});

export const receiveInventoryBatchSchema = z.object({
    batchNumber: z.string().trim().max(100).optional(),
    expiryDate: z.string().date().optional(),
    quantity: positive,
    costPerUnit: z.number().finite().nonnegative().max(99999999.99).optional(),
});

export const inventoryAdjustmentSchema = z.object({
    batchId: uuid,
    quantityChange: z.number().finite().refine((value) => value !== 0).max(99999999.99).min(-99999999.99),
    reason: z.enum(['DAMAGE', 'LOSS', 'WASTE', 'EXPIRY', 'STOCK_COUNT', 'FOUND', 'RETURN']),
    note: z.string().trim().min(1).max(1000),
}).superRefine((value, context) => {
    if (['DAMAGE', 'LOSS', 'WASTE', 'EXPIRY'].includes(value.reason) && value.quantityChange > 0) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['quantityChange'],
            message: `${value.reason} adjustments must decrease stock`,
        });
    }
    if (['FOUND', 'RETURN'].includes(value.reason) && value.quantityChange < 0) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['quantityChange'],
            message: `${value.reason} adjustments must increase stock`,
        });
    }
});

export const barcodeLookupSchema = z.object({
    barcode: z.string().trim().min(1).max(100),
});

export const createConsumableMappingSchema = z.object({
    productId: uuid,
    quantityRequired: positive,
});

export const createInventoryIssueSchema = z.object({
    productId: uuid,
    targetType: z.enum(['STAFF', 'FLOOR']),
    targetMembershipId: uuid.optional(),
    quantity: positive.int(),
    note: z.string().trim().max(1000).optional(),
}).superRefine((value, context) => {
    if (value.targetType === 'STAFF' && !value.targetMembershipId) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['targetMembershipId'],
            message: 'A staff membership is required for a staff assignment',
        });
    }
    if (value.targetType === 'FLOOR' && value.targetMembershipId) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['targetMembershipId'],
            message: 'Shared-floor assignments cannot target a staff membership',
        });
    }
});

export const reviewInventoryIssueSchema = z.object({
    status: z.enum(['ISSUED', 'REJECTED']),
    batchId: uuid.optional(),
    reason: z.string().trim().max(1000).optional(),
    expiredOverrideReason: z.string().trim().min(1).max(1000).optional(),
}).superRefine((value, context) => {
    if (value.status === 'ISSUED' && !value.batchId) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['batchId'],
            message: 'Select the actual batch being handed over',
        });
    }
    if (value.status === 'REJECTED' && !value.reason) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['reason'],
            message: 'A reason is required when rejecting an inventory request',
        });
    }
});

export const closeInventoryIssueSchema = z.object({
    status: z.enum(['EMPTY', 'RETURNED', 'DAMAGED', 'LOST', 'WASTED']),
    note: z.string().trim().min(1).max(1000),
});
