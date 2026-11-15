import { test } from 'node:test';
import assert from 'node:assert/strict';

test('health is public and protected routes require authentication', async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/schema_validation';
  process.env.JWT_SECRET = 'local-test-secret-should-be-at-least-32-characters';
  process.env.REDIS_URL = 'redis://localhost:6379';

  const { buildApp } = await import('./app.js');
  const app = await buildApp();

  try {
    const health = await app.inject({ method: 'GET', url: '/health' });
    const removedLegacyOrganizationRoute = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      payload: {},
    });
    const salonApplication = await app.inject({
      method: 'POST',
      url: '/api/v1/salon-applications',
      payload: {},
    });
    const access = await app.inject({
      method: 'GET',
      url: '/api/v1/salons/00000000-0000-0000-0000-000000000000/access/me',
    });
    const invalidSignup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        full_name: 'Test User',
        password: 'a secure passphrase',
        phone_number: '9876543210',
      },
    });
    const invalidGoogleLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: {
        account_type: 'ADMIN',
        id_token: 'unverified-client-token',
      },
    });
    const protectedEmailUpdate = await app.inject({
      method: 'PUT',
      url: '/api/v1/auth/me/email',
      payload: { email: 'user@example.com' },
    });
    const invalidReset = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-resets/complete',
      payload: {
        identifier: 'user@example.com',
        code: 'invalid',
        new_password: 'a secure passphrase',
      },
    });
    const unversionedV2Login = await app.inject({
      method: 'POST',
      url: '/api/v2/auth/login',
      payload: { identifier: '+919876543210', password: 'valid password' },
    });
    const unversionedV2Signup = await app.inject({
      method: 'POST',
      url: '/api/v2/auth/register',
      payload: {
        full_name: 'Test User',
        password: 'a secure passphrase',
        phone_number: '+919876543210',
      },
    });
    const protectedServiceCatalog = await app.inject({
      method: 'GET',
      url: '/api/v1/salons/00000000-0000-0000-0000-000000000000/service-catalog',
    });
    const invalidPublicServiceSalon = await app.inject({
      method: 'GET',
      url: '/api/v1/salons/not-a-uuid/services',
    });
    const protectedGallery = await app.inject({
      method: 'GET',
      url: '/api/v1/salons/00000000-0000-0000-0000-000000000000/gallery/quota',
    });
    const protectedLoyaltySettings = await app.inject({
      method: 'GET',
      url: '/api/v1/salons/00000000-0000-0000-0000-000000000000/loyalty-program/settings',
    });
    const protectedCustomerLedger = await app.inject({
      method: 'GET',
      url: '/api/v1/me/customer-ledger',
    });
    const protectedEnquiries = await app.inject({
      method: 'GET',
      url: '/api/v1/salons/00000000-0000-0000-0000-000000000000/enquiries',
    });
    const invalidPublicSalonSlug = await app.inject({
      method: 'GET',
      url: '/api/v1/public/salons/%20',
    });
    const protectedNotifications = await app.inject({
      method: 'GET',
      url: '/api/v1/me/notifications',
    });
    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { origin: 'http://localhost:3000' },
    });
    const untrustedOriginLogout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { origin: 'https://untrusted.example' },
    });

    assert.equal(health.statusCode, 200);
    assert.equal(removedLegacyOrganizationRoute.statusCode, 404);
    assert.equal(salonApplication.statusCode, 401);
    assert.equal(access.statusCode, 401);
    assert.equal(invalidSignup.statusCode, 400);
    assert.equal(invalidGoogleLogin.statusCode, 400);
    assert.equal(protectedEmailUpdate.statusCode, 401);
    assert.equal(invalidReset.statusCode, 400);
    assert.equal(unversionedV2Login.statusCode, 404);
    assert.equal(unversionedV2Signup.statusCode, 404);
    assert.equal(protectedServiceCatalog.statusCode, 401);
    assert.equal(invalidPublicServiceSalon.statusCode, 400);
    assert.equal(protectedGallery.statusCode, 401);
    assert.equal(protectedLoyaltySettings.statusCode, 401);
    assert.equal(protectedCustomerLedger.statusCode, 401);
    assert.equal(protectedEnquiries.statusCode, 401);
    assert.equal(invalidPublicSalonSlug.statusCode, 400);
    assert.equal(protectedNotifications.statusCode, 401);
    assert.equal(logout.statusCode, 200);
    assert.match(logout.headers['set-cookie'] ?? '', /HttpOnly/);
    assert.match(logout.headers['set-cookie'] ?? '', /SameSite=Lax/);
    assert.match(logout.headers['set-cookie'] ?? '', /Max-Age=0/);
    assert.equal(logout.headers['cache-control'], 'no-store');
    assert.equal(untrustedOriginLogout.statusCode, 403);
  } finally {
    await app.close();
  }
});
