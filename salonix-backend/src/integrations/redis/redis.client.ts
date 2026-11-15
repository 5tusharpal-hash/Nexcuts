import { createClient } from 'redis';
import { env } from '../../config/env.js';
import { logger } from '../../bootstrap/logger.js';

export const redisClient = createClient({ url: env.REDIS_URL });

redisClient.on('error', (error) => {
  logger.error({ error }, 'Redis client error');
});
