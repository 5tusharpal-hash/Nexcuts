import type { FastifyPluginAsync } from 'fastify';
import { AuthMiddleware } from '../auth/auth.middleware.js';
import { RbacMiddleware } from './rbac.middleware.js';
import { RbacController } from './rbac.controller.js';
import { RbacService } from './rbac.service.js';

const authMiddleware = new AuthMiddleware();
const rbacMiddleware = new RbacMiddleware();

export const rbacRoutes: FastifyPluginAsync = async (app) => {
  const controller = new RbacController(new RbacService());
  const authenticate = (request: Parameters<typeof authMiddleware.verifyToken>[0], reply: Parameters<typeof authMiddleware.verifyToken>[1]) =>
    authMiddleware.verifyToken(request, reply);
  const roleManager = rbacMiddleware.check('salon:manage_roles');

  app.get(
    '/salons/:salonId/access/me',
    { preHandler: [authenticate] },
    (request) => controller.getMyAccess(request)
  );
  app.post(
    '/salons/:salonId/roles',
    { preHandler: [authenticate, roleManager] },
    (request, reply) => controller.createRole(request, reply)
  );
  app.put(
    '/salons/:salonId/roles/:roleId/permissions/:permissionKey',
    { preHandler: [authenticate, roleManager] },
    (request) => controller.assignPermission(request)
  );
  app.put(
    '/salons/:salonId/members/:accountId/roles/:roleId',
    { preHandler: [authenticate, roleManager] },
    (request) => controller.assignRole(request)
  );
};
