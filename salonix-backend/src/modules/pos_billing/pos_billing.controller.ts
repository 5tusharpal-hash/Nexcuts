import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { PosBillingService } from './pos_billing.service';
import { requireRouteParam } from '../../shared/utils/request.js';

const checkoutSchema = z.object({
    userId: z.string().uuid(),
    salonId: z.string().uuid(),
    bookingId: z.string().uuid().optional(),
    paymentMethod: z.enum(['CASH', 'ONLINE', 'POINTS', 'PACKAGE', 'COMBO']),
    amountPaid: z.number().nonnegative(),
    items: z.array(z.object({
        serviceId: z.string().uuid().optional(),
        productId: z.string().uuid().optional(),
        staffMembershipId: z.string().uuid().optional(),
        quantity: z.number().int().positive(),
        price: z.number().nonnegative().optional(),
    }).refine((item) => Boolean(item.serviceId) !== Boolean(item.productId), {
        message: 'Each bill item must specify exactly one service or product',
    })).min(1),
});

export class PosBillingController {
    constructor(private service: PosBillingService) {}

    async checkout(request: FastifyRequest, reply: FastifyReply) {
        const { userId, salonId, items, ...bill } = checkoutSchema.parse(request.body);
        const result = await this.service.checkout(bill, items, userId, salonId);
        return reply.status(201).send({ success: true, data: result });
    }

    async getBill(request: FastifyRequest, reply: FastifyReply) {
        const id = requireRouteParam(request.params, 'id');
        const bill = await this.service.getBill(id);
        if (!bill) return reply.status(404).send({
            success: false,
            error: { message: 'Bill not found', code: 'NOT_FOUND' },
        });
        return reply.send({ success: true, data: bill });
    }
}
