import { redisClient } from '../../integrations/redis/redis.client.js';
import { logger } from '../../bootstrap/logger.js';
import { ApiError } from '../../shared/errors/ApiError.js';

interface SessionBlacklistStore {
  isOpen: boolean;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<string | null>;
}

const KEY_PREFIX = 'auth:revoked-session:';

export class AuthSessionBlacklist {
  constructor(private readonly store: SessionBlacklistStore = redisClient) {}

  async isRevoked(sessionId: string): Promise<boolean> {
    this.ensureStoreOpen();
    try {
      return (await this.store.get(this.getKey(sessionId))) !== null;
    } catch (error) {
      logger.error({ error }, 'Unable to check auth session blacklist');
      throw new ApiError(503, 'Authentication service is temporarily unavailable');
    }
  }

  async revoke(sessionId: string, sessionExpiresAt: Date): Promise<void> {
    const ttlSeconds = Math.ceil((sessionExpiresAt.getTime() - Date.now()) / 1000);
    if (ttlSeconds <= 0) return;

    this.ensureStoreOpen();
    try {
      const result = await this.store.set(this.getKey(sessionId), '1', { EX: ttlSeconds });
      if (result !== 'OK') {
        throw new Error('Redis did not confirm the session blacklist write');
      }
    } catch (error) {
      logger.error({ error }, 'Unable to write auth session blacklist');
      throw new ApiError(503, 'Authentication service is temporarily unavailable');
    }
  }

  private ensureStoreOpen(): void {
    if (!this.store.isOpen) {
      throw new ApiError(503, 'Authentication service is temporarily unavailable');
    }
  }

  private getKey(sessionId: string): string {
    return `${KEY_PREFIX}${sessionId}`;
  }
}
