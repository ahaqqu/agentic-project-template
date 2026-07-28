import { z } from "zod";

export const AuthResponseSchema = z.object({
  userId: z.string().uuid(),
  token: z.string().min(16),
  expiresAt: z.number().int().positive(),
});

export type AuthResponse = z.infer<typeof AuthResponseSchema>;
