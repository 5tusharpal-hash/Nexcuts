import { z } from 'zod';

const uuidSchema = z.string().uuid();
const categoryKeySchema = z.string().trim().toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(80);
const priceSchema = z.string().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/);

export const createServiceSchema = z.object({
  categoryId: uuidSchema.optional(),
  name: z.string().trim().min(2).max(255),
  description: z.string().trim().max(4000).optional(),
  estimatedDurationMinutes: z.number().int().min(5).max(1440),
  basePrice: priceSchema,
  targetAudience: z.enum(['MEN', 'WOMEN', 'KIDS', 'UNISEX']).default('UNISEX'),
  isPublic: z.boolean().default(true),
  isActive: z.boolean().default(true),
  defaultImageId: uuidSchema.optional(),
}).strict();

export const updateServiceSchema = z.object({
  categoryId: uuidSchema.nullable().optional(),
  name: z.string().trim().min(2).max(255).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  estimatedDurationMinutes: z.number().int().min(5).max(1440).optional(),
  basePrice: priceSchema.optional(),
  targetAudience: z.enum(['MEN', 'WOMEN', 'KIDS', 'UNISEX']).optional(),
  isPublic: z.boolean().optional(),
  isActive: z.boolean().optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one service field must be provided',
});

export const listServicesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().trim().min(1).max(120).optional(),
  categoryId: uuidSchema.optional(),
  targetAudience: z.enum(['MEN', 'WOMEN', 'KIDS', 'UNISEX']).optional(),
  sortBy: z.enum(['name', 'price', 'duration', 'createdAt']).default('name'),
  sortDirection: z.enum(['asc', 'desc']).default('asc'),
  includeInactive: z.enum(['true', 'false']).default('false')
    .transform((value) => value === 'true'),
}).strict();

export const createServiceCategorySchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional(),
  defaultImageCategoryKey: categoryKeySchema.optional(),
  displayOrder: z.number().int().min(0).max(100_000).default(0),
}).strict();

export const updateServiceCategorySchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  defaultImageCategoryKey: categoryKeySchema.nullable().optional(),
  displayOrder: z.number().int().min(0).max(100_000).optional(),
  isActive: z.boolean().optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one category field must be provided',
});

export const listCategoriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

export const galleryCategorySchema = z.object({
  categoryName: z.string().trim().min(2).max(100),
  displayOrder: z.number().int().min(0).max(100_000).default(0),
}).strict();

export const updateGalleryCategorySchema = z.object({
  categoryName: z.string().trim().min(2).max(100).optional(),
  displayOrder: z.number().int().min(0).max(100_000).optional(),
  isActive: z.boolean().optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one category field must be provided',
});

export const galleryImageMetadataSchema = z.object({
  categoryId: uuidSchema,
  altText: z.string().trim().max(255).optional(),
  isFeatured: z.boolean().default(false),
  displayOrder: z.number().int().min(0).max(100_000).default(0),
}).strict();

export const updateGalleryImageSchema = z.object({
  categoryId: uuidSchema.optional(),
  altText: z.string().trim().max(255).nullable().optional(),
  isFeatured: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(100_000).optional(),
  isActive: z.boolean().optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one image field must be provided',
});

export const defaultImagesQuerySchema = z.object({
  categoryKey: categoryKeySchema,
}).strict();

export const setGalleryQuotaOverrideSchema = z.object({
  limit: z.number().int().min(0).max(1000),
  reason: z.string().trim().min(5).max(1000),
  expiresAt: z.iso.datetime().optional(),
}).strict();

export const serviceImageSettingsSchema = z.object({
  serviceImageRequired: z.boolean(),
}).strict();

export const defaultImageAdminMetadataSchema = z.object({
  categoryKey: categoryKeySchema,
  altText: z.string().trim().max(255).optional(),
}).strict();

export const updateDefaultImageSchema = z.object({
  isActive: z.boolean().optional(),
  altText: z.string().trim().max(255).nullable().optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one default image field must be provided',
});
