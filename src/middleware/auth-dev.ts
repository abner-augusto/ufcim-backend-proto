import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '@/types/env';
import type { JwtPayload } from '@/types/auth';

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

  return c.json(
    { error: 'Development auth bypass only supports requests without Authorization header', code: 'UNAUTHORIZED' },
    401
  );
});
