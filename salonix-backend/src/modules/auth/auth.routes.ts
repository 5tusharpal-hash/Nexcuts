import type { FastifyPluginAsync } from 'fastify';
import { AuthController } from './auth.controller.js';
import { AuthMiddleware } from './auth.middleware.js';

const authMiddleware = new AuthMiddleware();

function createAuthRoutes(requireAccountType: boolean): FastifyPluginAsync {
  const authController = new AuthController(requireAccountType);

  return async (app) => {
  app.post('/register', (request, reply) => authController.register(request, reply));
  app.post('/login', (request, reply) => authController.login(request, reply));
  app.post('/google', (request, reply) => authController.loginWithGoogle(request, reply));
  app.post('/refresh', (request, reply) => authController.refresh(request, reply));
  app.post('/phone-verifications', (request, reply) =>
    authController.requestPhoneVerification(request, reply)
  );
  app.post('/phone-verifications/confirm', (request, reply) =>
    authController.verifyPhone(request, reply)
  );
  app.post('/password-resets', (request, reply) =>
    authController.requestPasswordReset(request, reply)
  );
  app.post('/password-resets/complete', (request, reply) =>
    authController.resetPassword(request, reply)
  );
  app.get(
    '/me',
    { preHandler: (request, reply) => authMiddleware.verifyToken(request, reply) },
    async (request) => ({
      success: true,
      data: { user: request.user },
    })
  );
  app.put(
    '/me/email',
    { preHandler: (request, reply) => authMiddleware.verifyToken(request, reply) },
    (request, reply) => authController.setEmail(request, reply)
  );
  app.put(
    '/me/phone',
    { preHandler: (request, reply) => authMiddleware.verifyToken(request, reply) },
    (request, reply) => authController.setPhone(request, reply)
  );
  app.put(
    '/me/password',
    { preHandler: (request, reply) => authMiddleware.verifyToken(request, reply) },
    (request, reply) => authController.changePassword(request, reply)
  );
  app.post(
    '/email-verifications',
    { preHandler: (request, reply) => authMiddleware.verifyToken(request, reply) },
    (request, reply) => authController.resendEmailVerification(request, reply)
  );
  app.post(
    '/email-verifications/confirm',
    { preHandler: (request, reply) => authMiddleware.verifyToken(request, reply) },
    (request, reply) => authController.verifyEmail(request, reply)
  );
  app.post(
    '/logout',
    (request, reply) => authController.logout(request, reply)
  );
  };
}

export const authRoutes = createAuthRoutes(false);
export const typedAuthRoutes = createAuthRoutes(true);
