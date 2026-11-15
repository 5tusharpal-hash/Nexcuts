import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';

export async function setupHelmet(app: FastifyInstance) {
  await app.register(helmet);
}
