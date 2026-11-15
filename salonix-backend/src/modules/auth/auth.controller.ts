import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthService } from './auth.service.js';
import type { User } from './auth.types.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import { env } from '../../config/env.js';
import {
  accountTypeSchema,
  emailSchema,
  fullNameSchema,
  googleLoginSchema,
  identifierSchema,
  loginPasswordSchema,
  otpSchema,
  passwordSchema,
  phoneNumberSchema,
  selfServiceAccountTypeSchema,
} from './auth.validation.js';


const RegisterSchema = z.object({
  account_type: selfServiceAccountTypeSchema.optional(),
  email: emailSchema.optional(),
  password: passwordSchema,
  full_name: fullNameSchema,
  phone_number: phoneNumberSchema,
  preferred_language: z.string().trim().min(2).max(10).optional(),
});

const LoginSchema = z.object({
  account_type: accountTypeSchema.optional(),
  identifier: identifierSchema,
  password: loginPasswordSchema,
});

const PhoneVerificationRequestSchema = z.object({
  account_type: accountTypeSchema.optional(),
  phone_number: phoneNumberSchema,
});
const PhoneVerificationSchema = PhoneVerificationRequestSchema.extend({ code: otpSchema });
const PhoneUpdateSchema = PhoneVerificationRequestSchema;
const EmailUpdateSchema = z.object({ email: emailSchema });
const EmailVerificationSchema = z.object({ code: otpSchema });
const PasswordResetRequestSchema = z.object({
  account_type: accountTypeSchema.optional(),
  identifier: identifierSchema,
});
const PasswordResetSchema = PasswordResetRequestSchema.extend({
  code: otpSchema,
  new_password: passwordSchema,
});
const PasswordChangeSchema = z.object({
  current_password: loginPasswordSchema,
  new_password: passwordSchema,
});

const REFRESH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function getRefreshCookie(request: FastifyRequest): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (typeof cookieHeader !== 'string') return undefined;
  const prefix = `${env.AUTH_COOKIE_NAME}=`;
  const cookie = cookieHeader.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return cookie?.slice(prefix.length);
}

function serializeRefreshCookie(value: string, clear = false): string {
  const attributes = [
    `${env.AUTH_COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${clear ? 0 : REFRESH_COOKIE_MAX_AGE_SECONDS}`,
  ];
  if (env.NODE_ENV === 'production') attributes.push('Secure');
  if (env.AUTH_COOKIE_DOMAIN) attributes.push(`Domain=${env.AUTH_COOKIE_DOMAIN}`);
  if (clear) attributes.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  return attributes.join('; ');
}

function requireTrustedOrigin(request: FastifyRequest): void {
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || !env.CORS_ORIGINS.includes(origin)) {
    throw new ApiError(403, 'Request origin is not allowed');
  }
}

export class AuthController {
  private readonly authService = new AuthService();

  constructor(private readonly requireAccountType = false) {}

  async register(request: FastifyRequest, reply: FastifyReply) {
    const data = RegisterSchema.parse(request.body);
    const accountType = this.resolveAccountType(data.account_type);
    const result = await this.authService.register(
      { ...data, account_type: selfServiceAccountTypeSchema.parse(accountType) },
      request.ip
    );
    return reply.status(202).send({
      success: true,
      data: {
        message: 'If this phone can be registered, a verification code has been sent',
        verificationRequired: result.verificationRequired,
        ...(result.developmentOtp ? { developmentOtp: result.developmentOtp } : {}),
      },
    });
  }

  async requestPhoneVerification(request: FastifyRequest, reply: FastifyReply) {
    const { account_type, phone_number } = PhoneVerificationRequestSchema.parse(request.body);
    const result = await this.authService.requestPhoneVerification(
      phone_number,
      this.resolveAccountType(account_type),
      request.ip
    );
    return reply.status(202).send({
      success: true,
      data: {
        message: 'If verification is available, a code has been sent',
        verificationRequired: result.verificationRequired,
        ...(result.developmentOtp ? { developmentOtp: result.developmentOtp } : {}),
      },
    });
  }

  async verifyPhone(request: FastifyRequest, reply: FastifyReply) {
    const { account_type, phone_number, code } = PhoneVerificationSchema.parse(request.body);
    const result = await this.authService.verifyPhone(
      phone_number,
      this.resolveAccountType(account_type),
      code,
      request.ip
    );
    return this.sendAuthenticated(reply, result);
  }

  async login(request: FastifyRequest, reply: FastifyReply) {
    const data = LoginSchema.parse(request.body);
    const result = await this.authService.login(
      { ...data, account_type: this.resolveAccountType(data.account_type) },
      request.ip
    );
    return this.sendAuthenticated(reply, result);
  }

  async loginWithGoogle(request: FastifyRequest, reply: FastifyReply) {
    const data = googleLoginSchema.parse(request.body);
    const result = await this.authService.loginWithGoogle(data, request.ip);
    if ('phoneRequired' in result) {
      return reply.status(202).send({
        success: true,
        data: {
          phoneRequired: true,
          message: 'A verified phone number is required to finish account setup',
        },
      });
    }
    if ('verificationRequired' in result) {
      return reply.status(202).send({
        success: true,
        data: {
          verificationRequired: true,
          phoneNumber: result.phoneNumber,
          message: 'Verify your phone number to activate your account',
          ...(result.developmentOtp ? { developmentOtp: result.developmentOtp } : {}),
        },
      });
    }
    return this.sendAuthenticated(reply, result);
  }

  async refresh(request: FastifyRequest, reply: FastifyReply) {
    requireTrustedOrigin(request);
    const refreshToken = getRefreshCookie(request);
    if (!refreshToken) {
      reply.header('Set-Cookie', serializeRefreshCookie('', true));
      throw new ApiError(401, 'Refresh session is missing or expired');
    }

    try {
      const result = await this.authService.refresh(refreshToken);
      reply.header('Set-Cookie', serializeRefreshCookie(result.refreshToken));
      reply.header('Cache-Control', 'no-store');
      return reply.send({ success: true, data: { token: result.token } });
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 401) {
        reply.header('Set-Cookie', serializeRefreshCookie('', true));
      }
      throw error;
    }
  }

  async requestPasswordReset(request: FastifyRequest, reply: FastifyReply) {
    const { account_type, identifier } = PasswordResetRequestSchema.parse(request.body);
    const result = await this.authService.requestPasswordReset(
      identifier,
      this.resolveAccountType(account_type),
      request.ip
    );
    return reply.status(202).send({
      success: true,
      data: {
        message: 'If the verified account exists, a reset code has been sent',
        ...(result.developmentOtp ? { developmentOtp: result.developmentOtp } : {}),
      },
    });
  }

  async resetPassword(request: FastifyRequest, reply: FastifyReply) {
    const { account_type, identifier, code, new_password } =
      PasswordResetSchema.parse(request.body);
    await this.authService.resetPassword(
      identifier,
      this.resolveAccountType(account_type),
      code,
      new_password,
      request.ip
    );
    return reply.send({
      success: true,
      data: { message: 'Password reset successfully. Sign in with your new password' },
    });
  }

  async changePassword(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) throw new ApiError(401, 'Authentication required');
    const { current_password, new_password } = PasswordChangeSchema.parse(request.body);
    await this.authService.changePassword(request.user.id, current_password, new_password);
    return reply.send({
      success: true,
      data: { message: 'Password changed. Sign in again with the new password' },
    });
  }

  async setEmail(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) throw new ApiError(401, 'Authentication required');
    const { email } = EmailUpdateSchema.parse(request.body);
    const result = await this.authService.setEmail(request.user.id, email, request.ip);
    return reply.status(result.emailVerified ? 200 : 202).send({
      success: true,
      data: {
        emailVerified: result.emailVerified,
        verificationRequired: result.verificationRequired,
        ...(result.developmentOtp ? { developmentOtp: result.developmentOtp } : {}),
      },
    });
  }

  async setPhone(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) throw new ApiError(401, 'Authentication required');
    const { phone_number } = PhoneUpdateSchema.parse(request.body);
    const result = await this.authService.setPhone(request.user.id, phone_number, request.ip);
    return reply.status(result.phoneVerified ? 200 : 202).send({
      success: true,
      data: {
        phoneVerified: result.phoneVerified,
        verificationRequired: result.verificationRequired,
        ...(result.developmentOtp ? { developmentOtp: result.developmentOtp } : {}),
      },
    });
  }

  async resendEmailVerification(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) throw new ApiError(401, 'Authentication required');
    const result = await this.authService.resendEmailVerification(request.user.id, request.ip);
    return reply.status(202).send({
      success: true,
      data: {
        verificationRequired: result.verificationRequired,
        ...(result.developmentOtp ? { developmentOtp: result.developmentOtp } : {}),
      },
    });
  }

  async verifyEmail(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) throw new ApiError(401, 'Authentication required');
    const { code } = EmailVerificationSchema.parse(request.body);
    await this.authService.verifyEmail(request.user.id, code, request.ip);
    return reply.send({ success: true, data: { emailVerified: true } });
  }

  async logout(request: FastifyRequest, reply: FastifyReply) {
    requireTrustedOrigin(request);
    const refreshToken = getRefreshCookie(request);
    reply.header('Cache-Control', 'no-store');
    reply.header('Set-Cookie', serializeRefreshCookie('', true));
    if (refreshToken) await this.authService.logout(refreshToken);
    return reply.send({ success: true, data: { loggedOut: true } });
  }

  private sendAuthenticated(
    reply: FastifyReply,
    result: { user: User; token: string; refreshToken: string }
  ) {
    reply.header('Set-Cookie', serializeRefreshCookie(result.refreshToken));
    reply.header('Cache-Control', 'no-store');
    return reply.status(200).send({
      success: true,
      data: {
        user: this.authService.toSafeUser(result.user),
        token: result.token,
      },
    });
  }

  private resolveAccountType(accountType: string | undefined) {
    if (accountType) return accountTypeSchema.parse(accountType);
    if (this.requireAccountType) {
      throw new ApiError(400, 'account_type is required');
    }
    return 'CUSTOMER' as const;
  }
}
