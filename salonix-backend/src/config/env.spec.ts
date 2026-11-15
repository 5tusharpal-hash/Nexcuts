import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const configProbe = `
  import { env } from './src/config/env.ts';
  import { ApiError } from './src/shared/errors/ApiError.ts';
  import { EmailIntegration } from './src/integrations/email/email.integration.ts';
  import { WhatsAppIntegration } from './src/integrations/whatsapp/whatsapp.integration.ts';
  const getUnavailableStatus = async (operation) => {
    try {
      await operation();
      return null;
    } catch (error) {
      return error instanceof ApiError ? error.statusCode : null;
    }
  };
  const unavailableIntegrationStatuses = await Promise.all([
    getUnavailableStatus(() =>
      new EmailIntegration().sendTransactionalEmail('test@example.com', 'Test', 'Test')
    ),
    getUnavailableStatus(() =>
      new WhatsAppIntegration().sendMessage({ to: '+14155550123', body: 'Test' })
    )
  ]);
  console.log(JSON.stringify({
    appEnv: env.APP_ENV,
    otpDelivery: env.AUTH_OTP_DELIVERY,
    exposeOtp: env.AUTH_OTP_EXPOSE_OTP,
    otpHashUsesJwt: env.AUTH_OTP_HASH_SECRET === env.JWT_SECRET,
    unavailableIntegrationStatuses
  }));
`;

function runConfig(overrides: Record<string, string | undefined> = {}) {
  const childEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/salonix',
    JWT_SECRET: 'test-secret-with-at-least-thirty-two-characters',
    REDIS_URL: 'redis://localhost:6379',
    AUTH_OTP_DELIVERY: 'mock',
    AUTH_OTP_EXPOSE_OTP: 'true',
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete childEnv[key];
    } else {
      childEnv[key] = value;
    }
  }

  return spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', configProbe],
    { cwd: process.cwd(), env: childEnv, encoding: 'utf8' }
  );
}

test('staging accepts mock OTP without optional integrations and never exposes OTPs', () => {
  const result = runConfig({
    APP_ENV: 'staging',
    AUTH_OTP_HASH_SECRET: 'separate-test-otp-hash-secret-with-32-chars',
    GOOGLE_CLIENT_ID: '',
    META_WHATSAPP_ACCESS_TOKEN: '',
    META_WHATSAPP_PHONE_NUMBER_ID: '',
    META_WHATSAPP_API_VERSION: '',
    META_WHATSAPP_OTP_TEMPLATE: '',
    RESEND_API_KEY: '',
    RESEND_FROM_EMAIL: '',
    STRIPE_SECRET_KEY: '',
    STRIPE_WEBHOOK_SECRET: '',
    RAZORPAY_KEY_ID: '',
    RAZORPAY_KEY_SECRET: '',
    RAZORPAY_WEBHOOK_SECRET: '',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    appEnv: 'staging',
    otpDelivery: 'mock',
    exposeOtp: false,
    otpHashUsesJwt: false,
    unavailableIntegrationStatuses: [503, 503],
  });
});

test('staging retains the separate OTP hashing secret requirement', () => {
  const result = runConfig({
    APP_ENV: 'staging',
    AUTH_OTP_HASH_SECRET: undefined,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AUTH_OTP_HASH_SECRET is required in staging and production/);
});

test('staging still requires Redis when NODE_ENV is production', () => {
  const result = runConfig({ APP_ENV: 'staging', REDIS_URL: undefined });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /REDIS_URL is required in production/);
});

test('actual production retains mandatory OTP provider validation', () => {
  const result = runConfig({
    APP_ENV: 'production',
    AUTH_OTP_DELIVERY: 'providers',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /META_WHATSAPP_ACCESS_TOKEN is required in production/);
  assert.match(result.stderr, /RESEND_API_KEY is required in production/);
});

test('staging accepts incomplete optional billing credentials', () => {
  const result = runConfig({
    APP_ENV: 'staging',
    AUTH_OTP_HASH_SECRET: 'separate-test-otp-hash-secret-with-32-chars',
    STRIPE_SECRET_KEY: 'stripe-test-key',
    RAZORPAY_KEY_ID: 'razorpay-test-key',
  });

  assert.equal(result.status, 0, result.stderr);
});

test('actual production retains billing credential pairing validation', () => {
  const result = runConfig({
    APP_ENV: 'production',
    AUTH_OTP_DELIVERY: 'providers',
    AUTH_OTP_HASH_SECRET: 'separate-test-otp-hash-secret-with-32-chars',
    META_WHATSAPP_ACCESS_TOKEN: 'test-token',
    META_WHATSAPP_PHONE_NUMBER_ID: 'test-phone-id',
    META_WHATSAPP_API_VERSION: 'v24.0',
    META_WHATSAPP_OTP_TEMPLATE: 'test-template',
    RESEND_API_KEY: 'test-resend-key',
    RESEND_FROM_EMAIL: 'test@example.com',
    STRIPE_SECRET_KEY: 'stripe-test-key',
    PLATFORM_BILLING_RETURN_URL: 'https://staging.example.com/return',
    RAZORPAY_KEY_ID: 'razorpay-test-key',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Configure both Stripe API and webhook secrets/);
  assert.match(result.stderr, /Configure both Razorpay key ID and secret/);
  assert.match(result.stderr, /RAZORPAY_WEBHOOK_SECRET is required when Razorpay is configured/);
});

test('production remains strict when APP_ENV is omitted', () => {
  const result = runConfig({
    APP_ENV: undefined,
    AUTH_OTP_DELIVERY: 'providers',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /META_WHATSAPP_ACCESS_TOKEN is required in production/);
});
