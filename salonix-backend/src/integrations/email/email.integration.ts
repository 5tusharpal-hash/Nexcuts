import { Resend } from 'resend';
import { env } from '../../config/env.js';
import { ApiError } from '../../shared/errors/ApiError.js';

export class EmailIntegration {
  async sendTransactionalEmail(to: string, subject: string, text: string): Promise<string | undefined> {
    if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
      throw new ApiError(503, 'Email provider is not configured');
    }
    const resend = new Resend(env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({ from: env.RESEND_FROM_EMAIL, to, subject, text });
    if (error) throw new Error(`Email provider failed: ${error.message}`);
    return data?.id;
  }

  async sendMarketingEmail(to: string, subject: string, text: string): Promise<string | undefined> {
    if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
      throw new ApiError(503, 'Email marketing provider is not configured');
    }

    const resend = new Resend(env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to,
      subject,
      text,
    });

    if (error) throw new Error('Email provider rejected the marketing message');
    return data?.id;
  }

  async sendOtp(to: string, code: string): Promise<void> {
    if (env.AUTH_OTP_DELIVERY === 'mock') return;
    if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
      throw new ApiError(503, 'Email OTP provider is not configured');
    }

    const resend = new Resend(env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to,
      subject: 'Your Salonix verification code',
      text: `Your Salonix verification code is ${code}. It expires in five minutes. Do not share this code.`,
    });

    if (error) throw new Error(`Email OTP provider failed: ${error.message}`);
  }
}
