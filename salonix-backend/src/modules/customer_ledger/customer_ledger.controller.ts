import type { FastifyReply, FastifyRequest } from 'fastify';
import { CustomerLedgerService } from './customer_ledger.service';
import { requireRouteParam } from '../../shared/utils/request.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import {
    customerLedgerBillParamsSchema,
    customerLedgerQuerySchema,
} from './customer_ledger.validation.js';

export class CustomerLedgerController {
    constructor(private readonly service: CustomerLedgerService) {}

    async getTimeline(request: FastifyRequest, reply: FastifyReply) {
        const userId = this.customerId(request);
        const query = customerLedgerQuerySchema.parse(request.query);
        const result = await this.service.getCustomerTimeline(userId, query.limit, query.offset);
        return reply.send({ success: true, data: result });
    }

    async getDetails(request: FastifyRequest, reply: FastifyReply) {
        const { billId } = customerLedgerBillParamsSchema.parse({
            billId: requireRouteParam(request.params, 'billId'),
        });
        const result = await this.service.getBillDetails(billId, this.customerId(request));
        return reply.send({ success: true, data: result });
    }

    private customerId(request: FastifyRequest): string {
        if (!request.user || request.user.account_type !== 'CUSTOMER') {
            throw new ApiError(403, 'A customer account is required');
        }
        return request.user.id;
    }
}
