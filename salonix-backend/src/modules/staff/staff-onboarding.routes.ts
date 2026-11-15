import type { FastifyPluginAsync } from 'fastify';
import { AuthMiddleware } from '../auth/auth.middleware.js';
import { RbacMiddleware } from '../rbac/rbac.middleware.js';
import { StaffOnboardingController } from './staff-onboarding.controller.js';
import { StaffOnboardingRepository } from './staff-onboarding.repository.js';
import { StaffOnboardingService } from './staff-onboarding.service.js';

const authMiddleware = new AuthMiddleware();
const rbacMiddleware = new RbacMiddleware();

export const staffOnboardingRoutes: FastifyPluginAsync = async (app) => {
  const controller = new StaffOnboardingController(
    new StaffOnboardingService(new StaffOnboardingRepository())
  );
  const authenticate = (request: Parameters<typeof authMiddleware.verifyToken>[0], reply: Parameters<typeof authMiddleware.verifyToken>[1]) =>
    authMiddleware.verifyToken(request, reply);
  const manageMembers = rbacMiddleware.check('salon:manage_members');
  const authorized = { preHandler: [authenticate, manageMembers] };

  app.post(
    '/salons/:salonId/staff-phone-verifications',
    authorized,
    (request, reply) => controller.requestPhoneVerification(request, reply)
  );
  app.post(
    '/salons/:salonId/staff-members',
    authorized,
    (request, reply) => controller.createOrLinkStaff(request, reply)
  );
};
