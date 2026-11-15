import type { FastifyPluginAsync } from 'fastify';
import { AuthMiddleware } from '../auth/auth.middleware.js';
import { RbacMiddleware } from '../rbac/rbac.middleware.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryRepository } from './inventory.repository.js';
import { InventoryService } from './inventory.service.js';

const authMiddleware = new AuthMiddleware();
const rbacMiddleware = new RbacMiddleware();

export const inventoryRoutes: FastifyPluginAsync = async (app) => {
    const repository = new InventoryRepository();
    const service = new InventoryService(repository);
    const controller = new InventoryController(service);
    const authenticate = (
        request: Parameters<typeof authMiddleware.verifyToken>[0],
        reply: Parameters<typeof authMiddleware.verifyToken>[1]
    ) => authMiddleware.verifyToken(request, reply);
    const inventoryManager = {
        preHandler: [authenticate, rbacMiddleware.check('inventory:manage')],
    };
    const authenticated = { preHandler: [authenticate] };

    app.get('/salons/:salonId/inventory-products', inventoryManager, (request) =>
        controller.listProducts(request)
    );
    app.post('/salons/:salonId/inventory-products', inventoryManager, (request, reply) =>
        controller.createProduct(request, reply)
    );
    app.get('/salons/:salonId/inventory-products/:productId', inventoryManager, (request) =>
        controller.getProduct(request)
    );
    app.patch('/salons/:salonId/inventory-products/:productId', inventoryManager, (request) =>
        controller.updateProduct(request)
    );
    app.delete('/salons/:salonId/inventory-products/:productId', inventoryManager, (request, reply) =>
        controller.archiveProduct(request, reply)
    );
    app.post(
        '/salons/:salonId/inventory-products/:productId/classifications',
        inventoryManager,
        (request) => controller.classifyLegacyProduct(request)
    );
    app.get(
        '/salons/:salonId/inventory-products/:productId/batches',
        inventoryManager,
        (request) => controller.listBatches(request)
    );
    app.post(
        '/salons/:salonId/inventory-products/:productId/batches',
        inventoryManager,
        (request, reply) => controller.receiveBatch(request, reply)
    );
    app.post(
        '/salons/:salonId/inventory-products/:productId/adjustments',
        inventoryManager,
        (request) => controller.adjustBatch(request)
    );
    app.get(
        '/salons/:salonId/inventory-products/:productId/ledger',
        inventoryManager,
        (request) => controller.getLedger(request)
    );
    app.post(
        '/salons/:salonId/inventory-products/:productId/barcodes',
        inventoryManager,
        (request, reply) => controller.addBarcode(request, reply)
    );
    app.delete(
        '/salons/:salonId/inventory-products/:productId/barcodes/:barcode',
        inventoryManager,
        (request, reply) => controller.removeBarcode(request, reply)
    );
    app.post(
        '/salons/:salonId/inventory-barcode-lookups',
        inventoryManager,
        (request) => controller.lookupBarcode(request)
    );

    app.get('/salons/:salonId/inventory-alerts/low-stock', inventoryManager, (request) =>
        controller.getLowStock(request)
    );
    app.get('/salons/:salonId/inventory-alerts/expiring-batches', inventoryManager, (request) =>
        controller.getExpiringBatches(request)
    );
    app.get('/salons/:salonId/inventory-service-usage', inventoryManager, (request) =>
        controller.listServiceUsage(request)
    );

    app.get(
        '/salons/:salonId/services/:serviceId/consumables',
        inventoryManager,
        (request) => controller.getServiceConsumables(request)
    );
    app.post(
        '/salons/:salonId/services/:serviceId/consumables',
        inventoryManager,
        (request, reply) => controller.createServiceConsumable(request, reply)
    );
    app.patch(
        '/salons/:salonId/services/:serviceId/consumables/:productId',
        inventoryManager,
        (request) => controller.updateServiceConsumable(request)
    );
    app.delete(
        '/salons/:salonId/services/:serviceId/consumables/:productId',
        inventoryManager,
        (request, reply) => controller.deleteServiceConsumable(request, reply)
    );

    app.post(
        '/salons/:salonId/inventory-issue-requests',
        authenticated,
        (request, reply) => controller.createIssueRequest(request, reply)
    );
    app.get(
        '/salons/:salonId/inventory-issue-requests/me',
        authenticated,
        (request) => controller.listMyIssueRequests(request)
    );
    app.get(
        '/salons/:salonId/inventory-issue-requests',
        inventoryManager,
        (request) => controller.listIssueRequests(request)
    );
    app.patch(
        '/salons/:salonId/inventory-issue-requests/:requestId',
        inventoryManager,
        (request) => controller.reviewIssueRequest(request)
    );
    app.patch(
        '/salons/:salonId/inventory-issue-requests/:requestId/closures',
        authenticated,
        (request) => controller.closeIssueRequest(request)
    );
    app.get(
        '/salons/:salonId/inventory-issue-requests/:requestId/events',
        inventoryManager,
        (request) => controller.listIssueEvents(request)
    );
};
