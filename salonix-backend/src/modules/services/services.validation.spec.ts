import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createServiceCategorySchema,
  createServiceSchema,
  galleryImageMetadataSchema,
  setGalleryQuotaOverrideSchema,
  updateServiceSchema,
} from './services.validation.js';

test('service request validates price precision, duration, and target audience', () => {
  const valid = createServiceSchema.parse({
    name: 'Haircut',
    estimatedDurationMinutes: 30,
    basePrice: '499.50',
  });
  assert.equal(valid.targetAudience, 'UNISEX');
  assert.equal(valid.isPublic, true);
  assert.equal(valid.isActive, true);
  assert.equal(
    createServiceSchema.safeParse({
      name: 'Haircut',
      estimatedDurationMinutes: 1441,
      basePrice: '499.999',
      targetAudience: 'ALL',
    }).success,
    false
  );
});

test('service updates require at least one known field', () => {
  assert.equal(updateServiceSchema.safeParse({}).success, false);
  assert.equal(updateServiceSchema.safeParse({ base_price: '300' }).success, false);
  assert.equal(updateServiceSchema.safeParse({ isActive: false }).success, true);
});

test('service category keys and gallery metadata are constrained', () => {
  assert.equal(
    createServiceCategorySchema.safeParse({
      name: 'Hair',
      defaultImageCategoryKey: 'hair-styling',
    }).success,
    true
  );
  assert.equal(
    createServiceCategorySchema.safeParse({
      name: 'Hair',
      defaultImageCategoryKey: '../private',
    }).success,
    false
  );
  assert.equal(
    galleryImageMetadataSchema.safeParse({
      categoryId: '00000000-0000-0000-0000-000000000000',
      isFeatured: true,
    }).success,
    true
  );
});

test('gallery overrides require an explicit reason and bounded integer quota', () => {
  assert.equal(setGalleryQuotaOverrideSchema.safeParse({ limit: 50 }).success, false);
  assert.equal(
    setGalleryQuotaOverrideSchema.safeParse({
      limit: 50,
      reason: 'Approved capacity increase',
    }).success,
    true
  );
  assert.equal(
    setGalleryQuotaOverrideSchema.safeParse({
      limit: 1001,
      reason: 'Approved capacity increase',
    }).success,
    false
  );
});
