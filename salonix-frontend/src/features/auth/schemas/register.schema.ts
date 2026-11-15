import { z } from "zod";

export const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, "Full name must be at least 2 characters").max(255),
    email: z.string().trim().email("Enter a valid email address"),
    countryCode: z.string().regex(/^\+[1-9]\d{0,3}$/, "Select a country code"),
    phoneNumber: z
      .string()
      .trim()
      .regex(/^\d{7,14}$/, "Enter a valid local phone number"),
    password: z
      .string()
      .min(12, "Password must be at least 12 characters")
      .max(72, "Password must be at most 72 characters"),
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type RegisterValues = z.infer<typeof registerSchema>;
