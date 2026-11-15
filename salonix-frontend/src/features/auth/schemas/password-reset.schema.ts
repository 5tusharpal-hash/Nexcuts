import { z } from "zod";

export const passwordResetRequestSchema = z
  .object({
    identifierType: z.enum(["email", "phone"]),
    email: z.string().trim().optional(),
    countryCode: z.string().regex(/^\+[1-9]\d{0,3}$/, "Select a country code"),
    phoneNumber: z.string().trim().optional(),
  })
  .superRefine((values, context) => {
    if (values.identifierType === "email") {
      if (!z.string().trim().email().safeParse(values.email).success) {
        context.addIssue({
          code: "custom",
          message: "Enter a valid email address",
          path: ["email"],
        });
      }
    } else if (!z.string().trim().regex(/^\d{7,14}$/).safeParse(values.phoneNumber).success) {
      context.addIssue({
        code: "custom",
        message: "Enter a valid phone number",
        path: ["phoneNumber"],
      });
    }
  });

const resetPasswordValueSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(72, "Password must be at most 72 characters")
  .refine(
    (value) => new TextEncoder().encode(value).length <= 72,
    "Password must be at most 72 bytes",
  );

export const passwordResetCompletionSchema = z
  .object({
    code: z.string().regex(/^\d{6}$/, "Enter the 6-digit reset code"),
    newPassword: resetPasswordValueSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type PasswordResetRequestValues = z.infer<typeof passwordResetRequestSchema>;
export type PasswordResetCompletionValues = z.infer<
  typeof passwordResetCompletionSchema
>;
