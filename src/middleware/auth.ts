import { createMiddleware } from 'hono/factory';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import type { AppEnv } from '@/types/env';
import type { JwtPayload } from '@/types/auth';

export type { JwtPayload };

/**
 * Verifies JWT from Authorization: Bearer <token> header.
 * Validates the RS256 signature against the JWKS endpoint.
 * Prototype: points to a test JWKS. Production: Keycloak JWKS URL.
 */
export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const authHeader = c.req.header('Authorization');

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
