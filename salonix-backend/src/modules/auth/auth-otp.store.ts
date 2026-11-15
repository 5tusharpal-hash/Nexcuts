import { redisClient } from '../../integrations/redis/redis.client.js';

export type OtpVerificationResult = 'verified' | 'invalid' | 'locked';

export interface AuthOtpStore {
  reserveCooldown(key: string, seconds: number): Promise<boolean>;
  saveOtp(key: string, hash: string, ttlSeconds: number): Promise<void>;
  deleteOtp(key: string): Promise<void>;
  verifyOtp(
    key: string,
    expectedHash: string,
    ttlSeconds: number,
    maxAttempts: number
  ): Promise<OtpVerificationResult | 'expired'>;
  incrementRateLimit(key: string, windowSeconds: number): Promise<number>;
}

const rateLimitScript = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  return count
`;

const verifyOtpScript = `
  local saved = redis.call('GET', KEYS[1])
  if not saved then return 0 end
  local attempts = redis.call('INCR', KEYS[2])
  if attempts == 1 then redis.call('EXPIRE', KEYS[2], ARGV[2]) end
  if saved == ARGV[1] then
    redis.call('DEL', KEYS[1], KEYS[2])
    return 1
  end
  if attempts >= tonumber(ARGV[3]) then
    redis.call('DEL', KEYS[1], KEYS[2])
    return -1
  end
  return 0
`;

export class RedisAuthOtpStore implements AuthOtpStore {
  async reserveCooldown(key: string, seconds: number): Promise<boolean> {
    const result = await redisClient.set(key, '1', { NX: true, EX: seconds });
    return result === 'OK';
  }

  async saveOtp(key: string, hash: string, ttlSeconds: number): Promise<void> {
    await redisClient
      .multi()
      .set(key, hash, { EX: ttlSeconds })
      .del(`${key}:attempts`)
      .exec();
  }

  async deleteOtp(key: string): Promise<void> {
    await redisClient.del([key, `${key}:attempts`]);
  }

  async verifyOtp(
    key: string,
    expectedHash: string,
    ttlSeconds: number,
    maxAttempts: number
  ): Promise<OtpVerificationResult | 'expired'> {
    const result = Number(
      await redisClient.eval(verifyOtpScript, {
        keys: [key, `${key}:attempts`],
        arguments: [expectedHash, String(ttlSeconds), String(maxAttempts)],
      })
    );
    if (result === 1) return 'verified';
    if (result === -1) return 'locked';
    return 'expired';
  }

  async incrementRateLimit(key: string, windowSeconds: number): Promise<number> {
    const count = await redisClient.eval(rateLimitScript, {
      keys: [key],
      arguments: [String(windowSeconds)],
    });
    return Number(count);
  }
}
