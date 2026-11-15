export type AccountType = 'CUSTOMER' | 'SALON' | 'PLATFORM' | 'ADMIN';

export interface User {
  id: string;
  account_type: AccountType;
  email: string | null;
  password_hash: string;
  full_name: string;
  phone_number: string;
  preferred_language: string;
  is_super_admin: boolean;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  email_verified_at: Date | null;
  phone_verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface AuthResponse {
  user: Omit<User, 'password_hash'>;
  token: string;
}

export interface AuthSession {
  user: User;
  token: string;
  refreshToken: string;
}

export interface RegisterInput {
  account_type: 'CUSTOMER' | 'SALON';
  email?: string;
  password: string;
  full_name: string;
  phone_number: string;
  preferred_language?: string;
}

export interface LoginInput {
  account_type: AccountType;
  identifier: string;
  password: string;
}

export interface GoogleLoginInput {
  account_type: 'CUSTOMER' | 'SALON';
  id_token: string;
  phone_number?: string;
  preferred_language?: string;
}

export type GoogleLoginResult =
  | { phoneRequired: true }
  | { verificationRequired: true; phoneNumber: string; developmentOtp?: string }
  | AuthSession;

export interface GoogleIdentity {
  subject: string;
  email: string;
  fullName: string;
}

export interface PhoneVerificationRequest {
  phone_number: string;
}

export interface PhoneVerificationInput {
  phone_number: string;
  code: string;
}

export interface PasswordResetRequest {
  identifier: string;
}

export interface PasswordResetInput {
  identifier: string;
  code: string;
  new_password: string;
}

export interface EmailUpdateInput {
  email: string;
}

export interface EmailVerificationInput {
  code: string;
}

export interface PasswordChangeInput {
  current_password: string;
  new_password: string;
}

export interface OtpRequestResponse {
  verificationRequired: boolean;
  developmentOtp?: string;
}

export interface AuthenticatedUser {
  id: string;
  account_type: AccountType;
  email: string | null;
  is_super_admin: boolean;
  phone_number: string;
  status: 'ACTIVE';
  email_verified_at: Date | null;
  phone_verified_at: Date | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser | null;
  }
}
