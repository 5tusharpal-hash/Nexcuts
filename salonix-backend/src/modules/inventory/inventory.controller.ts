import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../../shared/errors/ApiError.js';
import { requireRouteParam } from '../../shared/utils/request.js';
import { InventoryService } from './inventory.service.js';
import {
    barcodeLookupSchema,
    classifyLegacyProductSchema,
    closeInventoryIssueSchema,
    createConsumableMappingSchema,
    createInventoryIssueSchema,
    createInventoryProductSchema,
    inventoryAdjustmentSchema,
    inventoryPageQuerySchema,
    inventoryProductListQuerySchema,
    inventoryServiceUsageQuerySchema,
    receiveInventoryBatchSchema,
    reviewInventoryIssueSchema,
    updateInventoryProductSchema,
} from './inventory.validation.js';

export class InventoryController {
    constructor(private readonly service: InventoryService) {}

    async listProducts(request: FastifyRequest) {
        const query = inventoryProductListQuerySchema.parse(request.query);
        return {
            success: true,
            data: await this.service.listProducts(this.salonId(request), query),
        };
    }

    async getProduct(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.getProduct(
                this.salonId(request),
                requireRouteParam(request.params, 'productId')
            ),
        };
    }

    async createProduct(request: FastifyRequest, reply: FastifyReply) {
        const result = await this.service.createProduct(
            this.salonId(request),
            createInventoryProductSchema.parse(request.body)
        );
        return reply.status(201).send({ success: true, data: result });
    }

    async updateProduct(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.updateProduct(
                this.salonId(request),
                requireRouteParam(request.params, 'productId'),
                updateInventoryProductSchema.parse(request.body)
            ),
        };
    }

    async archiveProduct(request: FastifyRequest, reply: FastifyReply) {
        await this.service.archiveProduct(
            this.salonId(request),
            requireRouteParam(request.params, 'productId')
        );
        return reply.status(204).send();
    }

    async classifyLegacyProduct(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.classifyLegacyProduct(
                this.salonId(request),
                requireRouteParam(request.params, 'productId'),
                classifyLegacyProductSchema.parse(request.body)
            ),
        };
    }

    async receiveBatch(request: FastifyRequest, reply: FastifyReply) {
        const result = await this.service.receiveBatch(
            this.salonId(request),
            requireRouteParam(request.params, 'productId'),
            this.accountId(request),
            receiveInventoryBatchSchema.parse(request.body)
        );
        return reply.status(201).send({ success: true, data: result });
    }

    async listBatches(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.listBatches(
                this.salonId(request),
                requireRouteParam(request.params, 'productId'),
                inventoryPageQuerySchema.parse(request.query)
            ),
        };
    }

    async lookupBarcode(request: FastifyRequest) {
        const { barcode } = barcodeLookupSchema.parse(request.body);
        return {
            success: true,
            data: await this.service.lookupBarcode(this.salonId(request), barcode),
        };
    }

    async addBarcode(request: FastifyRequest, reply: FastifyReply) {
        const { barcode } = barcodeLookupSchema.parse(request.body);
        const result = await this.service.addBarcode(
            this.salonId(request),
            requireRouteParam(request.params, 'productId'),
            barcode
        );
        return reply.status(201).send({ success: true, data: result });
    }

    async removeBarcode(request: FastifyRequest, reply: FastifyReply) {
        await this.service.removeBarcode(
            this.salonId(request),
            requireRouteParam(request.params, 'productId'),
            requireRouteParam(request.params, 'barcode')
        );
        return reply.status(204).send();
    }

    async adjustBatch(request: FastifyRequest) {
        await this.service.adjustBatch(
            this.salonId(request),
            requireRouteParam(request.params, 'productId'),
            this.accountId(request),
            inventoryAdjustmentSchema.parse(request.body)
        );
        return { success: true, data: { adjusted: true } };
    }

    async getLedger(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.getLedger(
                this.salonId(request),
                requireRouteParam(request.params, 'productId'),
                inventoryPageQuerySchema.parse(request.query)
            ),
        };
    }

    async getLowStock(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.getLowStockItems(
                this.salonId(request),
                inventoryPageQuerySchema.parse(request.query)
            ),
        };
    }

    async getExpiringBatches(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.getExpiringBatches(
                this.salonId(request),
                inventoryPageQuerySchema.parse(request.query)
            ),
        };
    }

    async getServiceConsumables(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.getConsumablesForService(
                requireRouteParam(request.params, 'serviceId'),
                this.salonId(request)
            ),
        };
    }

    async createServiceConsumable(request: FastifyRequest, reply: FastifyReply) {
        const result = await this.service.createConsumableMapping(
            this.salonId(request),
            requireRouteParam(request.params, 'serviceId'),
            createConsumableMappingSchema.parse(request.body)
        );
        return reply.status(201).send({ success: true, data: result });
    }

    async updateServiceConsumable(request: FastifyRequest) {
        const { quantityRequired } = createConsumableMappingSchema
            .pick({ quantityRequired: true })
            .parse(request.body);
        return {
            success: true,
            data: await this.service.updateConsumableMapping(
                this.salonId(request),
                requireRouteParam(request.params, 'serviceId'),
                requireRouteParam(request.params, 'productId'),
                quantityRequired
            ),
        };
    }

    async deleteServiceConsumable(request: FastifyRequest, reply: FastifyReply) {
        await this.service.deleteConsumableMapping(
            this.salonId(request),
            requireRouteParam(request.params, 'serviceId'),
            requireRouteParam(request.params, 'productId')
        );
        return reply.status(204).send();
    }

    async listServiceUsage(request: FastifyRequest) {
        const query = inventoryServiceUsageQuerySchema.parse(request.query);
        return {
            success: true,
            data: await this.service.listServiceUsage(
                this.salonId(request),
                query.productId,
                query
            ),
        };
    }

    async createIssueRequest(request: FastifyRequest, reply: FastifyReply) {
        const result = await this.service.createIssueRequest(
            this.salonId(request),
            this.accountId(request),
            createInventoryIssueSchema.parse(request.body)
        );
        return reply.status(201).send({ success: true, data: result });
    }

    async listIssueRequests(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.listIssueRequests(
                this.salonId(request),
                inventoryPageQuerySchema.parse(request.query)
            ),
        };
    }

    async listMyIssueRequests(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.listIssueRequests(
                this.salonId(request),
                inventoryPageQuerySchema.parse(request.query),
                this.accountId(request)
            ),
        };
    }

    async reviewIssueRequest(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.reviewIssueRequest(
                this.salonId(request),
                requireRouteParam(request.params, 'requestId'),
                this.accountId(request),
                reviewInventoryIssueSchema.parse(request.body)
            ),
        };
    }

    async closeIssueRequest(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.closeIssueRequest(
                this.salonId(request),
                requireRouteParam(request.params, 'requestId'),
                this.accountId(request),
                closeInventoryIssueSchema.parse(request.body)
            ),
        };
    }

    async listIssueEvents(request: FastifyRequest) {
        return {
            success: true,
            data: await this.service.listIssueEvents(
                this.salonId(request),
                requireRouteParam(request.params, 'requestId')
            ),
        };
    }

    private accountId(request: FastifyRequest): string {
        if (!request.user) throw new ApiError(401, 'Authentication required');
        return request.user.id;
    }

    private salonId(request: FastifyRequest): string {
        return requireRouteParam(request.params, 'salonId');
    }
}
