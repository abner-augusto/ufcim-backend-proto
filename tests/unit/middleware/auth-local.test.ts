import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { localAuthMiddleware } from '@/middleware/auth-local';
import { signAccessToken } from '@/lib/jwt';
import type { AppEnv, Env } from '@/types/env';

const TEST_SECRET = 'test-signing-secret';
const TEST_ISSUER = 'http://localhost:8787';

const TEST_ENV: Env = {
  DB: {} as D1Database,
  JWKS_URL: '',
  JWT_ISSUER: TEST_ISSUER,
  JWT_SIGNING_SECRET: TEST_SECRET,
  INVITE_BASE_URL: 'http://localhost:5173',
  ADMIN_BASE_URL: 'http://localhost:8787/admin',
  ENVIRONMENT: 'development',
};

function makeApp() {
  const app = new Hono<AppEnv>();
  app.use('*', localAuthMiddleware);
  app.get('/protected', (c) => c.json({ sub: c.get('user').sub }));
  return app;
}

describe('localAuthMiddleware', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const app = makeApp();
    const res = await app.request('http://localhost/protected', { method: 'GET' }, TEST_ENV);
    expect(res.status).toBe(401);
  });

  it('returns 401 when Authorization header has wrong format', async () => {
    const app = makeApp();
    const res = await app.request(
      'http://localhost/protected',
      { method: 'GET', headers: { Authorization: 'Basic abc' } },
      TEST_ENV
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 for a malformed token', async () => {
    const app = makeApp();
    const res = await app.request(
      'http://localhost/protected',
      { method: 'GET', headers: { Authorization: 'Bearer not.a.valid.jwt' } },
      TEST_ENV
    );
    expect(res.status).toBe(401);
  });

  it('calls next and populates user for a valid token', async () => {
    const token = await signAccessToken({
      userId: 'user-abc',
      email: 'user@ufc.br',
      name: 'Test',
      registration: null,
      department: 'CC',
      role: 'student',
      isMasterAdmin: false,
      issuer: TEST_ISSUER,
      secret: TEST_SECRET,
    });

    const app = makeApp();
    const res = await app.request(
      'http://localhost/protected',
      { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
      TEST_ENV
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { sub: string };
    expect(body.sub).toBe('user-abc');
  });
});
