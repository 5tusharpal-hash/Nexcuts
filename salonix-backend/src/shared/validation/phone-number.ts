import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { z } from 'zod';

export const phoneNumberSchema = z
  .string()
  .trim()
  .min(8)
  .max(32)
  .transform((value, context) => {
    const parsed = value.startsWith('+') ? parsePhoneNumberFromString(value) : undefined;
    if (!parsed?.isValid() || !/^\+[1-9]\d{6,14}$/.test(parsed.number)) {
      context.addIssue({
        code: 'custom',
        message: 'Enter a valid phone number with country code, for example +919876543210',
      });
      return z.NEVER;
    }
    return parsed.number;
  });
