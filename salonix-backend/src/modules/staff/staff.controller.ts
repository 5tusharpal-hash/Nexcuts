import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { StaffService } from './staff.service';
import { phoneNumberSchema } from '../../shared/validation/phone-number.js';

const staffOnboardingSchema = z.object({
    email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
    password: z.string().min(12).max(72)
        .refine((value) => Buffer.byteLength(value, 'utf8') <= 72),
    phone: phoneNumberSchema,
    fullName: z.string().trim().min(2).max(255),
    salonId: z.string().uuid(),
    expertise: z.array(z.string().uuid()).optional(),
    commissionRate: z.number().min(0).max(100).optional(),
    roles: z.array(z.string().min(1)).optional(),
    role: z.string().min(1).optional(),
});

export class StaffController {
    constructor(private service: StaffService) {}

    async createStaff(request: FastifyRequest, reply: FastifyReply) {
        const result = await this.service.onboardStaff(staffOnboardingSchema.parse(request.body));
        return reply.status(201).send({ success: true, data: result });
    }

    async getStylistsForService(request: FastifyRequest, reply: FastifyReply) {
        const { salonId, serviceId } = z.object({
            salonId: z.string().uuid(),
            serviceId: z.string().uuid(),
        }).parse(request.query);
        const result = await this.service.getAvailableStylists(salonId, serviceId);
        return reply.send({ success: true, data: result });
    }

    async updateRate(request: FastifyRequest, reply: FastifyReply) {
        const params = request.params as Record<string, unknown>;
        const staffId = z.string().uuid().parse(params.staffId);
        const { rate } = z.object({ rate: z.number().min(0).max(100) }).parse(request.body);
        await this.service.updateProfessionalRate(staffId, rate);
        return reply.send({ success: true, message: 'Commission rate updated' });
    }
}
