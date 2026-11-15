import type { FastifyPluginAsync } from 'fastify';
import { AuthMiddleware } from '../auth/auth.middleware.js';
import { RbacMiddleware } from '../rbac/rbac.middleware.js';
import { PlatformBillingController } from './platform_billing.controller.js';
import { PlatformBillingService } from './platform_billing.service.js';
import { PlatformBillingRepository } from './platform_billing.repository.js';

const authMiddleware = new AuthMiddleware();
const rbacMiddleware = new RbacMiddleware();

export const platformBillingRoutes: FastifyPluginAsync = async (app) => {
    const repository = new PlatformBillingRepository();
    const service = new PlatformBillingService(repository);
    const controller = new PlatformBillingController(service, repository);
    const authenticate = (
        request: Parameters<typeof authMiddleware.verifyToken>[0],
        reply: Parameters<typeof authMiddleware.verifyToken>[1]
    ) => authMiddleware.verifyToken(request, reply);
    const billingManager = {
        preHandler: [authenticate, rbacMiddleware.check('billing:manage')],
    };
    const adminOnly = { preHandler: [authenticate] };

    app.post('/salons/:salonId/platform-billing/invoices', billingManager, (request, reply) =>
        controller.generateInvoice(request, reply)
    );
    app.get('/salons/:salonId/platform-billing/invoices', billingManager, (request) =>
        controller.listInvoices(request)
    );
    app.post('/salons/:salonId/platform-billing/checkout', billingManager, (request, reply) =>
        controller.createConsolidatedCheckout(request, reply)
    );
    app.post('/salons/:salonId/platform-billing/addons/:addonId/purchases', billingManager, (request, reply) =>
        controller.purchaseAddon(request, reply)
    );
    app.post(
        '/salons/:salonId/platform-billing/invoices/:invoiceId/checkout',
        billingManager,
        (request, reply) => controller.createCheckout(request, reply)
    );
    app.get('/salons/:salonId/platform-billing/status', billingManager, (request) =>
        controller.checkStatus(request)
    );
    app.get('/salons/:salonId/platform-billing/profile', billingManager, (request) =>
        controller.getSalonBillingProfile(request)
    );
    app.put('/salons/:salonId/platform-billing/profile', billingManager, (request) =>
        controller.updateSalonBillingProfile(request)
    );
    app.get('/admin/platform-billing/gst-settings', adminOnly, (request) =>
        controller.getPlatformGstSettings(request)
    );
    app.put('/admin/platform-billing/gst-settings', adminOnly, (request) =>
        controller.updatePlatformGstSettings(request)
    );
    app.post('/admin/platform-billing/payments/:paymentId/reconcile', adminOnly, (request) =>
        controller.reconcilePayment(request)
    );
    app.post('/webhooks/platform-billing/stripe', (request) =>
        controller.stripeWebhook(request)
    );
    app.post('/webhooks/platform-billing/razorpay', (request) =>
        controller.razorpayWebhook(request)
    );
};
