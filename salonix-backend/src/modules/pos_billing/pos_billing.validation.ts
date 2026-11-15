import { z } from 'zod';

const uuid = z.string().uuid();
const amount = z.number().finite().positive().max(99999999.99);
const optionalDiscount = {
    discountType: z.enum(['PERCENT', 'FIXED']).optional(),
    discountValue: z.number().finite().nonnegative().max(99999999.99).optional(),
    taxRate: z.number().finite().min(0).max(100).optional(),
    taxInclusive: z.boolean().optional(),
    taxOverrideReason: z.string().trim().min(1).max(1000).optional(),
    description: z.string().trim().max(1000).optional(),
    staffMembershipId: uuid.optional(),
    parentBillItemId: uuid.optional(),
};

const serviceLine = z.object({
    itemType: z.literal('SERVICE'),
    serviceId: uuid,
    quantity: z.number().finite().positive().max(999999),
    ...optionalDiscount,
});

const productLine = z.object({
    itemType: z.literal('PRODUCT'),
    productId: uuid,
    quantity: z.number().int().positive().max(999999),
    batchAllocations: z.array(z.object({
        batchId: uuid,
        quantity: z.number().int().positive().max(999999),
        expiredOverrideReason: z.string().trim().min(1).max(1000).optional(),
    })).min(1).max(100),
    ...optionalDiscount,
});

const offerLine = z.object({
    itemType: z.enum(['PACKAGE', 'COMBO']),
    offerPurchaseRequestId: uuid,
    quantity: z.literal(1).default(1),
    description: z.string().trim().max(1000).optional(),
});

export const createPosSessionSchema = z.object({
    customerAccountId: uuid,
    bookingId: uuid.optional(),
    queueEntryId: uuid.optional(),
    origin: z.enum(['QUEUE', 'WALK_IN', 'OFFLINE_SALE']),
}).refine((value) => !(value.bookingId && value.queueEntryId), {
    message: 'A POS session cannot link both a booking and a queue entry',
});

export const posBillItemsSchema = z.object({
    items: z.array(z.discriminatedUnion('itemType', [
        serviceLine,
        productLine,
        offerLine,
    ])).min(1).max(100),
}).superRefine(({ items }, context) => {
    const offerLines = items.filter((item) => item.itemType === 'PACKAGE' || item.itemType === 'COMBO');
    if (offerLines.length > 1) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['items'],
            message: 'A bill can contain only one package or combo sale; create another bill for additional offers',
        });
    }
    for (const [index, item] of items.entries()) {
        if (item.itemType === 'PRODUCT') {
            const allocatedQuantity = item.batchAllocations.reduce(
                (sum, allocation) => sum + allocation.quantity,
                0
            );
            if (allocatedQuantity !== item.quantity) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['items', index, 'batchAllocations'],
                    message: 'Selected batch quantities must equal the product line quantity',
                });
            }
            const batchIds = item.batchAllocations.map((allocation) => allocation.batchId);
            if (batchIds.length !== new Set(batchIds).size) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['items', index, 'batchAllocations'],
                    message: 'A batch can appear only once per product line',
                });
            }
        }
        if ('discountValue' in item && Boolean(item.discountType) !== (item.discountValue !== undefined)) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['items', index, 'discountValue'],
                message: 'Discount type and value must be provided together',
            });
        }
        if (
            ('taxRate' in item && item.taxRate !== undefined) ||
            ('taxInclusive' in item && item.taxInclusive !== undefined)
        ) {
            if (!('taxOverrideReason' in item) || !item.taxOverrideReason) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['items', index, 'taxOverrideReason'],
                    message: 'A reason is required for a per-bill tax override',
                });
            }
        }
    }
});

export const recordPosPaymentSchema = z.object({
    paymentMode: z.enum(['CASH', 'UPI', 'CARD', 'OTHER']),
    amount,
    transactionReference: z.string().trim().max(255).optional(),
    idempotencyKey: z.string().trim().min(8).max(255),
});

export const createPaymentClaimSchema = z.object({
    billId: uuid,
    billVersionId: uuid,
    paymentMode: z.enum(['CASH', 'UPI', 'CARD', 'OTHER']),
    amount,
    transactionReference: z.string().trim().max(255).optional(),
    idempotencyKey: z.string().trim().min(8).max(255),
});

export const createAdvanceClaimSchema = z.object({
    paymentMode: z.enum(['CASH', 'UPI', 'CARD', 'OTHER']),
    amount,
    transactionReference: z.string().trim().max(255).optional(),
    idempotencyKey: z.string().trim().min(8).max(255),
});

export const allocateAdvanceSchema = z.object({
    advanceEntryId: uuid,
    amount,
    idempotencyKey: z.string().trim().min(8).max(255),
});

export const reviewPaymentClaimSchema = z.object({
    status: z.enum(['APPROVED', 'REJECTED']),
    reason: z.string().trim().min(1).max(1000).optional(),
}).refine((value) => value.status !== 'REJECTED' || Boolean(value.reason), {
    message: 'A reason is required when rejecting a payment claim',
    path: ['reason'],
});

export const issueBillVersionSchema = z.object({
    customerMessage: z.string().trim().max(1000).optional(),
});

export const confirmPosBillSchema = z.object({
    versionId: uuid,
});

export const createWalletRedemptionSchema = z.object({
    billId: uuid,
    versionId: uuid,
    allocations: z.array(z.object({
        type: z.enum(['PACKAGE', 'COMBO', 'LOYALTY']),
        entitlementId: uuid.optional(),
        billItemId: uuid.optional(),
        amount,
        serviceId: uuid.optional(),
    })).min(1).max(20),
    idempotencyKey: z.string().trim().min(8).max(255),
}).superRefine(({ allocations }, context) => {
    allocations.forEach((allocation, index) => {
        if (allocation.type !== 'LOYALTY' && !allocation.entitlementId) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['allocations', index, 'entitlementId'],
                message: 'An entitlement ID is required for package and combo redemptions',
            });
        }
        if (allocation.type !== 'LOYALTY' && !allocation.billItemId) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['allocations', index, 'billItemId'],
                message: 'A bill item ID is required for package and combo redemptions',
            });
        }
    });
});

export const verifyWalletRedemptionSchema = z.object({
    code: z.string().regex(/^\d{6}$/),
});

export const reviewWalletRedemptionSchema = reviewPaymentClaimSchema;

export const createPosRefundSchema = z.object({
    amount: amount.refine((value) => Number(value.toFixed(2)) === value, {
        message: 'Refund amounts must use at most two decimal places',
    }),
    reason: z.enum(['SERVICE_ISSUE', 'BRANCH_PAUSE', 'CUSTOMER_REQUEST', 'ERROR']),
    paymentId: uuid.optional(),
    idempotencyKey: z.string().trim().min(8).max(255),
});

export const posListQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
});

export const posTaxCategorySchema = z.enum([
    'SERVICE', 'PRODUCT', 'PACKAGE', 'COMBO', 'CONSUMABLE',
]);

export const posCategorySettingSchema = z.object({
    taxMode: z.enum(['INCLUSIVE', 'EXCLUSIVE']),
    allowPackage: z.boolean(),
    allowCombo: z.boolean(),
    allowLoyalty: z.boolean(),
    reason: z.string().trim().min(1).max(1000),
});

export const posBillCategoryOverrideSchema = z.object({
    allowPackage: z.boolean(),
    allowCombo: z.boolean(),
    allowLoyalty: z.boolean(),
    reason: z.string().trim().min(1).max(1000),
});

export const reviewPosRefundSchema = z.object({
    status: z.enum(['COMPLETED', 'CANCELLED']),
    reason: z.string().trim().min(1).max(1000).optional(),
    cashPayoutConfirmed: z.literal(true).optional(),
    payoutReference: z.string().trim().min(1).max(255).optional(),
}).refine((value) => value.status !== 'CANCELLED' || Boolean(value.reason), {
    message: 'A reason is required when cancelling a refund request',
    path: ['reason'],
}).refine((value) => value.status !== 'COMPLETED' || value.cashPayoutConfirmed === true, {
    message: 'Confirm the cash payout before completing the refund',
    path: ['cashPayoutConfirmed'],
});
