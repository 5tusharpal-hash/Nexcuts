import { z } from 'zod';

const reasonSchema = z.string().trim().min(3).max(1000);
const featureKeySchema = z.string().trim().min(1).max(100).regex(/^[a-z][a-z0-9_.-]*$/);

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const adminSalonListSchema = paginationSchema.extend({
  search: z.string().trim().min(1).max(120).optional(),
  applicationStatus: z.enum(['PENDING', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED']).optional(),
  salonStatus: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED']).optional(),
  city: z.string().trim().min(1).max(120).optional(),
});

export const adminAccountListSchema = paginationSchema.extend({
  search: z.string().trim().min(1).max(120).optional(),
  accountType: z.enum(['CUSTOMER', 'SALON', 'PLATFORM', 'ADMIN']).optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
});

export const adminAuditListSchema = paginationSchema.extend({
  resourceType: z.string().trim().min(1).max(120).optional(),
});

export const adminAccountStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  reason: reasonSchema,
});

export const adminPlanUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable(),
  monthlyPrice: z.number().finite().min(0).max(10000000),
  isActive: z.boolean(),
  features: z.record(featureKeySchema, jsonValueSchema),
  reason: reasonSchema,
});

export const adminAddonUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable(),
  price: z.number().finite().min(0).max(10000000),
  isRecurring: z.boolean(),
  isActive: z.boolean(),
  reason: reasonSchema,
});

export const adminSubscriptionUpdateSchema = z.object({
  planId: z.string().uuid(),
  billingCycleStart: z.iso.date(),
  billingCycleEnd: z.iso.date(),
  reason: reasonSchema,
}).refine(
  (value) => value.billingCycleEnd >= value.billingCycleStart,
  { path: ['billingCycleEnd'], message: 'Billing cycle end must not be before its start' }
);

export const adminEntitlementUpdateSchema = z.object({
  featureKey: featureKeySchema,
  featureValue: jsonValueSchema,
  reason: reasonSchema,
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
});

export const adminEntitlementRevokeSchema = z.object({
  reason: reasonSchema,
});

export const adminReasonSchema = z.object({
  reason: reasonSchema,
});

export const adminAddonStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE']),
  reason: reasonSchema,
});

export const adminPasswordResetSchema = z.object({
  reason: reasonSchema,
});

export const salonProfileChangeRequestSchema = z.object({
  organizationName: z.string().trim().min(1).max(255).optional(),
  legalName: z.string().trim().max(255).nullable().optional(),
  salonName: z.string().trim().min(1).max(255).optional(),
  addressLine1: z.string().trim().max(500).nullable().optional(),
  addressLine2: z.string().trim().max(500).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  state: z.string().trim().max(120).nullable().optional(),
  postalCode: z.string().trim().max(24).nullable().optional(),
  countryCode: z.string().trim().regex(/^[A-Z]{2}$/).optional(),
  ownerNote: z.string().trim().max(1000).optional(),
}).refine(
  (value) => Object.keys(value).some((key) => key !== 'ownerNote'),
  { message: 'At least one salon profile field is required' }
);

export const salonProfileChangeReviewSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  reviewNotes: z.string().trim().min(3).max(1000).optional(),
}).refine(
  (value) => value.status !== 'REJECTED' || Boolean(value.reviewNotes),
  { path: ['reviewNotes'], message: 'A reason is required when rejecting a profile change' }
);

export const salonProfileChangeListSchema = paginationSchema.extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING'),
});
