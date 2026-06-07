import { Hono } from 'hono';
import type { AppEnv } from '@/types/env';
import { createDb } from '@/db/client';
import { AuthService } from '@/services/auth.service';
import { validate } from '@/middleware/validation';
import { rateLimit } from '@/middleware/rate-limit';
import {
  loginSchema,
  refreshSchema,
  logoutSchema,
  acceptInvitationSchema,
  requestInvitationSchema,
} from '@/validators/auth.schema';
import { InvitationRequestService } from '@/services/invitation-request.service';
import { TurnstileService } from '@/services/turnstile.service';
import { AppError } from '@/middleware/error-handler';

export const authRoutes = new Hono<AppEnv>();

authRoutes.post('/login', rateLimit({ namespace: 'login', max: 10, windowSeconds: 60 }), validate(loginSchema), async (c) => {
  const db = createDb(c.env.DB);
  const service = new AuthService(db, c.env);
  const body = c.get('validatedBody') as { email: string; password: string };
  const userAgent = c.req.header('User-Agent')?.slice(0, 200);

  const result = await service.login({ ...body, userAgent });
  return c.json(result, 200);
});

authRoutes.post('/refresh', rateLimit({ namespace: 'refresh', max: 30, windowSeconds: 60 }), validate(refreshSchema), async (c) => {
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

authRoutes.post('/request-invitation', rateLimit({ namespace: 'invite-request', max: 5, windowSeconds: 60 }), validate(requestInvitationSchema), async (c) => {
  const body = c.get('validatedBody') as { name: string; email: string; turnstileToken?: string };

  const remoteIp = c.req.header('CF-Connecting-IP') ?? undefined;
  const turnstile = new TurnstileService(c.env);
  const ok = await turnstile.verify(body.turnstileToken, remoteIp);
  if (!ok) {
    throw new AppError(403, 'Falha na verificação de segurança. Tente novamente.', 'TURNSTILE_FAILED');
  }

  const db = createDb(c.env.DB);
  const service = new InvitationRequestService(db, c.env);
  await service.request({ name: body.name, email: body.email });

  return c.json({ message: 'Solicitação recebida. Você receberá um convite por e-mail após a aprovação.' }, 200);
});

authRoutes.get('/invitations/:token', async (c) => {
  const db = createDb(c.env.DB);
  const service = new AuthService(db, c.env);
  const token = c.req.param('token');

  const result = await service.previewInvitation(token);
  return c.json(result, 200);
});

authRoutes.post('/invitations/:token/accept', rateLimit({ namespace: 'invite-accept', max: 20, windowSeconds: 60 }), validate(acceptInvitationSchema), async (c) => {
  const db = createDb(c.env.DB);
  const service = new AuthService(db, c.env);
  const token = c.req.param('token');
  const body = c.get('validatedBody') as { password: string };
  const userAgent = c.req.header('User-Agent')?.slice(0, 200);

  const result = await service.acceptInvitation({ token, password: body.password, userAgent });
  return c.json(result, 201);
});
