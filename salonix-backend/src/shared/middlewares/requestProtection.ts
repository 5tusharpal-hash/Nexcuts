import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { redisClient } from '../../integrations/redis/redis.client.js';
import { ApiError } from '../errors/ApiError.js';
import { logger } from '../../bootstrap/logger.js';

const rateLimitScript = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  return count
`;

const protectedPaths = [
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/refresh',
  '/api/v1/auth/logout',
  '/api/v1/auth/otp/request',
  '/api/v1/auth/password-reset/request',
  '/api/v1/auth/password-reset/complete',
];

export function registerRequestProtection(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    request.headers['x-request-start-ms'] = String(Date.now());
    const requestId = request.headers['x-request-id'];
    const normalizedRequestId = Array.isArray(requestId) ? requestId[0] : requestId;
    const value = normalizedRequestId?.trim() || randomUUID();
    request.headers['x-request-id'] = value;
    reply.header('x-request-id', value);

    if (env.NODE_ENV !== 'production' || !protectedPaths.includes(request.url.split('?')[0])) return;
    if (!redisClient.isOpen) throw new ApiError(503, 'Request protection is temporarily unavailable');

    const address = request.ip.replace(/[^a-zA-Z0-9:.]/g, '_');
    const key = `rate-limit:auth:${request.method}:${address}:${request.url.split('?')[0]}`;
    const count = Number(await redisClient.eval(rateLimitScript, {
      keys: [key],
      arguments: ['60'],
    }));
    reply.header('x-ratelimit-limit', '20');
    reply.header('x-ratelimit-remaining', String(Math.max(0, 20 - count)));
    if (count > 20) {
      reply.header('retry-after', '60');
      throw new ApiError(429, 'Too many requests. Please try again later.');
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const startedAt = Number(request.headers['x-request-start-ms']);
    if (Number.isFinite(startedAt)) {
      const durationMs = Date.now() - startedAt;
      reply.header('server-timing', `app;dur=${durationMs}`);
      if (durationMs >= 1_000) {
        logger.warn({ method: request.method, url: request.url, durationMs, requestId: reply.getHeader('x-request-id') }, 'Slow API request');
      }
    }
    return payload;
  });
}
