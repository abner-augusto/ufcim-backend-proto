import { Hono } from 'hono';
import type { AppEnv } from '@/types/env';
import { createDb } from '@/db/client';
import { AuthService } from '@/services/auth.service';
import { validate } from '@/middleware/validation';
import {
  loginSchema,
  refreshSchema,
  logoutSchema,
  acceptInvitationSchema,
} from '@/validators/auth.schema';

export const authRoutes = new Hono<AppEnv>();

authRoutes.post('/login', validate(loginSchema), async (c) => {
  const db = createDb(c.env.DB);
  const service = new AuthService(db, c.env);
  const body = c.get('validatedBody') as { email: string; password: string };
  const userAgent = c.req.header('User-Agent')?.slice(0, 200);

  const result = await service.login({ ...body, userAgent });
  return c.json(result, 200);
});

authRoutes.post('/refresh', validate(refreshSchema), async (c) => {
  const db = createDb(c.env.DB);
  const service = new AuthService(db, c.env);
  const body = c.get('validatedBody') as { refreshToken: string };
  const userAgent = c.req.header('User-Agent')?.slice(0, 200);

  const result = await service.refresh({ ...body, userAgent });
  return c.json(result, 200);
});

authRoutes.post('/logout', validate(logoutSchema), async (c) => {
  const db = createDb(c.env.DB);
  const service = new AuthService(db, c.env);
  const body = c.get('validatedBody') as { refreshToken: string };

  await service.logout(body);
  return c.json({ ok: true }, 200);
});

authRoutes.get('/invitations/:token', async (c) => {
  const db = createDb(c.env.DB);
  const service = new AuthService(db, c.env);
  const token = c.req.param('token');

  const result = await service.previewInvitation(token);
  return c.json(result, 200);
});

authRoutes.post('/invitations/:token/accept', validate(acceptInvitationSchema), async (c) => {
  const db = createDb(c.env.DB);
  const service = new AuthService(db, c.env);
  const token = c.req.param('token');
  const body = c.get('validatedBody') as { password: string };
  const userAgent = c.req.header('User-Agent')?.slice(0, 200);

  const result = await service.acceptInvitation({ token, password: body.password, userAgent });
  return c.json(result, 201);
});
