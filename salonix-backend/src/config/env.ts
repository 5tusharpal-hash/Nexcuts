import { z } from 'zod';

const optionalEnvironmentValue = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => value === '' ? undefined : value, schema.optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_ENV: z.enum(['development', 'staging', 'production', 'test']).optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  CORS_ORIGINS: z.string().default('http://localhost:3000').transform((value) =>
    value.split(',').map((origin) => origin.trim()).filter(Boolean)
  ).refine((origins) => origins.length > 0, 'At least one CORS origin is required'),
  DATABASE_URL: z.string().url(),
  MIGRATION_DATABASE_URL: optionalEnvironmentValue(z.string().url()),
  JWT_SECRET: z.string().min(32),
  AUTH_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]+$/).default('salonix_refresh_token'),
  AUTH_COOKIE_DOMAIN: optionalEnvironmentValue(
    z.string().regex(/^\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/)
  ),
  AWS_ENDPOINT_URL_S3: optionalEnvironmentValue(z.string().url()),
  AWS_REGION: optionalEnvironmentValue(z.string().min(1)),
  AWS_ACCESS_KEY_ID: optionalEnvironmentValue(z.string().min(1)),
  AWS_SECRET_ACCESS_KEY: optionalEnvironmentValue(z.string().min(1)),
  MEDIA_STORAGE_ENDPOINT: optionalEnvironmentValue(z.string().url()),
  MEDIA_STORAGE_REGION: optionalEnvironmentValue(z.string().min(1)),
  MEDIA_STORAGE_BUCKET: optionalEnvironmentValue(z.string().min(1)),
  MEDIA_STORAGE_ACCESS_KEY_ID: optionalEnvironmentValue(z.string().min(1)),
  MEDIA_STORAGE_SECRET_ACCESS_KEY: optionalEnvironmentValue(z.string().min(1)),
  REDIS_URL: z.string().url().optional(),
  AUTH_OTP_DELIVERY: z.enum(['mock', 'providers']).default('mock'),
  AUTH_OTP_EXPOSE_OTP: z.enum(['true', 'false']).optional(),
  AUTH_OTP_HASH_SECRET: optionalEnvironmentValue(z.string().min(32)),
  GOOGLE_CLIENT_ID: optionalEnvironmentValue(z.string().min(1)),
  META_WHATSAPP_ACCESS_TOKEN: optionalEnvironmentValue(z.string().min(1)),
  META_WHATSAPP_PHONE_NUMBER_ID: optionalEnvironmentValue(z.string().min(1)),
  META_WHATSAPP_API_VERSION: optionalEnvironmentValue(z.string().regex(/^v\d+\.\d+$/)),
  META_WHATSAPP_OTP_TEMPLATE: optionalEnvironmentValue(z.string().min(1)),
  META_WHATSAPP_OTP_LANGUAGE: z.string().min(2).default('en'),
  META_WHATSAPP_MARKETING_TEMPLATE: optionalEnvironmentValue(z.string().min(1)),
  META_WHATSAPP_MARKETING_LANGUAGE: z.string().min(2).default('en'),
  RESEND_API_KEY: optionalEnvironmentValue(z.string().min(1)),
  RESEND_FROM_EMAIL: optionalEnvironmentValue(z.string().email()),
  STRIPE_SECRET_KEY: optionalEnvironmentValue(z.string().min(1)),
  STRIPE_WEBHOOK_SECRET: optionalEnvironmentValue(z.string().min(1)),
  RAZORPAY_KEY_ID: optionalEnvironmentValue(z.string().min(1)),
  RAZORPAY_KEY_SECRET: optionalEnvironmentValue(z.string().min(1)),
  RAZORPAY_WEBHOOK_SECRET: optionalEnvironmentValue(z.string().min(1)),
  PLATFORM_BILLING_RETURN_URL: optionalEnvironmentValue(z.string().url()),
  ELASTICSEARCH_URL: z.string().url().optional(),
}).superRefine((value, context) => {
  const appEnvironment =
    value.APP_ENV ?? (value.NODE_ENV === 'production' ? 'production' : value.NODE_ENV);
  const resolvedStorageValues = [
    value.MEDIA_STORAGE_ENDPOINT ?? value.AWS_ENDPOINT_URL_S3,
    value.MEDIA_STORAGE_REGION ?? value.AWS_REGION,
    value.MEDIA_STORAGE_BUCKET,
    value.MEDIA_STORAGE_ACCESS_KEY_ID ?? value.AWS_ACCESS_KEY_ID,
    value.MEDIA_STORAGE_SECRET_ACCESS_KEY ?? value.AWS_SECRET_ACCESS_KEY,
  ];
  if (resolvedStorageValues.some(Boolean) && !resolvedStorageValues.every(Boolean)) {
    for (const [index, storageKey] of [
      'MEDIA_STORAGE_ENDPOINT',
      'MEDIA_STORAGE_REGION',
      'MEDIA_STORAGE_BUCKET',
      'MEDIA_STORAGE_ACCESS_KEY_ID',
      'MEDIA_STORAGE_SECRET_ACCESS_KEY',
    ].entries()) {
      if (!resolvedStorageValues[index]) {
        context.addIssue({
          code: 'custom',
          path: [storageKey],
          message: `${storageKey} or its AWS_* equivalent is required when media storage is configured`,
        });
      }
    }
  }

  if (value.NODE_ENV === 'production') {
    if (value.AUTH_COOKIE_DOMAIN) {
      const cookieDomain = value.AUTH_COOKIE_DOMAIN.slice(1).toLowerCase();
      const hasOriginOutsideCookieDomain = value.CORS_ORIGINS.some((origin) => {
        try {
          const hostname = new URL(origin).hostname.toLowerCase();
          return hostname !== cookieDomain && !hostname.endsWith(`.${cookieDomain}`);
        } catch {
          return true;
        }
      });
      if (hasOriginOutsideCookieDomain) {
        context.addIssue({
          code: 'custom',
          path: ['AUTH_COOKIE_DOMAIN'],
          message: 'AUTH_COOKIE_DOMAIN must contain every configured frontend origin',
        });
      }
    }

    if (!value.REDIS_URL) {
      context.addIssue({
        code: 'custom',
        path: ['REDIS_URL'],
        message: 'REDIS_URL is required in production',
      });
    }
  }

  if (
    (value.NODE_ENV === 'production' || appEnvironment === 'production') &&
    !value.AUTH_OTP_HASH_SECRET
  ) {
    context.addIssue({
      code: 'custom',
      path: ['AUTH_OTP_HASH_SECRET'],
      message: 'AUTH_OTP_HASH_SECRET is required in staging and production',
    });
  }

  if (appEnvironment === 'production') {
    if (value.AUTH_OTP_DELIVERY !== 'providers') {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_OTP_DELIVERY'],
        message: 'Production OTP delivery must use configured providers',
      });
    }
    for (const key of [
      'META_WHATSAPP_ACCESS_TOKEN',
      'META_WHATSAPP_PHONE_NUMBER_ID',
      'META_WHATSAPP_API_VERSION',
      'META_WHATSAPP_OTP_TEMPLATE',
      'RESEND_API_KEY',
      'RESEND_FROM_EMAIL',
    ] as const) {
      if (!value[key]) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required in production`,
        });
      }
    }

    if (Boolean(value.STRIPE_SECRET_KEY) !== Boolean(value.STRIPE_WEBHOOK_SECRET)) {
      context.addIssue({
        code: 'custom',
        path: ['STRIPE_WEBHOOK_SECRET'],
        message: 'Configure both Stripe API and webhook secrets',
      });
    }
    if (Boolean(value.RAZORPAY_KEY_ID) !== Boolean(value.RAZORPAY_KEY_SECRET)) {
      context.addIssue({
        code: 'custom',
        path: ['RAZORPAY_KEY_SECRET'],
        message: 'Configure both Razorpay key ID and secret',
      });
    }
    if (value.STRIPE_SECRET_KEY && !value.PLATFORM_BILLING_RETURN_URL) {
      context.addIssue({
        code: 'custom',
        path: ['PLATFORM_BILLING_RETURN_URL'],
        message: 'PLATFORM_BILLING_RETURN_URL is required when Stripe is configured',
      });
    }
    if (value.STRIPE_SECRET_KEY && value.PLATFORM_BILLING_RETURN_URL) {
      if (new URL(value.PLATFORM_BILLING_RETURN_URL).protocol !== 'https:') {
        context.addIssue({
          code: 'custom',
          path: ['PLATFORM_BILLING_RETURN_URL'],
          message: 'Production Stripe return URL must use HTTPS',
        });
      }
    }
    if (value.RAZORPAY_KEY_ID && !value.RAZORPAY_WEBHOOK_SECRET) {
      context.addIssue({
        code: 'custom',
        path: ['RAZORPAY_WEBHOOK_SECRET'],
        message: 'RAZORPAY_WEBHOOK_SECRET is required when Razorpay is configured',
      });
    }
  }
});

const parsedEnv = envSchema.parse(process.env);

export const env = {
  ...parsedEnv,
  APP_ENV:
    parsedEnv.APP_ENV ??
    (parsedEnv.NODE_ENV === 'production' ? 'production' : parsedEnv.NODE_ENV),
  MEDIA_STORAGE_ENDPOINT: parsedEnv.MEDIA_STORAGE_ENDPOINT ?? parsedEnv.AWS_ENDPOINT_URL_S3,
  MEDIA_STORAGE_REGION: parsedEnv.MEDIA_STORAGE_REGION ?? parsedEnv.AWS_REGION,
  MEDIA_STORAGE_ACCESS_KEY_ID:
    parsedEnv.MEDIA_STORAGE_ACCESS_KEY_ID ?? parsedEnv.AWS_ACCESS_KEY_ID,
  MEDIA_STORAGE_SECRET_ACCESS_KEY:
    parsedEnv.MEDIA_STORAGE_SECRET_ACCESS_KEY ?? parsedEnv.AWS_SECRET_ACCESS_KEY,
  REDIS_URL: parsedEnv.REDIS_URL ?? 'redis://localhost:6379',
  AUTH_OTP_EXPOSE_OTP:
    parsedEnv.NODE_ENV !== 'production' &&
    parsedEnv.APP_ENV !== 'staging' &&
    parsedEnv.APP_ENV !== 'production' &&
    (parsedEnv.AUTH_OTP_EXPOSE_OTP === undefined
      ? parsedEnv.NODE_ENV === 'development'
      : parsedEnv.AUTH_OTP_EXPOSE_OTP === 'true'),
  AUTH_OTP_HASH_SECRET: parsedEnv.AUTH_OTP_HASH_SECRET ?? parsedEnv.JWT_SECRET,
};
