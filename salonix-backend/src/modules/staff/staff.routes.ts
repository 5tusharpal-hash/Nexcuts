import type { FastifyPluginAsync } from 'fastify';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { StaffRepository } from './staff.repository';

export const staffRoutes: FastifyPluginAsync = async (app) => {
    const repository = new StaffRepository();
    const service = new StaffService(repository);
    const controller = new StaffController(service);

    app.post('/onboard', (request, reply) => controller.createStaff(request, reply));
    app.patch('/:staffId/rate', (request, reply) => controller.updateRate(request, reply));
    app.get('/experts', (request, reply) => controller.getStylistsForService(request, reply));
};
