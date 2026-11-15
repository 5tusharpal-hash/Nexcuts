import fastify from 'fastify';
import multipart from '@fastify/multipart';
import { env } from '../config/env.js';
import { disconnectDb, disconnectRedis, pool } from './db.connect.js';
import { redisClient } from '../integrations/redis/redis.client.js';
import { logger } from './logger.js';
import { setupCors } from './cors.js';
import { setupHelmet } from './helmet.js';
import { authRoutes } from '../modules/auth/auth.routes.js';
import { tenancyRoutes } from '../modules/tenancy/tenancy.routes.js';
import { rbacRoutes } from '../modules/rbac/rbac.routes.js';
import { staffOnboardingRoutes } from '../modules/staff/staff-onboarding.routes.js';
import { salonServicesRoutes } from '../modules/services/services.routes.js';
import { salonOfferingsRoutes } from '../modules/salon_offerings/salon_offerings.routes.js';
import { loyaltyRoutes } from '../modules/loyalty/loyalty.routes.js';
import { posBillingWorkflowRoutes } from '../modules/pos_billing/pos_billing.workflow.routes.js';
import { inventoryRoutes } from '../modules/inventory/inventory.routes.js';
import { employeeManagementRoutes } from '../modules/employee_management/employee_management.routes.js';
import { reviewsRoutes } from '../modules/reviews/reviews.routes.js';
import { analyticsRoutes } from '../modules/analytics/analytics.routes.js';
import { customerLedgerRoutes } from '../modules/customer_ledger/customer_ledger.routes.js';
import { enquiriesRoutes } from '../modules/enquiries/enquiries.routes.js';
import { discoveryRoutes } from '../modules/discovery/discovery.routes.js';
import { notificationsRoutes } from '../modules/notifications/notifications.routes.js';
import { platformBillingRoutes } from '../modules/platform_billing/platform_billing.routes.js';
import { marketingRoutes } from '../modules/marketing/marketing.routes.js';
import { salonTaxRatesRoutes } from '../modules/pos_billing/salon_tax_rates.routes.js';
import { adminRoutes, salonProfileChangeRoutes } from '../modules/admin/admin.routes.js';
import { queueRoutes } from '../modules/queue/queue.routes.js';
import { bookingRoutes } from '../modules/booking/booking.routes.js';
import { registerErrorHandler } from '../shared/middlewares/errorHandler.js';
import { registerRequestProtection } from '../shared/middlewares/requestProtection.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody: Buffer | null;
  }
}

export async function buildApp() {
  const app = fastify({ loggerInstance: logger });
  app.decorateRequest('rawBody', null);
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, body, done) => {
      request.rawBody = Buffer.from(body);
      try {
        done(null, JSON.parse(body.toString('utf8')));
      } catch (error) {
        done(error instanceof Error ? error : new Error('Invalid JSON body'));
      }
    }
  );

  await setupHelmet(app);
  await setupCors(app);
  await app.register(multipart, {
    limits: { files: 1, fileSize: 5 * 1024 * 1024, fields: 4, parts: 5 },
  });
  registerErrorHandler(app);
  registerRequestProtection(app);
  app.decorateRequest('user', null);

  app.addHook('onClose', async () => {
    await disconnectDb();
    await disconnectRedis();
  });

  app.get('/health', async () => ({
    success: true,
    data: { status: 'ok' },
  }));

  app.get('/ready', async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      if (!redisClient.isOpen) {
        throw new Error('Redis is disconnected');
      }
      await redisClient.ping();
      return reply.send({ success: true, data: { status: 'ready' } });
    } catch (error) {
      return reply.status(503).send({
        success: false,
        error: {
          message: 'Service dependencies are unavailable',
          code: 'NOT_READY',
        },
      });
    }
  });

  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(tenancyRoutes, { prefix: '/api/v1' });
  await app.register(rbacRoutes, { prefix: '/api/v1' });
  await app.register(staffOnboardingRoutes, { prefix: '/api/v1' });
  await app.register(salonServicesRoutes, { prefix: '/api/v1' });
  await app.register(salonOfferingsRoutes, { prefix: '/api/v1' });
  await app.register(loyaltyRoutes, { prefix: '/api/v1' });
  await app.register(posBillingWorkflowRoutes, { prefix: '/api/v1' });
  await app.register(inventoryRoutes, { prefix: '/api/v1' });
  await app.register(employeeManagementRoutes, { prefix: '/api/v1' });
  await app.register(reviewsRoutes, { prefix: '/api/v1' });
  await app.register(analyticsRoutes, { prefix: '/api/v1' });
  await app.register(customerLedgerRoutes, { prefix: '/api/v1' });
  await app.register(enquiriesRoutes, { prefix: '/api/v1' });
  await app.register(discoveryRoutes, { prefix: '/api/v1' });
  await app.register(notificationsRoutes, { prefix: '/api/v1' });
  await app.register(platformBillingRoutes, { prefix: '/api/v1' });
  await app.register(marketingRoutes, { prefix: '/api/v1' });
  await app.register(salonTaxRatesRoutes, { prefix: '/api/v1' });
  await app.register(adminRoutes, { prefix: '/api/v1/admin' });
  await app.register(salonProfileChangeRoutes, { prefix: '/api/v1' });
  await app.register(queueRoutes, { prefix: '/api/v1/queues' });
  await app.register(bookingRoutes, { prefix: '/api/v1/bookings' });

  logger.info({ environment: env.NODE_ENV }, 'Fastify application initialized');
  return app;
}
