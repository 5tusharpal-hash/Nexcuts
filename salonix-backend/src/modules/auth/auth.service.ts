import bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { UserRepository } from './auth.repository.js';
import type {
  AccountType,
  AuthSession,
  AuthenticatedUser,
  GoogleLoginInput,
  GoogleLoginResult,
  LoginInput,
  OtpRequestResponse,
  RegisterInput,
  User,
} from './auth.types.js';
import { AuthOtpService } from './auth-otp.service.js';
import { GoogleIdentityService } from './google-identity.service.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import { env } from '../../config/env.js';
import { AuthSessionBlacklist } from './auth-session-blacklist.js';

const SALT_ROUNDS = 12;
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const SESSION_TTL_SECONDS = 90 * 24 * 60 * 60;
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JWT_ISSUER = 'salonix-api';
const JWT_AUDIENCE = 'salonix-frontend';
const dummyPasswordHash = bcrypt.hash(randomBytes(32).toString('hex'), SALT_ROUNDS);

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function safeUser(user: User): Omit<User, 'password_hash'> {
  const { password_hash: _passwordHash, ...publicUser } = user;
  return publicUser;
}

export class AuthService {
  private readonly userRepo = new UserRepository();
  private readonly otpService = new AuthOtpService();
  private readonly googleIdentity = new GoogleIdentityService();
  private readonly sessionBlacklist = new AuthSessionBlacklist();

  async register(data: RegisterInput, ipAddress: string): Promise<OtpRequestResponse> {
    await this.otpService.enforceIdentifierRequestLimit(
      'phone-verification',
      'phone',
      data.phone_number,
      ipAddress
    );

    let user = await this.userRepo.findByPhone(data.phone_number, data.account_type);
    if (!user) {
      const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);
      try {
        user = await this.userRepo.createPending({
          accountType: data.account_type,
          email: data.email,
          passwordHash,
          fullName: data.full_name,
          phoneNumber: data.phone_number,
          preferredLanguage: data.preferred_language ?? 'en',
        });
      } catch (error) {
        if (isUniqueViolation(error)) return { verificationRequired: true };
        throw error;
      }
    }

    if (user.status !== 'PENDING' || user.phone_verified_at) {
      return { verificationRequired: true };
    }

    const developmentOtp = await this.otpService.requestOtp(
      'phone-verification',
      'phone',
      user.phone_number,
      user.id
    );
    return { verificationRequired: true, developmentOtp };
  }

  async requestPhoneVerification(
    phoneNumber: string,
    accountType: AccountType,
    ipAddress: string
  ): Promise<OtpRequestResponse> {
    await this.otpService.enforceIdentifierRequestLimit(
      'phone-verification',
      'phone',
      phoneNumber,
      ipAddress
    );
    const user = await this.userRepo.findByPhone(phoneNumber, accountType);
    if (!user || user.phone_verified_at || !['PENDING', 'ACTIVE'].includes(user.status)) {
      return { verificationRequired: true };
    }

    const developmentOtp = await this.otpService.requestOtp(
      'phone-verification',
      'phone',
      user.phone_number,
      user.id
    );
    return { verificationRequired: true, developmentOtp };
  }

  async verifyPhone(
    phoneNumber: string,
    accountType: AccountType,
    code: string,
    ipAddress: string
  ): Promise<AuthSession> {
    await this.otpService.enforceRateLimit('phone-confirm:ip', ipAddress, 30, 60 * 60);
    await this.otpService.enforceRateLimit('phone-confirm:phone', phoneNumber, 10, 60 * 60);
    const user = await this.userRepo.findByPhone(phoneNumber, accountType);
    if (!user || !['PENDING', 'ACTIVE'].includes(user.status)) {
      throw new ApiError(400, 'Verification code is invalid or expired');
    }
    if (user.phone_verified_at) {
      throw new ApiError(400, 'Phone number is already verified');
    }
    await this.otpService.verifyOtp(
      'phone-verification',
      'phone',
      user.phone_number,
      user.id,
      code,
      ipAddress
    );
    await this.userRepo.markPhoneVerified(user.id, user.phone_number);

    const verifiedUser = await this.userRepo.findById(user.id);
    if (!verifiedUser || verifiedUser.status !== 'ACTIVE') {
      throw new ApiError(403, 'This account cannot be activated');
    }
    return this.generateSession(verifiedUser);
  }

  async login(
    data: LoginInput,
    ipAddress: string
  ): Promise<AuthSession> {
    await this.otpService.enforceRateLimit(`login:ip`, ipAddress, 20, 15 * 60);
    await this.otpService.enforceRateLimit(`login:identifier`, data.identifier, 10, 15 * 60);

    const user = await this.userRepo.findByIdentifier(data.identifier, data.account_type);
    const hash = user?.password_hash ?? (await dummyPasswordHash);
    const passwordMatches = await bcrypt.compare(data.password, hash);
    const identifierVerified =
      user?.phone_number === data.identifier
        ? user.phone_verified_at !== null
        : user?.email === data.identifier && user.email_verified_at !== null;

    if (!user || !passwordMatches || !identifierVerified || user.status !== 'ACTIVE') {
      throw new ApiError(401, 'Invalid identifier or password');
    }

    return this.generateSession(user);
  }

  async loginWithGoogle(
    data: GoogleLoginInput,
    ipAddress: string
  ): Promise<GoogleLoginResult> {
    await this.otpService.enforceRateLimit('google-login:ip', ipAddress, 20, 15 * 60);
    const identity = await this.googleIdentity.verifyIdToken(data.id_token);
    await this.otpService.enforceRateLimit(
      'google-login:email',
      `${data.account_type}:${identity.email}`,
      10,
      15 * 60
    );
    const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), SALT_ROUNDS);
    const account = await this.userRepo.loginWithGoogle({
      accountType: data.account_type,
      subject: identity.subject,
      email: identity.email,
      fullName: identity.fullName,
      phoneNumber: data.phone_number,
      preferredLanguage: data.preferred_language ?? 'en',
      passwordHash,
    });
    if (!account) return { phoneRequired: true };

    if (account.phoneVerificationRequired) {
      await this.otpService.enforceIdentifierRequestLimit(
        'phone-verification',
        'phone',
        account.user.phone_number,
        ipAddress
      );
      const developmentOtp = await this.otpService.requestOtp(
        'phone-verification',
        'phone',
        account.user.phone_number,
        account.user.id
      );
      return {
        verificationRequired: true,
        phoneNumber: account.user.phone_number,
        developmentOtp,
      };
    }
    if (account.user.status !== 'ACTIVE') {
      throw new ApiError(403, 'This account cannot sign in');
    }
    return this.generateSession(account.user);
  }

  async setEmail(
    accountId: string,
    email: string,
    ipAddress: string
  ): Promise<OtpRequestResponse & { emailVerified: boolean }> {
    await this.otpService.enforceIdentifierRequestLimit(
      'email-verification',
      'email',
      email,
      ipAddress
    );
    let emailVerified: boolean;
    try {
      emailVerified = await this.userRepo.setEmail(accountId, email);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(409, 'This email is already associated with another account');
      }
      throw error;
    }
    if (emailVerified) return { verificationRequired: false, emailVerified: true };

    const developmentOtp = await this.otpService.requestOtp(
      'email-verification',
      'email',
      email,
      accountId
    );
    return { verificationRequired: true, emailVerified: false, developmentOtp };
  }

  async setPhone(
    accountId: string,
    phoneNumber: string,
    ipAddress: string
  ): Promise<OtpRequestResponse & { phoneVerified: boolean }> {
    await this.otpService.enforceIdentifierRequestLimit(
      'phone-verification',
      'phone',
      phoneNumber,
      ipAddress
    );
    let phoneVerified: boolean;
    try {
      phoneVerified = await this.userRepo.setPhone(accountId, phoneNumber);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(409, 'This phone number is already associated with another account');
      }
      throw error;
    }
    if (phoneVerified) return { verificationRequired: false, phoneVerified: true };

    const developmentOtp = await this.otpService.requestOtp(
      'phone-verification',
      'phone',
      phoneNumber,
      accountId
    );
    return { verificationRequired: true, phoneVerified: false, developmentOtp };
  }

  async resendEmailVerification(
    accountId: string,
    ipAddress: string
  ): Promise<OtpRequestResponse> {
    const user = await this.userRepo.findById(accountId);
    if (!user || user.status !== 'ACTIVE' || !user.email || user.email_verified_at) {
      return { verificationRequired: true };
    }

    await this.otpService.enforceIdentifierRequestLimit(
      'email-verification',
      'email',
      user.email,
      ipAddress
    );
    const developmentOtp = await this.otpService.requestOtp(
      'email-verification',
      'email',
      user.email,
      user.id
    );
    return { verificationRequired: true, developmentOtp };
  }

  async verifyEmail(accountId: string, code: string, ipAddress: string): Promise<void> {
    const user = await this.userRepo.findById(accountId);
    if (!user || user.status !== 'ACTIVE' || !user.email) {
      throw new ApiError(400, 'Verification code is invalid or expired');
    }
    if (user.email_verified_at) return;

    await this.otpService.verifyOtp(
      'email-verification',
      'email',
      user.email,
      user.id,
      code,
      ipAddress
    );
    await this.userRepo.markEmailVerified(user.id, user.email);
  }

  async requestPasswordReset(
    identifier: string,
    accountType: AccountType,
    ipAddress: string
  ): Promise<OtpRequestResponse> {
    const channel = identifier.startsWith('+') ? 'phone' : 'email';
    await this.otpService.enforceIdentifierRequestLimit(
      'password-reset',
      channel,
      identifier,
      ipAddress
    );
    const user = await this.userRepo.findByIdentifier(identifier, accountType);
    const identifierVerified =
      channel === 'phone'
        ? user?.phone_verified_at !== null
        : user?.email_verified_at !== null;
    if (!user || user.status !== 'ACTIVE' || !identifierVerified) {
      return { verificationRequired: true };
    }

    const developmentOtp = await this.otpService.requestOtp(
      'password-reset',
      channel,
      identifier,
      user.id
    );
    return { verificationRequired: true, developmentOtp };
  }

  async resetPassword(
    identifier: string,
    accountType: AccountType,
    code: string,
    newPassword: string,
    ipAddress: string
  ): Promise<void> {
    const channel = identifier.startsWith('+') ? 'phone' : 'email';
    await this.otpService.enforceRateLimit('password-reset:confirm:ip', ipAddress, 30, 60 * 60);
    await this.otpService.enforceRateLimit(
      'password-reset:confirm:identifier',
      identifier,
      10,
      60 * 60
    );
    const user = await this.userRepo.findByIdentifier(identifier, accountType);
    const identifierVerified =
      channel === 'phone'
        ? user?.phone_verified_at !== null
        : user?.email_verified_at !== null;
    if (!user || user.status !== 'ACTIVE' || !identifierVerified) {
      throw new ApiError(400, 'Verification code is invalid or expired');
    }

    await this.otpService.verifyOtp(
      'password-reset',
      channel,
      identifier,
      user.id,
      code,
      ipAddress
    );
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await this.userRepo.setPasswordAndRevokeSessions(user.id, passwordHash);
  }

  async changePassword(
    accountId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    const user = await this.userRepo.findById(accountId);
    if (!user || user.status !== 'ACTIVE') {
      throw new ApiError(403, 'This account cannot change its password');
    }
    if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
      throw new ApiError(400, 'Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await this.userRepo.setPasswordAndRevokeSessions(user.id, passwordHash);
  }

  async verifyToken(token: string): Promise<AuthenticatedUser> {
    let payload: string | jwt.JwtPayload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
    } catch {
      throw new ApiError(401, 'Invalid or expired token');
    }

    if (
      typeof payload === 'string' ||
      typeof payload.sub !== 'string' ||
      typeof payload.jti !== 'string' ||
      !SESSION_ID_PATTERN.test(payload.jti)
    ) {
      throw new ApiError(401, 'Invalid or expired token');
    }

    if (await this.sessionBlacklist.isRevoked(payload.jti)) {
      throw new ApiError(401, 'Session is no longer active');
    }

    const sessionUser = await this.userRepo.findActiveSessionUser(
      payload.sub,
      createHash('sha256').update(token).digest('hex')
    );
    if (!sessionUser) throw new ApiError(401, 'Session is no longer active');
    return sessionUser;
  }

  async refresh(refreshToken: string): Promise<{ token: string; refreshToken: string }> {
    const [sessionId, secret, ...extraParts] = refreshToken.split('.');
    if (!sessionId || !secret || extraParts.length > 0 || !SESSION_ID_PATTERN.test(sessionId)) {
      throw new ApiError(401, 'Invalid or expired refresh token');
    }

    const currentRefreshHash = this.hashToken(refreshToken);
    const session = await this.userRepo.findRefreshSession(sessionId, currentRefreshHash);
    if (!session) throw new ApiError(401, 'Invalid or expired refresh token');
    if (await this.sessionBlacklist.isRevoked(sessionId)) {
      throw new ApiError(401, 'Session is no longer active');
    }

    const token = this.generateAccessToken(session.accountId, sessionId);
    const nextRefreshToken = this.createRefreshToken(sessionId);
    const nextRefreshExpiry = new Date(
      Math.min(
        Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000,
        session.sessionExpiresAt.getTime()
      )
    );
    const result = await this.userRepo.rotateRefreshSession({
      sessionId,
      currentRefreshHash,
      nextRefreshHash: this.hashToken(nextRefreshToken),
      nextRefreshExpiry,
      accessTokenHash: this.hashToken(token),
    });

    if (result === 'reused') {
      await this.sessionBlacklist.revoke(sessionId, session.sessionExpiresAt);
      throw new ApiError(401, 'Refresh token reuse detected. Please sign in again');
    }
    if (result !== 'rotated') {
      throw new ApiError(401, 'Invalid or expired refresh token');
    }

    return { token, refreshToken: nextRefreshToken };
  }

  async logout(refreshToken: string): Promise<void> {
    const [sessionId, secret, ...extraParts] = refreshToken.split('.');
    if (!sessionId || !secret || extraParts.length > 0 || !SESSION_ID_PATTERN.test(sessionId)) {
      return;
    }
    const sessionExpiresAt = await this.userRepo.revokeRefreshSession(
      sessionId,
      this.hashToken(refreshToken)
    );
    if (sessionExpiresAt) {
      await this.sessionBlacklist.revoke(sessionId, sessionExpiresAt);
    }
  }

  toSafeUser(user: User): Omit<User, 'password_hash'> {
    return safeUser(user);
  }

  private async generateSession(user: User): Promise<AuthSession> {
    const sessionId = randomUUID();
    const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
    const refreshToken = this.createRefreshToken(sessionId);
    const refreshExpiresAt = new Date(
      Math.min(
        Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000,
        sessionExpiresAt.getTime()
      )
    );
    const token = this.generateAccessToken(user.id, sessionId);
    await this.userRepo.createSession({
      sessionId,
      accountId: user.id,
      accessTokenHash: this.hashToken(token),
      sessionExpiresAt,
      refreshTokenHash: this.hashToken(refreshToken),
      refreshExpiresAt,
    });
    return { user, token, refreshToken };
  }

  private generateAccessToken(accountId: string, sessionId: string): string {
    return jwt.sign({}, env.JWT_SECRET, {
      algorithm: 'HS256',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      subject: accountId,
      jwtid: sessionId,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
  }

  private createRefreshToken(sessionId: string): string {
    return `${sessionId}.${randomBytes(32).toString('base64url')}`;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
