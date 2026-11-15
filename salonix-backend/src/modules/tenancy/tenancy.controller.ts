import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../shared/errors/ApiError.js';
import { TenancyService } from './tenancy.service.js';
import {
  createSalonApplicationSchema,
  reviewSalonApplicationSchema,
} from './tenancy.validation.js';

export class TenancyController {
  constructor(private readonly service: TenancyService) {}

  async createSalonApplication(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) throw new ApiError(401, 'Authentication required');
    this.assertSalonAccount(request);
    const input = createSalonApplicationSchema.parse(request.body);
    const result = await this.service.createOrganizationForOwner(request.user.id, input);
    return reply.status(201).send({ success: true, data: result });
  }

  async updateApplication(request: FastifyRequest) {
    if (!request.user) throw new ApiError(401, 'Authentication required');
    this.assertSalonAccount(request);
    const salonId = z.string().uuid().parse(
      (request.params as Record<string, unknown>).salonId
    );
    const input = createSalonApplicationSchema.parse(request.body);
    const application = await this.service.updateApplication(request.user.id, salonId, input);
    return { success: true, data: application };
  }

  async getMyApplications(request: FastifyRequest) {
    if (!request.user) throw new ApiError(401, 'Authentication required');
    this.assertSalonAccount(request);
    const applications = await this.service.getMyApplications(request.user.id);
    return { success: true, data: applications };
  }

  async getMySalons(request: FastifyRequest) {
    if (!request.user) throw new ApiError(401, 'Authentication required');
    this.assertSalonAccount(request);
    const salons = await this.service.getMySalons(request.user.id);
    return { success: true, data: salons };
  }

  async getApplicationsForReview(request: FastifyRequest) {
    this.assertAdmin(request);
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      offset: z.coerce.number().int().min(0).default(0),
      status: z.enum(['PENDING', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED']).optional(),
    }).parse(request.query);
    const applications = await this.service.getApplicationsForReview(query);
    return { success: true, data: applications };
  }

  async reviewApplication(request: FastifyRequest) {
    this.assertAdmin(request);
    const adminAccountId = request.user?.id;
    if (!adminAccountId) throw new ApiError(401, 'Authentication required');
    const salonId = z.string().uuid().parse(
      (request.params as Record<string, unknown>).salonId
    );
    const review = reviewSalonApplicationSchema.parse(request.body);
    const application = await this.service.reviewApplication(
      adminAccountId,
      salonId,
      review
    );
    return { success: true, data: application };
  }

  private assertSalonAccount(request: FastifyRequest) {
    if (request.user?.account_type !== 'SALON') {
      throw new ApiError(403, 'A salon account is required');
    }
    if (!request.user.phone_verified_at) {
      throw new ApiError(403, 'A verified phone number is required');
    }
  }

  private assertAdmin(request: FastifyRequest) {
    if (
      !request.user ||
      request.user.account_type !== 'ADMIN' ||
      !request.user.is_super_admin
    ) {
      throw new ApiError(403, 'Platform administrator access is required');
    }
  }
}
