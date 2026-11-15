import type { FastifyPluginAsync } from 'fastify';
import { db } from '../../config/database.js';
import { AuthMiddleware } from '../auth/auth.middleware.js';
import { ReviewsController } from './reviews.controller.js';
import { ReviewsRepository } from './reviews.repository.js';
import { ReviewService } from './reviews.service.js';

const authMiddleware = new AuthMiddleware();

export const reviewsRoutes: FastifyPluginAsync = async (app) => {
  const controller = new ReviewsController(
    new ReviewService(new ReviewsRepository(db))
  );
  const authenticate = (
    request: Parameters<typeof authMiddleware.verifyToken>[0],
    reply: Parameters<typeof authMiddleware.verifyToken>[1]
  ) => authMiddleware.verifyToken(request, reply);

  app.post('/me/salons/:salonId/reviews', { preHandler: [authenticate] }, (request, reply) =>
    controller.create(request, reply)
  );
  app.get('/salons/:salonId/reviews', (request) => controller.listPublic(request));
};
