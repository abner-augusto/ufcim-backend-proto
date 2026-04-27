import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

export const passwordPolicySchema = z
  .string()
  .min(10, 'A senha deve ter pelo menos 10 caracteres')
  .regex(/[A-Za-z]/, 'A senha deve conter pelo menos uma letra')
  .regex(/[0-9]/, 'A senha deve conter pelo menos um número');

export const acceptInvitationSchema = z.object({
  password: passwordPolicySchema,
});
