import { createMiddleware } from 'hono/factory';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import type { Env } from '@/types/env';
import type { JwtPayload } from '@/types/auth';

export type { JwtPayload };

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

/**
 * Verifies JWT from Authorization: Bearer <token> header.
 * Validates the RS256 signature against the JWKS endpoint.
 * Prototype: points to a test JWKS. Production: Keycloak JWKS URL.
 */
export const authMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: { user: JwtPayload };
}>(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (c.env.ENVIRONMENT === 'development' && !authHeader) {
    c.set('user', createDevelopmentUser(c.env.JWT_ISSUER));
    await next();
    return;
  }

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header', code: 'UNAUTHORIZED' }, 401);
  }

  const token = authHeader.slice(7);

  try {
    const JWKS = createRemoteJWKSet(new URL(c.env.JWKS_URL));
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: c.env.JWT_ISSUER,
      ...(c.env.JWT_AUDIENCE ? { audience: c.env.JWT_AUDIENCE } : {}),
    });

    c.set('user', payload as unknown as JwtPayload);
    await next();
  } catch {
    return c.json({ error: 'Invalid or expired token', code: 'UNAUTHORIZED' }, 401);
  }
});
