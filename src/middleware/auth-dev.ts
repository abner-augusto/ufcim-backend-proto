import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '@/types/env';
import type { JwtPayload } from '@/types/auth';
import { verifyAccessToken } from '@/lib/jwt';

const DEV_STAFF_USER_ID = '00000000-0000-0000-0000-000000000003';

export function createDevelopmentUser(issuer: string): JwtPayload {
  return {
    sub: DEV_STAFF_USER_ID,
    email: 'carlos.oliveira@ufc.br',
    name: 'Carlos Oliveira',
    preferred_username: '2010005001',
    registration: '2010005001',
    department: 'Administração',
    realm_access: { roles: ['ufcim-staff'] },
    iss: issuer,
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
  };
}

export const devAuthMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    c.set('user', createDevelopmentUser(c.env.JWT_ISSUER));
    await next();
    return;
  }

  // Fall through to real JWT verification when a Bearer token is present.
  // This allows the admin login page (and any real-token request) to work in dev.
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const payload = await verifyAccessToken(token, c.env.JWT_ISSUER, c.env.JWT_SIGNING_SECRET);
      c.set('user', payload as unknown as JwtPayload);
      await next();
      return;
    } catch {
      return c.json({ error: 'Token inválido ou expirado', code: 'UNAUTHORIZED' }, 401);
    }
  }

  return c.json({ error: 'Cabeçalho Authorization inválido', code: 'UNAUTHORIZED' }, 401);
});
