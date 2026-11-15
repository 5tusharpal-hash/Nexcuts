import bcrypt from 'bcrypt';
import { AuthOtpService } from '../auth/auth-otp.service.js';
import { StaffOnboardingRepository } from './staff-onboarding.repository.js';
import type {
  CreateStaffAccountRequest,
  StaffPhoneVerificationRequest,
} from './staff-onboarding.types.js';

const SALT_ROUNDS = 12;

export class StaffOnboardingService {
  constructor(
    private readonly repository: StaffOnboardingRepository,
    private readonly otpService: AuthOtpService = new AuthOtpService()
  ) {}

  async requestPhoneVerification(
    ownerAccountId: string,
    salonId: string,
    data: StaffPhoneVerificationRequest,
    ipAddress: string
  ) {
    await this.repository.assertOwnerCanManageStaff(ownerAccountId, salonId);
    await this.otpService.enforceIdentifierRequestLimit(
      'salon-staff-verification',
      'phone',
      data.phone_number,
      ipAddress
    );
    const developmentOtp = await this.otpService.requestOtp(
      'salon-staff-verification',
      'phone',
      data.phone_number,
      `${ownerAccountId}:${salonId}`
    );
    return { verificationRequired: true, developmentOtp };
  }

  async createOrLinkStaffAccount(
    ownerAccountId: string,
    salonId: string,
    data: CreateStaffAccountRequest,
    ipAddress: string
  ) {
    await this.repository.assertOwnerCanManageStaff(ownerAccountId, salonId);
    await this.otpService.verifyOtp(
      'salon-staff-verification',
      'phone',
      data.phone_number,
      `${ownerAccountId}:${salonId}`,
      data.code,
      ipAddress
    );
    const passwordHash = data.password
      ? await bcrypt.hash(data.password, SALT_ROUNDS)
      : undefined;
    return this.repository.createOrLinkStaffAccount(
      ownerAccountId,
      salonId,
      data,
      passwordHash
    );
  }
}
