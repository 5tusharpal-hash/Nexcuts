import { z } from 'zod';
import { phoneNumberSchema } from '../../shared/validation/phone-number.js';

export { phoneNumberSchema } from '../../shared/validation/phone-number.js';

export const accountTypeSchema = z.enum(['CUSTOMER', 'SALON', 'PLATFORM', 'ADMIN']);
export const selfServiceAccountTypeSchema = z.enum(['CUSTOMER', 'SALON']);
export const googleLoginAccountTypeSchema = selfServiceAccountTypeSchema;

export const googleLoginSchema = z.object({
  account_type: googleLoginAccountTypeSchema,
  id_token: z.string().trim().min(1).max(8192),
  phone_number: phoneNumberSchema.optional(),
  preferred_language: z.string().trim().min(2).max(10).optional(),
});

export const emailSchema = z
  .string()
  .trim()
  .max(320)
  .email()
  .transform((value) => value.toLowerCase());

export const identifierSchema = z.union([emailSchema, phoneNumberSchema]);

export const passwordSchema = z
  .string()
  .min(12)
  .max(72)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 bytes');

export const loginPasswordSchema = z
  .string()
  .min(1)
  .max(72)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 bytes');

export const otpSchema = z.string().regex(/^\d{6}$/, 'OTP must contain exactly six digits');

export const fullNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(255)
  .refine(
    (value) =>
      !Array.from(value).some((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint !== undefined && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f));
      }),
    'Name contains invalid characters'
  )
  .transform((value) => value.normalize('NFC'));
