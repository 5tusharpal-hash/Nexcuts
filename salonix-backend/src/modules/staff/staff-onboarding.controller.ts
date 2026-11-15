import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  emailSchema,
  fullNameSchema,
  otpSchema,
  passwordSchema,
  phoneNumberSchema,
} from '../auth/auth.validation.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import { requireRouteParam } from '../../shared/utils/request.js';
import { StaffOnboardingService } from './staff-onboarding.service.js';

const phoneVerificationSchema = z.object({
  phone_number: phoneNumberSchema,
});

const createStaffSchema = z.object({
  phone_number: phoneNumberSchema,
  code: otpSchema,
  full_name: fullNameSchema.optional(),
  email: emailSchema.optional(),
  password: passwordSchema.optional(),
  expertise: z.array(z.string().uuid()).max(100).default([]),
  commission_rate: z.number().min(0).max(100).default(0),
});

export class StaffOnboardingController {
  constructor(private readonly service: StaffOnboardingService) {}

  async requestPhoneVerification(request: FastifyRequest, reply: FastifyReply) {
    const ownerAccountId = this.requireSalonOwnerAccount(request);
    const salonId = requireRouteParam(request.params, 'salonId');
    const input = phoneVerificationSchema.parse(request.body);
    const result = await this.service.requestPhoneVerification(
      ownerAccountId,
      salonId,
      input,
      request.ip
    );
    return reply.status(202).send({
      success: true,
      data: {
        verificationRequired: result.verificationRequired,
        ...(result.developmentOtp ? { developmentOtp: result.developmentOtp } : {}),
      },
    });
  }

  async createOrLinkStaff(request: FastifyRequest, reply: FastifyReply) {
    const ownerAccountId = this.requireSalonOwnerAccount(request);
    const salonId = requireRouteParam(request.params, 'salonId');
    const input = createStaffSchema.parse(request.body);
    const result = await this.service.createOrLinkStaffAccount(
      ownerAccountId,
      salonId,
      input,
      request.ip
    );
    return reply
      .status(result.accountLink === 'CREATED' ? 201 : 200)
      .send({ success: true, data: result });
  }

  private requireSalonOwnerAccount(request: FastifyRequest): string {
    if (!request.user) throw new ApiError(401, 'Authentication required');
    if (request.user.account_type !== 'SALON' || !request.user.phone_verified_at) {
      throw new ApiError(403, 'A phone-verified salon account is required');
    }
    return request.user.id;
  }
}
