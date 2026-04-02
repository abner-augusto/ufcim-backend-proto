import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { devAuthMiddleware, createDevelopmentUser } from '@/middleware/auth-dev';
import type { AppEnv } from '@/types/env';

describe('createDevelopmentUser', () => {
  it('returns a staff-role payload for the dev-only worker entry', () => {
    const user = createDevelopmentUser('http://localhost:8787');

    expect(user.sub).toBe('00000000-0000-0000-0000-000000000003');
    expect(user.realm_access?.roles).toContain('ufcim-staff');
    expect(user.iss).toBe('http://localhost:8787');
  });
});

describe('devAuthMiddleware', () => {
  it('injects the mock staff user when Authorization is absent', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', devAuthMiddleware);
    app.get('/protected', (c) => c.json(c.get('user')));

    const response = await app.request('http://localhost/protected', {
      method: 'GET',
    }, {
      DB: {} as D1Database,
      JWKS_URL: 'http://localhost/dev/jwks',
      JWT_ISSUER: 'http://localhost:8787',
      ENVIRONMENT: 'development',
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.sub).toBe('00000000-0000-0000-0000-000000000003');
  });

  it('rejects requests that send an Authorization header', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', devAuthMiddleware);
    app.get('/protected', (c) => c.json(c.get('user')));

    const response = await app.request('http://localhost/protected', {
      method: 'GET',
      headers: { Authorization: 'Bearer test-token' },
    }, {
      DB: {} as D1Database,
      JWKS_URL: 'http://localhost/dev/jwks',
      JWT_ISSUER: 'http://localhost:8787',
      ENVIRONMENT: 'development',
    });

    expect(response.status).toBe(401);
  });
});
