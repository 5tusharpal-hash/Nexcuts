import type { FastifyPluginAsync } from 'fastify';
import { AuthMiddleware } from '../auth/auth.middleware.js';
import { TenancyController } from './tenancy.controller.js';
import { TenancyRepository } from './tenancy.repository.js';
import { TenancyService } from './tenancy.service.js';

const authMiddleware = new AuthMiddleware();

export const tenancyRoutes: FastifyPluginAsync = async (app) => {
  const controller = new TenancyController(new TenancyService(new TenancyRepository()));
  const authenticated = {
    preHandler: (request: Parameters<typeof authMiddleware.verifyToken>[0], reply: Parameters<typeof authMiddleware.verifyToken>[1]) =>
      authMiddleware.verifyToken(request, reply),
  };

  app.post('/salon-applications', authenticated, (request, reply) =>
    controller.createSalonApplication(request, reply)
  );
  app.put('/salon-applications/:salonId', authenticated, (request) =>
    controller.updateApplication(request)
  );
  app.get('/me/salon-applications', authenticated, (request) =>
    controller.getMyApplications(request)
  );
  app.get('/me/salons', authenticated, (request) => controller.getMySalons(request));
  app.get('/platform/salon-applications', authenticated, (request) =>
    controller.getApplicationsForReview(request)
  );
  app.patch('/platform/salon-applications/:salonId', authenticated, (request) =>
    controller.reviewApplication(request)
  );
};
