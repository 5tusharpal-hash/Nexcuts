import assert from 'node:assert/strict';
import { test } from 'node:test';

interface OtpEntry {
  hash: string;
  expiresAt: number;
  attempts: number;
}

class MemoryOtpStore {
  private readonly values = new Map<string, OtpEntry>();
  private readonly cooldowns = new Map<string, number>();
  private readonly rates = new Map<string, { count: number; expiresAt: number }>();

  async reserveCooldown(key: string, seconds: number): Promise<boolean> {
    const now = Date.now();
    if ((this.cooldowns.get(key) ?? 0) > now) return false;
    this.cooldowns.set(key, now + seconds * 1000);
    return true;
  }

  async saveOtp(key: string, hash: string, ttlSeconds: number): Promise<void> {
    this.values.set(key, { hash, expiresAt: Date.now() + ttlSeconds * 1000, attempts: 0 });
  }

  async deleteOtp(key: string): Promise<void> {
    this.values.delete(key);
  }

  async verifyOtp(
    key: string,
    expectedHash: string,
    _ttlSeconds: number,
    maxAttempts: number
  ): Promise<'verified' | 'invalid' | 'locked' | 'expired'> {
    const entry = this.values.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      this.values.delete(key);
      return 'expired';
    }

    entry.attempts += 1;
    if (entry.hash === expectedHash) {
      this.values.delete(key);
      return 'verified';
    }
    if (entry.attempts >= maxAttempts) {
      this.values.delete(key);
      return 'locked';
    }
    return 'invalid';
  }

  async incrementRateLimit(key: string, windowSeconds: number): Promise<number> {
    const now = Date.now();
    const current = this.rates.get(key);
    if (!current || current.expiresAt <= now) {
      this.rates.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
      return 1;
    }
    current.count += 1;
    return current.count;
  }

  expireOtps(): void {
    for (const entry of this.values.values()) entry.expiresAt = 0;
  }

  hasOtpHashMatchingCode(code: string): boolean {
    return [...this.values.values()].some((entry) => entry.hash === code);
  }
}

test('OTP codes expire, are single-use, attempt-limited, and stored as hashes', async () => {
  process.env.NODE_ENV = 'development';
  process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/schema_validation';
  process.env.JWT_SECRET = 'local-test-secret-should-be-at-least-32-characters';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.AUTH_OTP_DELIVERY = 'mock';
  process.env.AUTH_OTP_EXPOSE_OTP = 'true';
  process.env.AUTH_OTP_HASH_SECRET = 'local-otp-hash-secret-should-be-32-characters';

  const [{ AuthOtpService }, { ApiError }] = await Promise.all([
    import('./auth-otp.service.js'),
    import('../../shared/errors/ApiError.js'),
  ]);
  const store = new MemoryOtpStore();
  const service = new AuthOtpService(store);
  const params = ['phone-verification', 'phone', '+919876543210', 'account-id'] as const;

  const code = await service.requestOtp(...params);
  assert.ok(code);
  assert.equal(store.hasOtpHashMatchingCode(code), false);
  await service.verifyOtp(...params, code, '127.0.0.1');
  await assert.rejects(
    service.verifyOtp(...params, code, '127.0.0.1'),
    (error: unknown) => error instanceof ApiError && error.statusCode === 400
  );
  await assert.rejects(
    service.requestOtp(...params),
    (error: unknown) => error instanceof ApiError && error.statusCode === 429
  );

  const limitedParams = [
    'phone-verification',
    'phone',
    '+919876543211',
    'account-id-2',
  ] as const;
  const limitedCode = await service.requestOtp(...limitedParams);
  assert.ok(limitedCode);
  const wrongCode = limitedCode === '000000' ? '000001' : '000000';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(
      service.verifyOtp(...limitedParams, wrongCode, '127.0.0.2'),
      (error: unknown) =>
        error instanceof ApiError && (attempt < 4 ? error.statusCode === 400 : error.statusCode === 429)
    );
  }
  await assert.rejects(
    service.verifyOtp(...limitedParams, limitedCode, '127.0.0.2'),
    (error: unknown) => error instanceof ApiError && error.statusCode === 400
  );

  const expiredCode = await service.requestOtp(
    'email-verification',
    'email',
    'user@example.com',
    'account-id'
  );
  assert.ok(expiredCode);
  store.expireOtps();
  await assert.rejects(
    service.verifyOtp(
      'email-verification',
      'email',
      'user@example.com',
      'account-id',
      expiredCode,
      '127.0.0.3'
    ),
    (error: unknown) => error instanceof ApiError && error.statusCode === 400
  );
});
