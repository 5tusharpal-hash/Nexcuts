import { z } from "zod";

const serverEnvironmentSchema = z.object({
  AUTH_COOKIE_NAME: z.string().trim().min(1).max(100),
});

export const serverEnv = serverEnvironmentSchema.parse({
  AUTH_COOKIE_NAME: process.env.AUTH_COOKIE_NAME,
});
