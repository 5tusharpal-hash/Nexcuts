import { OAuth2Client } from 'google-auth-library';
import { env } from '../../config/env.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import { fullNameSchema } from './auth.validation.js';
import type { GoogleIdentity } from './auth.types.js';

export class GoogleIdentityService {
  async verifyIdToken(idToken: string): Promise<GoogleIdentity> {
    if (!env.GOOGLE_CLIENT_ID) {
      throw new ApiError(503, 'Google sign-in is not configured');
    }

    try {
      const ticket = await new OAuth2Client(env.GOOGLE_CLIENT_ID).verifyIdToken({
        idToken,
        audience: env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email || payload.email_verified !== true) {
        throw new ApiError(401, 'Google account must have a verified email address');
      }

      const candidateName = payload.name?.trim() || payload.email.split('@')[0];
      const parsedName = fullNameSchema.safeParse(
        Array.from(candidateName).slice(0, 255).join('')
      );
      return {
        subject: payload.sub,
        email: payload.email.trim().toLowerCase(),
        fullName: parsedName.success ? parsedName.data : 'Google user',
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && error.name === 'GaxiosError') {
        throw new ApiError(503, 'Google sign-in verification is temporarily unavailable');
      }
      if (error instanceof Error && error.constructor === Error) {
        throw new ApiError(401, 'Google sign-in credential is invalid or expired');
      }
      throw error;
    }
  }
}
