import type { FastifyPluginAsync } from 'fastify';
import { AuthMiddleware } from '../auth/auth.middleware.js';
import { RbacMiddleware } from '../rbac/rbac.middleware.js';
import { SalonOfferingsController } from './salon_offerings.controller.js';
import { SalonOfferingsService } from './salon_offerings.service.js';
import { SalonOfferingsRepository } from './salon_offerings.repository.js';

const authMiddleware = new AuthMiddleware();
const rbacMiddleware = new RbacMiddleware();

export const salonOfferingsRoutes: FastifyPluginAsync = async (app) => {
    const repository = new SalonOfferingsRepository();
    const service = new SalonOfferingsService(repository);
    const controller = new SalonOfferingsController(service);
    const authenticate = (
        request: Parameters<typeof authMiddleware.verifyToken>[0],
        reply: Parameters<typeof authMiddleware.verifyToken>[1]
    ) => authMiddleware.verifyToken(request, reply);
    const manageOffers = rbacMiddleware.check('offers:manage');
    const manageBilling = rbacMiddleware.check('billing:manage');
    const offerManager = { preHandler: [authenticate, manageOffers] };
    const billingManager = { preHandler: [authenticate, manageBilling] };

    app.get('/salons/:salonId/packages', (request) =>
        controller.listOfferings(request, 'PACKAGE', true)
    );
    app.get('/salons/:salonId/packages/:packageId', (request) =>
        controller.getOffering(request, 'PACKAGE', true)
    );
    app.get('/salons/:salonId/service-combos', (request) =>
        controller.listOfferings(request, 'COMBO', true)
    );
    app.get('/salons/:salonId/service-combos/:comboId', (request) =>
        controller.getOffering(request, 'COMBO', true)
    );

    app.get('/salons/:salonId/offer-catalog', offerManager, (request) =>
        controller.listOfferings(request)
    );
    app.post('/salons/:salonId/packages', offerManager, (request, reply) =>
        controller.createPackage(request, reply)
    );
    app.get('/salons/:salonId/packages/:packageId/catalog', offerManager, (request) =>
        controller.getOffering(request, 'PACKAGE')
    );
    app.patch('/salons/:salonId/packages/:packageId', offerManager, (request) =>
        controller.updatePackage(request)
    );
    app.post('/salons/:salonId/service-combos', offerManager, (request, reply) =>
        controller.createCombo(request, reply)
    );
    app.get('/salons/:salonId/service-combos/:comboId/catalog', offerManager, (request) =>
        controller.getOffering(request, 'COMBO')
    );
    app.patch('/salons/:salonId/service-combos/:comboId', offerManager, (request) =>
        controller.updateCombo(request)
    );

    app.post(
        '/salons/:salonId/offer-purchase-requests',
        { preHandler: [authenticate] },
        (request, reply) => controller.createPurchaseRequest(request, reply)
    );
    app.get('/salons/:salonId/offer-purchase-requests', offerManager, (request) =>
        controller.listPurchaseRequests(request)
    );
    app.get('/salons/:salonId/offer-purchase-requests/:requestId', offerManager, (request) =>
        controller.getSalonPurchaseRequest(request)
    );
    app.get(
        '/me/salons/:salonId/offer-purchase-requests/:requestId',
        { preHandler: [authenticate] },
        (request) => controller.getMyPurchaseRequest(request)
    );
    app.get('/me/offer-purchases', { preHandler: [authenticate] }, (request) =>
        controller.listMyPurchases(request)
    );
    app.get(
        '/me/salons/:salonId/offer-ledger',
        { preHandler: [authenticate] },
        (request) => controller.listMyLedger(request)
    );
    app.post(
        '/salons/:salonId/offer-purchase-requests/:requestId/checkouts',
        offerManager,
        (request) => controller.startCheckout(request)
    );
    app.patch(
        '/salons/:salonId/offer-purchase-requests/:requestId/quote',
        offerManager,
        (request) => controller.updateSaleQuote(request)
    );
    app.post(
        '/salons/:salonId/offer-purchase-requests/:requestId/bills',
        billingManager,
        (request) => controller.attachDraftBill(request)
    );
    app.post(
        '/salons/:salonId/offer-purchase-requests/:requestId/rejections',
        offerManager,
        (request) => controller.rejectPurchaseRequest(request)
    );
    app.post(
        '/salons/:salonId/offer-sales',
        offerManager,
        (request, reply) => controller.createManualSale(request, reply)
    );
    app.post(
        '/salons/:salonId/offer-purchase-requests/:requestId/settlements',
        billingManager,
        (request) => controller.confirmSettlement(request)
    );
    app.post(
        '/salons/:salonId/package-subscriptions/:subscriptionId/redemptions',
        billingManager,
        (request) => controller.redeemPackage(request)
    );
    app.post(
        '/salons/:salonId/combo-purchases/:comboPurchaseId/redemptions',
        billingManager,
        (request) => controller.redeemCombo(request)
    );
    app.get(
        '/salons/:salonId/customers/:customerAccountId/offer-ledger',
        offerManager,
        (request) => controller.listLedger(request)
    );
};
