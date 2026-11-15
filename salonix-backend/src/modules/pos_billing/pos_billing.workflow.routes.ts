import type { FastifyPluginAsync } from 'fastify';
import { AuthMiddleware } from '../auth/auth.middleware.js';
import { RbacMiddleware } from '../rbac/rbac.middleware.js';
import { PosBillingWorkflowController } from './pos_billing.workflow.controller.js';
import { PosBillingWorkflowRepository } from './pos_billing.workflow.repository.js';
import { PosBillingWorkflowService } from './pos_billing.workflow.service.js';

const authMiddleware = new AuthMiddleware();
const rbacMiddleware = new RbacMiddleware();

export const posBillingWorkflowRoutes: FastifyPluginAsync = async (app) => {
    const controller = new PosBillingWorkflowController(
        new PosBillingWorkflowService(new PosBillingWorkflowRepository())
    );
    const authenticate = (
        request: Parameters<typeof authMiddleware.verifyToken>[0],
        reply: Parameters<typeof authMiddleware.verifyToken>[1]
    ) => authMiddleware.verifyToken(request, reply);
    const billingManager = {
        preHandler: [authenticate, rbacMiddleware.check('billing:manage')],
    };
    const customerAuth = { preHandler: [authenticate] };

    app.post('/salons/:salonId/pos-sessions', billingManager, (request, reply) =>
        controller.createSession(request, reply)
    );
    app.post('/salons/:salonId/pos-sessions/:sessionId/bills', billingManager, (request, reply) =>
        controller.createBill(request, reply)
    );
    app.get('/salons/:salonId/pos-bills', billingManager, (request) =>
        controller.listBills(request)
    );
    app.get('/salons/:salonId/pos-category-settings', billingManager, (request) =>
        controller.listCategorySettings(request)
    );
    app.put('/salons/:salonId/pos-category-settings/:category', billingManager, (request) =>
        controller.updateCategorySetting(request)
    );
    app.get('/salons/:salonId/pos-bills/:billId', billingManager, (request) =>
        controller.getBill(request)
    );
    app.post('/salons/:salonId/pos-bills/:billId/refunds', billingManager, (request, reply) =>
        controller.createRefund(request, reply)
    );
    app.get('/salons/:salonId/pos-refunds', billingManager, (request) =>
        controller.listRefunds(request)
    );
    app.patch('/salons/:salonId/pos-refunds/:refundId', billingManager, (request) =>
        controller.reviewRefund(request)
    );
    app.put('/salons/:salonId/pos-bills/:billId', billingManager, (request) =>
        controller.updateBill(request)
    );
    app.put(
        '/salons/:salonId/pos-bills/:billId/category-overrides/:category',
        billingManager,
        (request) => controller.updateBillCategoryOverride(request)
    );
    app.post('/salons/:salonId/pos-bills/:billId/versions', billingManager, (request, reply) =>
        controller.issueBill(request, reply)
    );
    app.post('/salons/:salonId/pos-bills/:billId/confirmations', billingManager, (request) =>
        controller.confirmBill(request)
    );
    app.post('/salons/:salonId/pos-bills/:billId/payments', billingManager, (request) =>
        controller.recordPayment(request)
    );
    app.post('/salons/:salonId/pos-bills/:billId/advance-allocations', billingManager, (request) =>
        controller.allocateAdvance(request)
    );
    app.get('/salons/:salonId/pos-payment-claims', billingManager, (request) =>
        controller.listPaymentClaims(request)
    );
    app.patch('/salons/:salonId/pos-payment-claims/:claimId', billingManager, (request) =>
        controller.reviewPaymentClaim(request)
    );
    app.patch(
        '/salons/:salonId/pos-wallet-redemptions/:redemptionId',
        billingManager,
        (request) => controller.reviewWalletRedemption(request)
    );
    app.post('/me/salons/:salonId/pos-payment-claims', customerAuth, (request, reply) =>
        controller.createPaymentClaim(request, reply)
    );
    app.get('/me/salons/:salonId/pos-bills', customerAuth, (request) =>
        controller.listCustomerBills(request)
    );
    app.get('/me/salons/:salonId/pos-bills/:billId', customerAuth, (request) =>
        controller.getCustomerBill(request)
    );
    app.post('/me/salons/:salonId/pos-advance-claims', customerAuth, (request, reply) =>
        controller.createAdvanceClaim(request, reply)
    );
    app.post('/me/salons/:salonId/pos-wallet-redemptions', customerAuth, (request, reply) =>
        controller.createWalletRedemption(request, reply)
    );
    app.post(
        '/me/salons/:salonId/pos-wallet-redemptions/:redemptionId/verifications',
        customerAuth,
        (request) => controller.verifyWalletRedemption(request)
    );
};
