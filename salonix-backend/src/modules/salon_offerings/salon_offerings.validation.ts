import { z } from 'zod';

const uuidSchema = z.string().uuid();
const moneySchema = z.string().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/);
const statusSchema = z.enum(['DRAFT', 'UNLISTED', 'LISTED', 'ARCHIVED']);
const serviceIdsSchema = z.array(uuidSchema).min(1).max(100)
  .refine((ids) => new Set(ids).size === ids.length, 'Service IDs must be unique');
const packageServicesSchema = z.array(z.object({
  serviceId: uuidSchema,
  maxUses: z.number().int().positive().optional(),
}).strict()).min(1).max(100)
  .refine(
    (services) => new Set(services.map(({ serviceId }) => serviceId)).size === services.length,
    'Service IDs must be unique'
  );

export const createPackageSchema = z.object({
  name: z.string().trim().min(2).max(255),
  description: z.string().trim().max(4000).optional(),
  sellingPrice: moneySchema,
  creditAmount: moneySchema,
  validityDays: z.number().int().min(1).max(3650),
  services: packageServicesSchema,
  status: statusSchema.default('DRAFT'),
}).strict();

export const updatePackageSchema = z.object({
  name: z.string().trim().min(2).max(255).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  sellingPrice: moneySchema.optional(),
  creditAmount: moneySchema.optional(),
  validityDays: z.number().int().min(1).max(3650).optional(),
  services: packageServicesSchema.optional(),
  status: statusSchema.optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one package field must be provided',
});

export const createComboSchema = z.object({
  name: z.string().trim().min(2).max(255),
  description: z.string().trim().max(4000).optional(),
  sellingPrice: moneySchema,
  validityDays: z.number().int().min(1).max(3650),
  serviceIds: serviceIdsSchema.min(2),
  status: statusSchema.default('DRAFT'),
}).strict();

export const updateComboSchema = z.object({
  name: z.string().trim().min(2).max(255).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  sellingPrice: moneySchema.optional(),
  validityDays: z.number().int().min(1).max(3650).optional(),
  serviceIds: serviceIdsSchema.min(2).optional(),
  status: statusSchema.optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one combo field must be provided',
});

export const listOfferingsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  type: z.enum(['PACKAGE', 'COMBO']).optional(),
}).strict();

export const createPurchaseRequestSchema = z.object({
  offerType: z.enum(['PACKAGE', 'COMBO']),
  offeringId: uuidSchema,
  paymentMode: z.enum(['CASH', 'UPI', 'CARD', 'OTHER']).optional(),
}).strict();

export const createManualOfferSaleSchema = createPurchaseRequestSchema.extend({
  customerPhone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/),
  finalAmount: moneySchema,
  discountReason: z.string().trim().min(3).max(1000).optional(),
  idempotencyKey: z.string().trim().min(8).max(255),
}).strict().refine(
  ({ finalAmount, discountReason }) =>
    Number(finalAmount) === 0 ? Boolean(discountReason) : true,
  { message: 'A reason is required for a complimentary sale', path: ['discountReason'] }
);

export const updateOfferSaleQuoteSchema = z.object({
  finalAmount: moneySchema,
  discountReason: z.string().trim().min(3).max(1000).optional(),
}).strict().refine(
  ({ finalAmount, discountReason }) =>
    Number(finalAmount) === 0 ? Boolean(discountReason) : true,
  { message: 'A reason is required for a complimentary sale', path: ['discountReason'] }
);

export const rejectOfferPurchaseSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
}).strict();

export const confirmOfferSettlementSchema = z.object({
  billId: uuidSchema,
  idempotencyKey: z.string().trim().min(8).max(255),
}).strict();

export const attachOfferBillSchema = z.object({
  billId: uuidSchema,
}).strict();

export const redeemPackageSchema = z.object({
  serviceId: uuidSchema,
  billId: uuidSchema,
  idempotencyKey: z.string().trim().min(8).max(255),
}).strict();

export const redeemComboSchema = z.object({
  serviceIds: serviceIdsSchema.min(2),
  billId: uuidSchema,
  idempotencyKey: z.string().trim().min(8).max(255),
}).strict();

export const listPurchaseRequestsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(['PENDING', 'BILLING', 'ACCEPTED', 'REJECTED', 'CANCELLED']).optional(),
  type: z.enum(['PACKAGE', 'COMBO']).optional(),
}).strict();
