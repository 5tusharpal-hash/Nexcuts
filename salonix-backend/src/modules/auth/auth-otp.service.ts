import { createHash, createHmac, randomInt } from 'node:crypto';
import { EmailIntegration } from '../../integrations/email/email.integration.js';
import { WhatsAppIntegration } from '../../integrations/whatsapp/whatsapp.integration.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import { logger } from '../../bootstrap/logger.js';
import { RedisAuthOtpStore } from './auth-otp.store.js';
import type { AuthOtpStore } from './auth-otp.store.js';

export type OtpPurpose =
  | 'phone-verification'
  | 'email-verification'
  | 'password-reset'
  | 'salon-staff-verification'
  | 'pos-wallet-redemption';
export type OtpChannel = 'phone' | 'email';

const OTP_TTL_SECONDS = 5 * 60;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_VERIFY_ATTEMPTS = 5;

export class AuthOtpService {
  private readonly whatsapp = new WhatsAppIntegration();
  private readonly email = new EmailIntegration();

  constructor(private readonly store: AuthOtpStore = new RedisAuthOtpStore()) {}

  async requestOtp(
    purpose: OtpPurpose,
    channel: OtpChannel,
    recipient: string,
    accountId: string,
    context?: string
  ): Promise<string | undefined> {
    const key = this.otpKey(purpose, channel, recipient, accountId, context);
    const cooldownKey = `${key}:cooldown`;
    if (!(await this.store.reserveCooldown(cooldownKey, RESEND_COOLDOWN_SECONDS))) {
      throw new ApiError(429, 'Please wait before requesting another verification code');
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeHash = this.hashOtp(purpose, channel, recipient, accountId, code, context);
    await this.store.saveOtp(key, codeHash, OTP_TTL_SECONDS);

    try {
      if (channel === 'phone') {
        await this.whatsapp.sendOtp({ to: recipient, code });
      } else {
        await this.email.sendOtp(recipient, code);
      }
    } catch (error) {
      await this.store.deleteOtp(key);
      logger.error({ error, channel }, 'OTP delivery failed');
      throw new ApiError(503, 'Verification message could not be sent. Please try again later');
    }

    return env.AUTH_OTP_EXPOSE_OTP ? code : undefined;
  }

  async verifyOtp(
    purpose: OtpPurpose,
    channel: OtpChannel,
    recipient: string,
    accountId: string,
    code: string,
    ipAddress: string,
    context?: string
  ): Promise<void> {
    await this.enforceRateLimit(`verify:${purpose}:ip`, ipAddress, 30, 60 * 60);
    await this.enforceRateLimit(`verify:${purpose}:${channel}`, recipient, 10, 60 * 60);

    const key = this.otpKey(purpose, channel, recipient, accountId, context);
    const expectedHash = this.hashOtp(purpose, channel, recipient, accountId, code, context);
    const result = await this.store.verifyOtp(
      key,
      expectedHash,
      OTP_TTL_SECONDS,
      MAX_VERIFY_ATTEMPTS
    );
    if (result === 'verified') return;
    if (result === 'locked') {
      throw new ApiError(429, 'Too many incorrect verification attempts. Request a new code');
    }
    throw new ApiError(400, 'Verification code is invalid or expired');
  }

  async enforceIdentifierRequestLimit(
    purpose: OtpPurpose,
    channel: OtpChannel,
    recipient: string,
    ipAddress: string
  ): Promise<void> {
    await this.enforceRateLimit(`request:${purpose}:ip`, ipAddress, 10, 60 * 60);
    await this.enforceRateLimit(`request:${purpose}:${channel}`, recipient, 5, 60 * 60);
  }

  async enforceRateLimit(
    bucket: string,
    value: string,
    maximum: number,
    windowSeconds: number
  ): Promise<void> {
    const digest = createHash('sha256').update(value).digest('hex');
    const count = await this.store.incrementRateLimit(
      `salonix:auth:${env.NODE_ENV}:rate:${bucket}:${digest}`,
      windowSeconds
    );
    if (count > maximum) {
      throw new ApiError(429, 'Too many requests. Please try again later');
    }
  }

  private otpKey(
    purpose: OtpPurpose,
    channel: OtpChannel,
    recipient: string,
    accountId: string,
    context?: string
  ): string {
    const identity = context
      ? `${accountId}:${recipient}:${context}`
      : `${accountId}:${recipient}`;
    const digest = createHash('sha256')
      .update(identity)
      .digest('hex');
    return `salonix:auth:${env.NODE_ENV}:otp:${purpose}:${channel}:${digest}`;
  }

  private hashOtp(
    purpose: OtpPurpose,
    channel: OtpChannel,
    recipient: string,
    accountId: string,
    code: string,
    context?: string
  ): string {
    const contextSuffix = context ? `:${context}` : '';
    return createHmac('sha256', env.AUTH_OTP_HASH_SECRET)
      .update(`${purpose}:${channel}:${accountId}:${recipient}:${code}${contextSuffix}`)
      .digest('hex');
  }
}
