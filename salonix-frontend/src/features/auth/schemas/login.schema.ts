import { z } from "zod";

export const loginSchema = z
  .object({
    identifierType: z.enum(["email", "phone"]),
    email: z.string().trim().optional(),
    countryCode: z.string().regex(/^\+[1-9]\d{0,3}$/),
    phoneNumber: z.string().trim().optional(),
    password: z.string().min(1, "Enter your password").max(72),
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

export type LoginValues = z.infer<typeof loginSchema>;
