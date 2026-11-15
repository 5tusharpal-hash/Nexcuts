import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  emailSchema,
  googleLoginSchema,
  identifierSchema,
  passwordSchema,
  phoneNumberSchema,
} from './auth.validation.js';

test('phone numbers require an international country code and normalize to E.164', () => {
  assert.equal(phoneNumberSchema.parse('+91 98765 43210'), '+919876543210');
  assert.equal(phoneNumberSchema.safeParse('9876543210').success, false);
  assert.equal(phoneNumberSchema.safeParse('+1').success, false);
});

test('email identifiers are normalized for case-insensitive lookup', () => {
  assert.equal(emailSchema.parse('  Salonix.User@Example.com '), 'salonix.user@example.com');
  assert.equal(identifierSchema.parse('user@example.com'), 'user@example.com');
});

test('password validation rejects weak or bcrypt-truncated inputs', () => {
  assert.equal(passwordSchema.safeParse('short').success, false);
  assert.equal(passwordSchema.safeParse('x'.repeat(73)).success, false);
  assert.equal(passwordSchema.safeParse('a secure passphrase').success, true);
});

test('Google login accepts only self-service accounts and validates phone numbers', () => {
  assert.equal(
    googleLoginSchema.safeParse({
      account_type: 'CUSTOMER',
      id_token: 'google-id-token',
      phone_number: '+91 98765 43210',
    }).success,
    true
  );
  assert.equal(
    googleLoginSchema.safeParse({
      account_type: 'ADMIN',
      id_token: 'google-id-token',
    }).success,
    false
  );
  assert.equal(
    googleLoginSchema.safeParse({
      account_type: 'CUSTOMER',
      id_token: 'google-id-token',
      phone_number: '9876543210',
    }).success,
    false
  );
});
