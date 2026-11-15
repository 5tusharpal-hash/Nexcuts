import assert from 'node:assert/strict';
import { test } from 'node:test';

class MemoryBlacklistStore {
  isOpen = true;
  readonly values = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.values.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, options: { EX: number }): Promise<string> {
    this.values.set(key, {
      value,
      expiresAt: Date.now() + options.EX * 1000,
    });
    return 'OK';
  }
}

test('session blacklist revokes until the session expiry', async () => {
  process.env.DATABASE_URL = 'postgresql://localhost:5432/schema_validation';
  process.env.JWT_SECRET = 'local-test-secret-should-be-at-least-32-characters';
  process.env.REDIS_URL = 'redis://localhost:6379';
  const { AuthSessionBlacklist } = await import('./auth-session-blacklist.js');
  const store = new MemoryBlacklistStore();
  const blacklist = new AuthSessionBlacklist(store);

  assert.equal(await blacklist.isRevoked('session-1'), false);
  await blacklist.revoke('session-1', new Date(Date.now() + 60_000));
  assert.equal(await blacklist.isRevoked('session-1'), true);

  const ttl = store.values.get('auth:revoked-session:session-1')?.expiresAt ?? 0;
  assert.ok(ttl <= Date.now() + 61_000);
  assert.ok(ttl > Date.now());
});

test('session blacklist fails closed when Redis is disconnected', async () => {
  process.env.DATABASE_URL = 'postgresql://localhost:5432/schema_validation';
  process.env.JWT_SECRET = 'local-test-secret-should-be-at-least-32-characters';
  process.env.REDIS_URL = 'redis://localhost:6379';
  const { AuthSessionBlacklist } = await import('./auth-session-blacklist.js');
  const store = new MemoryBlacklistStore();
  store.isOpen = false;
  const blacklist = new AuthSessionBlacklist(store);

  await assert.rejects(blacklist.isRevoked('session-1'), { statusCode: 503 });
  await assert.rejects(
    blacklist.revoke('session-1', new Date(Date.now() + 60_000)),
    { statusCode: 503 }
  );
});
