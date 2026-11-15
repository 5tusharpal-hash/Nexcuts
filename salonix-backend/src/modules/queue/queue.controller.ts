import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { QueueService } from './queue.service.js';
import { ApiError } from '../../shared/errors/ApiError.js';

export class QueueController {
    constructor(private service: QueueService) {}

    async join(request: FastifyRequest, reply: FastifyReply) {
        if (!request.user) throw new ApiError(401, 'Authentication required');
        const { salonId, serviceId, priority, marketingConsent, preferredStaffId, preferredTime, replaceQueueEntryId, replaceBookingId } = z.object({
            salonId: z.string().uuid(),
            serviceId: z.string().uuid(),
            priority: z.enum(['NORMAL', 'VIP', 'EMERGENCY']).default('NORMAL'),
            marketingConsent: z.boolean(),
            preferredStaffId: z.string().uuid().optional(),
            preferredTime: z.string().datetime().optional(),
            replaceQueueEntryId: z.string().uuid().optional(),
            replaceBookingId: z.string().uuid().optional(),
        }).refine((value) => !(value.replaceQueueEntryId && value.replaceBookingId), {
            message: 'Provide only one reservation to replace',
            path: ['replaceQueueEntryId'],
        }).parse(request.body);
        const result = await this.service.joinQueue(request.user.id, salonId, serviceId, priority, marketingConsent, preferredStaffId, preferredTime ? new Date(preferredTime) : undefined, replaceQueueEntryId, replaceBookingId);
        return reply.status(201).send({ success: true, data: result });
    }

    async callNext(request: FastifyRequest, reply: FastifyReply) {
        if (!request.user) throw new ApiError(401, 'Authentication required');
        const { salonId, staffId } = z.object({
            salonId: z.string().uuid(),
            staffId: z.string().uuid(),
        }).parse(request.body);
        const result = await this.service.callNextCustomer(request.user.id, salonId, staffId);
        return reply.send({ success: true, data: result });
    }

    async markCompleted(request: FastifyRequest, reply: FastifyReply) {
        if (!request.user) throw new ApiError(401, 'Authentication required');
        const { entryId } = z.object({ entryId: z.string().uuid() }).parse(request.params);
        const { salonId } = z.object({ salonId: z.string().uuid() }).parse(request.body);
        const result = await this.service.markCompleted(request.user.id, salonId, entryId);
        return reply.send({ success: true, data: result });
    }

    async markNoShow(request: FastifyRequest, reply: FastifyReply) {
        if (!request.user) throw new ApiError(401, 'Authentication required');
        const { entryId } = z.object({ entryId: z.string().uuid() }).parse(request.params);
        const { salonId } = z.object({ salonId: z.string().uuid() }).parse(request.body);
        const result = await this.service.markNoShow(request.user.id, salonId, entryId);
        return reply.send({ success: true, data: result });
    }

    async getPosition(request: FastifyRequest, reply: FastifyReply) {
        if (!request.user) throw new ApiError(401, 'Authentication required');
        const { salonId } = z.object({ salonId: z.string().uuid() }).parse(request.query);
        const result = await this.service.getMyPosition(request.user.id, salonId);
        return reply.send({ success: true, data: result });
    }

    async getAdvancedPlan(request: FastifyRequest, reply: FastifyReply) {
        if (!request.user) throw new ApiError(401, 'Authentication required');
        const { salonId } = z.object({ salonId: z.string().uuid() }).parse(request.query);
        const result = await this.service.getAdvancedPlan(request.user.id, salonId);
        return reply.send({ success: true, data: result });
    }

    async overrideAssignment(request: FastifyRequest, reply: FastifyReply) {
        if (!request.user) throw new ApiError(401, 'Authentication required');
        const { salonId, entryId, staffId, reason } = z.object({
            salonId: z.string().uuid(), entryId: z.string().uuid(), staffId: z.string().uuid().nullable(), reason: z.string().min(5).max(500),
        }).parse(request.body);
        const result = await this.service.overrideAssignment(request.user.id, salonId, entryId, staffId, reason);
        return reply.send({ success: true, data: result });
    }

    async reportOverrun(request: FastifyRequest, reply: FastifyReply) {
        if (!request.user) throw new ApiError(401, 'Authentication required');
        const { salonId, entryId, actualDurationMinutes } = z.object({
            salonId: z.string().uuid(), entryId: z.string().uuid(), actualDurationMinutes: z.number().int().min(1).max(1440),
        }).parse(request.body);
        const result = await this.service.reportServiceOverrun(request.user.id, salonId, entryId, actualDurationMinutes);
        return reply.send({ success: true, data: result });
    }

    async getClosingRequests(request: FastifyRequest, reply: FastifyReply) {
        if (!request.user) throw new ApiError(401, 'Authentication required');
        const { salonId } = z.object({ salonId: z.string().uuid() }).parse(request.query);
        const result = await this.service.getClosingRequests(request.user.id, salonId);
        return reply.send({ success: true, data: result });
    }

    async decideClosingRequest(request: FastifyRequest, reply: FastifyReply) {
        if (!request.user) throw new ApiError(401, 'Authentication required');
        const { requestId } = z.object({ requestId: z.string().uuid() }).parse(request.params);
        const { salonId, approved, note } = z.object({ salonId: z.string().uuid(), approved: z.boolean(), note: z.string().max(500).optional() }).parse(request.body);
        const result = await this.service.decideClosingRequest(request.user.id, salonId, requestId, approved, note);
        return reply.send({ success: true, data: result });
    }

    async leave(request: FastifyRequest, reply: FastifyReply) {
        if (!request.user) throw new ApiError(401, 'Authentication required');
        const { entryId } = z.object({ entryId: z.string().uuid() }).parse(request.params);
        const entry = await this.service.getEntry(entryId);
        if (!entry || entry.userId !== request.user.id) throw new ApiError(403, 'Queue entry does not belong to this account');
        await this.service.leaveQueue(entryId);
        return reply.send({ success: true });
    }
}
