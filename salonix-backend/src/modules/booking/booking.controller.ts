import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { BookingService } from './booking.service';
import { requireRouteParam } from '../../shared/utils/request.js';
import { ApiError } from '../../shared/errors/ApiError.js';

const createBookingSchema = z.object({
    salonId: z.string().uuid(),
    serviceId: z.string().uuid(),
    staffId: z.string().uuid().optional(),
    appointmentTime: z.coerce.date(),
    type: z.enum(['APPOINTMENT', 'WALK_IN', 'GROUP']),
    note: z.string().optional(),
    replaceQueueEntryId: z.string().uuid().optional(),
    replaceBookingId: z.string().uuid().optional(),
}).refine((value) => !(value.replaceQueueEntryId && value.replaceBookingId), {
    message: 'Provide only one reservation to replace',
    path: ['replaceQueueEntryId'],
});

export class BookingController {
    constructor(private service: BookingService) {}

    async create(request: FastifyRequest, reply: FastifyReply) {
        if (!request.user) throw new ApiError(401, 'Authentication required');
        const data = createBookingSchema.parse(request.body);
        const result = await this.service.createAppointment({ ...data, userId: request.user.id });
        return reply.status(201).send({ success: true, data: result });
    }

    async cancel(request: FastifyRequest, reply: FastifyReply) {
        if (!request.user) throw new ApiError(401, 'Authentication required');
        const id = requireRouteParam(request.params, 'id');
        await this.service.cancelBooking(id, request.user.id);
        return reply.send({ success: true, message: 'Booking cancelled' });
    }
}
