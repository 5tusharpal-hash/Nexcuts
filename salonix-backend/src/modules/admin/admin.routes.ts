import type { FastifyPluginAsync } from 'fastify';
import { AuthMiddleware } from '../auth/auth.middleware.js';
import { AdminController, SalonProfileChangeController } from './admin.controller.js';
import { AdminRepository } from './admin.repository.js';
import { AdminService } from './admin.service.js';

const authMiddleware = new AuthMiddleware();

export const adminRoutes: FastifyPluginAsync = async (app) => {
  const service = new AdminService(new AdminRepository());
  const controller = new AdminController(service);
  const authenticate = (
    request: Parameters<typeof authMiddleware.verifyToken>[0],
    reply: Parameters<typeof authMiddleware.verifyToken>[1]
  ) => authMiddleware.verifyToken(request, reply);
  const adminOnly = { preHandler: [authenticate] };

  app.get('/dashboard', adminOnly, (request) => controller.getDashboard(request));
  app.get('/salons', adminOnly, (request) => controller.listSalons(request));
  app.get('/salons/:salonId', adminOnly, (request) => controller.getSalonDetails(request));
  app.get('/salons/:salonId/activity', adminOnly, (request) =>
    controller.listSalonActivity(request)
  );
  app.get('/profile-change-requests', adminOnly, (request) =>
    controller.listSalonProfileChangeRequests(request)
  );
  app.patch('/profile-change-requests/:requestId', adminOnly, (request) =>
    controller.reviewSalonProfileChangeRequest(request)
  );
  app.get('/activity', adminOnly, (request) => controller.listRecentActivity(request));

  app.get('/accounts', adminOnly, (request) => controller.listAccounts(request));
  app.patch('/accounts/:accountId/status', adminOnly, (request) =>
    controller.updateAccountStatus(request)
  );
  app.post('/accounts/:accountId/password-resets', adminOnly, (request) =>
    controller.requestAccountPasswordReset(request)
  );
  app.post('/accounts/:accountId/session-revocations', adminOnly, (request) =>
    controller.revokeAccountSessions(request)
  );

  app.get('/plans', adminOnly, (request) => controller.listPlans(request));
  app.patch('/plans/:planId', adminOnly, (request) => controller.updatePlan(request));
  app.get('/addons', adminOnly, (request) => controller.listAddons(request));
  app.patch('/addons/:addonId', adminOnly, (request) => controller.updateAddon(request));
  app.put('/salons/:salonId/subscription', adminOnly, (request) =>
    controller.assignPlan(request)
  );
  app.patch('/salons/:salonId/addons/:addonId', adminOnly, (request) =>
    controller.setAddon(request)
  );
  app.put('/salons/:salonId/entitlements', adminOnly, (request) =>
    controller.setEntitlement(request)
  );
  app.patch(
    '/salons/:salonId/entitlements/:featureKey',
    adminOnly,
    (request) => controller.revokeEntitlement(request)
  );
  app.get('/master-settings', adminOnly, (request) => controller.getMasterSettings(request));

};

export const salonProfileChangeRoutes: FastifyPluginAsync = async (app) => {
  const service = new AdminService(new AdminRepository());
  const controller = new SalonProfileChangeController(service);
  const authenticate = (
    request: Parameters<typeof authMiddleware.verifyToken>[0],
    reply: Parameters<typeof authMiddleware.verifyToken>[1]
  ) => authMiddleware.verifyToken(request, reply);
  const authenticated = { preHandler: [authenticate] };

  app.get(
    '/salons/:salonId/profile-change-requests',
    authenticated,
    (request) => controller.listMine(request)
  );
  app.post(
    '/salons/:salonId/profile-change-requests',
    authenticated,
    (request, reply) => controller.requestChange(request, reply)
  );
};
