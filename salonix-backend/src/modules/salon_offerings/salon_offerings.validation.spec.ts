import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createComboSchema,
  createManualOfferSaleSchema,
  createPackageSchema,
  createPurchaseRequestSchema,
  updateOfferSaleQuoteSchema,
} from './salon_offerings.validation.js';

const serviceOne = '11111111-1111-4111-8111-111111111111';
const serviceTwo = '22222222-2222-4222-8222-222222222222';

test('package definitions require a money price, credit, validity, and unique service rules', () => {
  const valid = createPackageSchema.parse({
    name: 'Monthly hair plan',
    sellingPrice: '500.00',
    creditAmount: '600',
    validityDays: 30,
    services: [{ serviceId: serviceOne }, { serviceId: serviceTwo, maxUses: 3 }],
  });
  assert.equal(valid.status, 'DRAFT');
  assert.equal(
    createPackageSchema.safeParse({
      name: 'Monthly hair plan',
      sellingPrice: '500.001',
      creditAmount: '600',
      validityDays: 30,
      services: [{ serviceId: serviceOne }],
    }).success,
    false
  );
  assert.equal(
    createPackageSchema.safeParse({
      name: 'Monthly hair plan',
      sellingPrice: '500',
      creditAmount: '600',
      validityDays: 30,
      services: [{ serviceId: serviceOne }, { serviceId: serviceOne }],
    }).success,
    false
  );
});

test('combos require multiple distinct services and a fixed sale duration', () => {
  assert.equal(
    createComboSchema.safeParse({
      name: 'Cut and wash',
      sellingPrice: '80',
      validityDays: 7,
      serviceIds: [serviceOne, serviceTwo],
      status: 'LISTED',
    }).success,
    true
  );
  assert.equal(
    createComboSchema.safeParse({
      name: 'Cut and wash',
      sellingPrice: '80',
      validityDays: 7,
      serviceIds: [serviceOne, serviceOne],
    }).success,
    false
  );
});

test('customer requests may only choose a supported offer and payment mode', () => {
  assert.equal(
    createPurchaseRequestSchema.safeParse({
      offerType: 'PACKAGE',
      offeringId: serviceOne,
      paymentMode: 'CASH',
    }).success,
    true
  );
  assert.equal(
    createPurchaseRequestSchema.safeParse({
      offerType: 'PACKAGE',
      offeringId: serviceOne,
      paymentMode: 'WALLET',
    }).success,
    false
  );
});

test('manual complimentary and discounted sale quotes require a reason', () => {
  const manualBase = {
    offerType: 'COMBO',
    offeringId: serviceOne,
    customerPhone: '+919876543210',
    finalAmount: '0',
    idempotencyKey: 'manual-sale-test-001',
  };
  assert.equal(createManualOfferSaleSchema.safeParse(manualBase).success, false);
  assert.equal(
    createManualOfferSaleSchema.safeParse({
      ...manualBase,
      discountReason: 'Complimentary service approved by owner',
    }).success,
    true
  );
  assert.equal(updateOfferSaleQuoteSchema.safeParse({ finalAmount: '0' }).success, false);
  assert.equal(
    updateOfferSaleQuoteSchema.safeParse({
      finalAmount: '450',
      discountReason: 'Customer discount approved by owner',
    }).success,
    true
  );
});
