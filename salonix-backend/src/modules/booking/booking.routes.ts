import type { FastifyPluginAsync } from 'fastify';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { BookingRepository } from './booking.repository';
import { StaffService } from '../staff/staff.service';
import { StaffRepository } from '../staff/staff.repository';

export const bookingRoutes: FastifyPluginAsync = async (app) => {
    const repository = new BookingRepository();
    const staffRepository = new StaffRepository();
    const staffService = new StaffService(staffRepository);
    const service = new BookingService(repository, staffService);
    const controller = new BookingController(service);

    app.post('/', (request, reply) => controller.create(request, reply));
    app.patch('/:id/cancel', (request, reply) => controller.cancel(request, reply));
};
