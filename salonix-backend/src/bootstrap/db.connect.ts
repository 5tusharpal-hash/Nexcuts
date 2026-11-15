import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { logger } from './logger.js';
import { env } from '../config/env.js';
import { redisClient } from '../integrations/redis/redis.client.js';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
});
const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });

export async function connectDb() {
  try {
    await prisma.$connect();
    logger.info('Database connected successfully');
  } catch (error) {
    logger.error({ err: error }, 'Database connection failed');
    throw error;
  }
}

export async function disconnectDb() {
  await prisma.$disconnect();
}

export async function connectRedis() {
  try {
    if (!redisClient.isOpen) await redisClient.connect();
    await redisClient.ping();
    logger.info('Redis connected successfully');
  } catch (error) {
    logger.error({ error }, 'Redis connection failed');
    throw error;
  }
}

export async function disconnectRedis() {
  if (redisClient.isOpen) await redisClient.quit();
}
