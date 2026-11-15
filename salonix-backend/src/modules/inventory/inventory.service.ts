import { InventoryRepository } from './inventory.repository.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import type {
    ClassifyLegacyProductRequest,
    CloseInventoryIssueRequest,
    CreateConsumableMappingRequest,
    CreateInventoryIssueRequest,
    CreateInventoryProductRequest,
    InventoryAdjustmentRequest,
    InventoryPageQuery,
    ReceiveInventoryBatchRequest,
    ReviewInventoryIssueRequest,
    UpdateInventoryProductRequest,
} from './inventory.types.js';

export class InventoryService {
    constructor(private repository: InventoryRepository) {}

    listProducts(
        salonId: string,
        query: InventoryPageQuery & {
            inventoryType?: 'RETAIL' | 'SALON_USE' | 'LEGACY_UNCLASSIFIED';
            includeInactive: boolean;
        }
    ) {
        return this.repository.listProducts(salonId, query);
    }

    async getProduct(salonId: string, productId: string) {
        const product = await this.repository.getProduct(salonId, productId);
        if (!product) throw new ApiError(404, 'Inventory product was not found');
        return product;
    }

    createProduct(salonId: string, input: CreateInventoryProductRequest) {
        return this.repository.createProduct(salonId, input);
    }

    updateProduct(salonId: string, productId: string, input: UpdateInventoryProductRequest) {
        return this.repository.updateProduct(salonId, productId, input);
    }

    archiveProduct(salonId: string, productId: string) {
        return this.repository.archiveProduct(salonId, productId);
    }

    classifyLegacyProduct(
        salonId: string,
        productId: string,
        input: ClassifyLegacyProductRequest
    ) {
        return this.repository.classifyLegacyProduct(salonId, productId, input);
    }

    receiveBatch(
        salonId: string,
        productId: string,
        actorAccountId: string,
        input: ReceiveInventoryBatchRequest
    ) {
        return this.repository.receiveBatch(salonId, productId, actorAccountId, input);
    }

    listBatches(salonId: string, productId: string, query: InventoryPageQuery) {
        return this.repository.listBatches(salonId, productId, query);
    }

    lookupBarcode(salonId: string, barcode: string) {
        return this.repository.lookupBarcode(salonId, barcode);
    }

    addBarcode(salonId: string, productId: string, barcode: string) {
        return this.repository.addBarcode(salonId, productId, barcode);
    }

    removeBarcode(salonId: string, productId: string, barcode: string) {
        return this.repository.removeBarcode(salonId, productId, barcode);
    }

    adjustBatch(
        salonId: string,
        productId: string,
        actorAccountId: string,
        input: InventoryAdjustmentRequest
    ) {
        return this.repository.adjustBatch(salonId, productId, actorAccountId, input);
    }

    getLedger(salonId: string, productId: string, query: InventoryPageQuery) {
        return this.repository.getLedger(salonId, productId, query);
    }

    getExpiringBatches(salonId: string, query: InventoryPageQuery) {
        return this.repository.listExpiringBatches(salonId, query);
    }

    getLowStockItems(salonId: string, query: InventoryPageQuery) {
        return this.repository.getLowStockItems(salonId, query);
    }

    getConsumablesForService(serviceId: string, salonId: string) {
        return this.repository.getConsumablesForService(serviceId, salonId);
    }

    createConsumableMapping(
        salonId: string,
        serviceId: string,
        input: CreateConsumableMappingRequest
    ) {
        return this.repository.createConsumableMapping(salonId, serviceId, input);
    }

    updateConsumableMapping(
        salonId: string,
        serviceId: string,
        productId: string,
        quantityRequired: number
    ) {
        return this.repository.updateConsumableMapping(
            salonId, serviceId, productId, quantityRequired
        );
    }

    deleteConsumableMapping(salonId: string, serviceId: string, productId: string) {
        return this.repository.deleteConsumableMapping(salonId, serviceId, productId);
    }

    listServiceUsage(
        salonId: string,
        productId: string | undefined,
        query: InventoryPageQuery
    ) {
        return this.repository.listServiceUsage(salonId, productId, query);
    }

    createIssueRequest(
        salonId: string,
        actorAccountId: string,
        input: CreateInventoryIssueRequest
    ) {
        return this.repository.createIssueRequest(salonId, actorAccountId, input);
    }

    listIssueRequests(salonId: string, query: InventoryPageQuery, actorAccountId?: string) {
        return this.repository.listIssueRequests(salonId, query, actorAccountId);
    }

    reviewIssueRequest(
        salonId: string,
        requestId: string,
        actorAccountId: string,
        input: ReviewInventoryIssueRequest
    ) {
        return this.repository.reviewIssueRequest(salonId, requestId, actorAccountId, input);
    }

    closeIssueRequest(
        salonId: string,
        requestId: string,
        actorAccountId: string,
        input: CloseInventoryIssueRequest
    ) {
        return this.repository.closeIssueRequest(salonId, requestId, actorAccountId, input);
    }

    listIssueEvents(salonId: string, requestId: string) {
        return this.repository.listIssueEvents(salonId, requestId);
    }

    runDueReminders() {
        return this.repository.runDueReminders();
    }
}
