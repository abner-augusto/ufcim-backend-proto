import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '@/types/env';
import type { JwtPayload } from '@/types/auth';
import { verifyAccessToken } from '@/lib/jwt';

export const localAuthMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Cabeçalho Authorization ausente ou inválido', code: 'UNAUTHORIZED' }, 401);
  }
  const token = header.slice(7);
  try {
    const payload = await verifyAccessToken(token, c.env.JWT_ISSUER, c.env.JWT_SIGNING_SECRET);
    c.set('user', payload as unknown as JwtPayload);
    await next();
  } catch {
    return c.json({ error: 'Token inválido ou expirado', code: 'UNAUTHORIZED' }, 401);
  }
});
