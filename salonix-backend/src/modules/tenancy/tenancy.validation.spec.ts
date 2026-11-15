import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createSalonApplicationSchema,
  reviewSalonApplicationSchema,
} from './tenancy.validation.js';

const validApplication = {
  businessType: 'TEAM',
  businessHours: Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    isClosed: dayOfWeek === 0,
    ...(dayOfWeek === 0 ? {} : { opensAt: '09:00', closesAt: '18:00' }),
  })),
  firstSalon: {
    name: 'Salon One',
    addressLine1: '1 Main Street',
    city: 'Mumbai',
  },
};

test('salon application defaults optional organization, branch, and services', () => {
  const result = createSalonApplicationSchema.parse(validApplication);
  assert.equal(result.organizationName, undefined);
  assert.equal(result.firstSalon.branchCode, 'MAIN');
  assert.deepEqual(result.services, []);
  assert.equal(result.firstSalon.countryCode, 'IN');
});

test('salon application requires location details and rejects invalid schedules', () => {
  assert.equal(
    createSalonApplicationSchema.safeParse({
      ...validApplication,
      businessHours: undefined,
      businessType: undefined,
      firstSalon: { name: 'Salon One', addressLine1: '1 Main Street' },
    }).success,
    false
  );

  const duplicateDays = Array.from({ length: 7 }, (_, index) => ({
    dayOfWeek: index === 6 ? 5 : index,
    isClosed: true,
  }));
  assert.equal(
    createSalonApplicationSchema.safeParse({
      ...validApplication,
      businessHours: duplicateDays,
    }).success,
    false
  );

  assert.equal(
    createSalonApplicationSchema.safeParse({
      ...validApplication,
      businessHours: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        dayOfWeek,
        isClosed: false,
        opensAt: '18:00',
        closesAt: '09:00',
      })),
    }).success,
    false
  );
});

test('salon review requires a reason for rejection or requested changes', () => {
  assert.equal(
    reviewSalonApplicationSchema.safeParse({ status: 'REJECTED' }).success,
    false
  );
  assert.equal(
    reviewSalonApplicationSchema.safeParse({
      status: 'CHANGES_REQUESTED',
      reviewNotes: 'Please update the address proof.',
    }).success,
    true
  );
  assert.equal(
    reviewSalonApplicationSchema.safeParse({ status: 'APPROVED' }).success,
    true
  );
});
