import { z } from "zod";

export const phoneVerificationSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit verification code"),
});

export type PhoneVerificationValues = z.infer<typeof phoneVerificationSchema>;
