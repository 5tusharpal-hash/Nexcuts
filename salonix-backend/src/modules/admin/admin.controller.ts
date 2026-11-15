import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../shared/errors/ApiError.js';
import { AdminService } from './admin.service.js';
import {
  adminAccountListSchema,
  adminAccountStatusSchema,
  adminAddonStatusSchema,
  adminAddonUpdateSchema,
  adminAuditListSchema,
  adminEntitlementRevokeSchema,
  adminEntitlementUpdateSchema,
  adminPasswordResetSchema,
  adminPlanUpdateSchema,
  adminReasonSchema,
  salonProfileChangeListSchema,
  salonProfileChangeReviewSchema,
  adminSalonListSchema,
  paginationSchema,
  adminSubscriptionUpdateSchema,
  salonProfileChangeRequestSchema,
} from './admin.validation.js';

export class AdminController {
  constructor(private readonly service: AdminService) {}

  async getDashboard(request: FastifyRequest) {
    this.requireAdmin(request);
    return { success: true, data: await this.service.getDashboard() };
  }

  async listSalons(request: FastifyRequest) {
    this.requireAdmin(request);
    const query = adminSalonListSchema.parse(request.query);
    return { success: true, data: await this.service.listSalons(query) };
  }

  async getSalonDetails(request: FastifyRequest) {
    this.requireAdmin(request);
    const result = await this.service.getSalonDetails(this.getParam(request, 'salonId'));
    if (!result) throw new ApiError(404, 'Salon was not found');
    return { success: true, data: result };
  }

  async listSalonActivity(request: FastifyRequest) {
    this.requireAdmin(request);
    const query = adminAuditListSchema.parse(request.query);
    return {
      success: true,
      data: await this.service.listSalonActivity(this.getParam(request, 'salonId'), query),
    };
  }

  async listSalonProfileChangeRequests(request: FastifyRequest) {
    this.requireAdmin(request);
    const query = salonProfileChangeListSchema.parse(request.query);
    return {
      success: true,
      data: await this.service.listSalonProfileChangeRequests(query),
    };
  }

  async reviewSalonProfileChangeRequest(request: FastifyRequest) {
    const context = this.getContext(request);
    const input = salonProfileChangeReviewSchema.parse(request.body);
    return {
      success: true,
      data: await this.service.reviewSalonProfileChangeRequest(
        this.getParam(request, 'requestId'),
        context,
        input
      ),
    };
  }

  async listRecentActivity(request: FastifyRequest) {
    this.requireAdmin(request);
    const query = adminAuditListSchema.parse(request.query);
    return { success: true, data: await this.service.listRecentActivity(query) };
  }

  async listAccounts(request: FastifyRequest) {
    this.requireAdmin(request);
    const query = adminAccountListSchema.parse(request.query);
    return { success: true, data: await this.service.listAccounts(query) };
  }

  async updateAccountStatus(request: FastifyRequest) {
    const context = this.getContext(request);
    const input = adminAccountStatusSchema.parse(request.body);
    return {
      success: true,
      data: await this.service.updateAccountStatus(
        this.getParam(request, 'accountId'),
        context,
        input
      ),
    };
  }

  async requestAccountPasswordReset(request: FastifyRequest) {
    const context = this.getContext(request);
    const { reason } = adminPasswordResetSchema.parse(request.body);
    return {
      success: true,
      data: await this.service.requestAccountPasswordReset(
        this.getParam(request, 'accountId'),
        context,
        reason,
        request.ip
      ),
    };
  }

  async revokeAccountSessions(request: FastifyRequest) {
    const context = this.getContext(request);
    const { reason } = adminReasonSchema.parse(request.body);
    return {
      success: true,
      data: await this.service.revokeAccountSessions(
        this.getParam(request, 'accountId'),
        context,
        reason
      ),
    };
  }

  async listPlans(request: FastifyRequest) {
    this.requireAdmin(request);
    return { success: true, data: await this.service.listPlans() };
  }

  async updatePlan(request: FastifyRequest) {
    const context = this.getContext(request);
    const input = adminPlanUpdateSchema.parse(request.body);
    return {
      success: true,
      data: await this.service.updatePlan(this.getParam(request, 'planId'), context, input),
    };
  }

  async listAddons(request: FastifyRequest) {
    this.requireAdmin(request);
    return { success: true, data: await this.service.listAddons() };
  }

  async updateAddon(request: FastifyRequest) {
    const context = this.getContext(request);
    const input = adminAddonUpdateSchema.parse(request.body);
    return {
      success: true,
      data: await this.service.updateAddon(this.getParam(request, 'addonId'), context, input),
    };
  }

  async assignPlan(request: FastifyRequest) {
    const context = this.getContext(request);
    const input = adminSubscriptionUpdateSchema.parse(request.body);
    return {
      success: true,
      data: await this.service.assignPlan(this.getParam(request, 'salonId'), context, input),
    };
  }

  async setAddon(request: FastifyRequest) {
    const context = this.getContext(request);
    const { status, reason } = adminAddonStatusSchema.parse(request.body);
    return {
      success: true,
      data: await this.service.setAddon(
        this.getParam(request, 'salonId'),
        this.getParam(request, 'addonId'),
        context,
        reason,
        status === 'ACTIVE'
      ),
    };
  }

  async setEntitlement(request: FastifyRequest) {
    const context = this.getContext(request);
    const input = adminEntitlementUpdateSchema.parse(request.body);
    return {
      success: true,
      data: await this.service.setEntitlement(this.getParam(request, 'salonId'), context, input),
    };
  }

  async revokeEntitlement(request: FastifyRequest) {
    const context = this.getContext(request);
    const { reason } = adminEntitlementRevokeSchema.parse(request.body);
    const featureKey = z.string().trim().min(1).max(100).regex(/^[a-z][a-z0-9_.-]*$/)
      .parse((request.params as Record<string, unknown>).featureKey);
    return {
      success: true,
      data: await this.service.revokeEntitlement(
        this.getParam(request, 'salonId'),
        featureKey,
        context,
        reason
      ),
    };
  }

  async getMasterSettings(request: FastifyRequest) {
    this.requireAdmin(request);
    return { success: true, data: await this.service.getMasterSettings() };
  }

  private getParam(request: FastifyRequest, name: string) {
    return z.string().uuid().parse((request.params as Record<string, unknown>)[name]);
  }

  private getContext(request: FastifyRequest) {
    const user = this.requireAdmin(request);
    const userAgent = request.headers['user-agent'];
    return {
      actorAccountId: user.id,
      requestId: request.id,
      ipAddress: request.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
    };
  }

  private requireAdmin(request: FastifyRequest) {
    const user = request.user;
    if (!user) throw new ApiError(401, 'Authentication required');
    if (user.account_type !== 'ADMIN' || !user.is_super_admin) {
      throw new ApiError(403, 'Platform administrator access is required');
    }
    return user;
  }
}

export class SalonProfileChangeController {
  constructor(private readonly service: AdminService) {}

  async listMine(request: FastifyRequest) {
    const accountId = this.requireSalonOwner(request);
    const query = paginationSchema.parse(request.query);
    return {
      success: true,
      data: await this.service.listSalonProfileChangesForOwner(
        this.getSalonId(request),
        accountId,
        query
      ),
    };
  }

  async requestChange(request: FastifyRequest, reply: FastifyReply) {
    const accountId = this.requireSalonOwner(request);
    const input = salonProfileChangeRequestSchema.parse(request.body);
    const result = await this.service.requestSalonProfileChange(
      this.getSalonId(request),
      accountId,
      input
    );
    return reply.status(201).send({ success: true, data: result });
  }

  private getSalonId(request: FastifyRequest) {
    return z.string().uuid().parse((request.params as Record<string, unknown>).salonId);
  }

  private requireSalonOwner(request: FastifyRequest) {
    if (!request.user) throw new ApiError(401, 'Authentication required');
    if (request.user.account_type !== 'SALON') {
      throw new ApiError(403, 'A salon account is required');
    }
    if (!request.user.phone_verified_at) {
      throw new ApiError(403, 'A verified phone number is required');
    }
    return request.user.id;
  }
}
