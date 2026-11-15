import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  adminAccountStatusSchema,
  adminEntitlementUpdateSchema,
  adminPlanUpdateSchema,
  adminSalonListSchema,
  adminSubscriptionUpdateSchema,
  salonProfileChangeRequestSchema,
  salonProfileChangeReviewSchema,
} from './admin.validation.js';

test('admin list filters default pagination and cap requested page size', () => {
  assert.deepEqual(adminSalonListSchema.parse({}), { limit: 20, offset: 0 });
  assert.equal(adminSalonListSchema.safeParse({ limit: 101, offset: 0 }).success, false);
  assert.equal(adminSalonListSchema.safeParse({ limit: 20, offset: -1 }).success, false);
});

test('account status changes require a reason and only allow active or suspended states', () => {
  assert.equal(
    adminAccountStatusSchema.safeParse({ status: 'SUSPENDED', reason: 'Policy violation' }).success,
    true
  );
  assert.equal(adminAccountStatusSchema.safeParse({ status: 'DEACTIVATED', reason: 'Closed' }).success, false);
  assert.equal(adminAccountStatusSchema.safeParse({ status: 'SUSPENDED' }).success, false);
});

test('plan updates validate non-negative prices and JSON feature values', () => {
  const validPlan = {
    name: 'Starter',
    description: null,
    monthlyPrice: 0,
    isActive: true,
    features: { bookings: true, public_gallery_limit: 0 },
    reason: 'Launch free plan',
  };
  assert.equal(adminPlanUpdateSchema.safeParse(validPlan).success, true);
  assert.equal(adminPlanUpdateSchema.safeParse({ ...validPlan, monthlyPrice: -1 }).success, false);
  assert.equal(adminPlanUpdateSchema.safeParse({
    ...validPlan,
    features: { 'Invalid Key': true },
  }).success, false);
});

test('subscription assignment requires valid billing date order', () => {
  const planId = 'c11dbb12-d925-41d7-9c4a-81431b30a8da';
  assert.equal(adminSubscriptionUpdateSchema.safeParse({
    planId,
    billingCycleStart: '2026-10-01',
    billingCycleEnd: '2026-10-31',
    reason: 'Complimentary plan',
  }).success, true);
  assert.equal(adminSubscriptionUpdateSchema.safeParse({
    planId,
    billingCycleStart: '2026-11-01',
    billingCycleEnd: '2026-10-31',
    reason: 'Invalid date range',
  }).success, false);
});

test('entitlement overrides validate keys, reason, expiry, and JSON values', () => {
  assert.equal(adminEntitlementUpdateSchema.safeParse({
    featureKey: 'public_gallery_limit',
    featureValue: 25,
    reason: 'Temporary support grant',
    expiresAt: '2026-12-01T00:00:00Z',
  }).success, true);
  assert.equal(adminEntitlementUpdateSchema.safeParse({
    featureKey: 'PUBLIC GALLERY',
    featureValue: true,
    reason: 'Invalid key',
    expiresAt: null,
  }).success, false);
});

test('salon profile changes require at least one editable field and keep owner notes separate', () => {
  assert.equal(salonProfileChangeRequestSchema.safeParse({
    ownerNote: 'Please update the location.',
  }).success, false);
  const parsed = salonProfileChangeRequestSchema.parse({
    addressLine1: '10 New Road',
    city: 'Pune',
    ownerNote: 'Updated lease address.',
  });
  assert.equal(parsed.addressLine1, '10 New Road');
  assert.equal(parsed.ownerNote, 'Updated lease address.');
});

test('profile change rejection requires a review reason', () => {
  assert.equal(
    salonProfileChangeReviewSchema.safeParse({ status: 'APPROVED' }).success,
    true
  );
  assert.equal(
    salonProfileChangeReviewSchema.safeParse({ status: 'REJECTED' }).success,
    false
  );
  assert.equal(
    salonProfileChangeReviewSchema.safeParse({
      status: 'REJECTED',
      reviewNotes: 'Address evidence did not match.',
    }).success,
    true
  );
});
