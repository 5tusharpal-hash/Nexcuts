import { z } from "zod";

export const emailVerificationSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit verification code"),
});

export type EmailVerificationValues = z.infer<typeof emailVerificationSchema>;
