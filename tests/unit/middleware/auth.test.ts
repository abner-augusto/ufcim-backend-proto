import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { authMiddleware } from '@/middleware/auth';
import type { AppEnv } from '@/types/env';

describe('authMiddleware', () => {
  it('fails closed when Authorization is absent', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', authMiddleware);
    app.get('/protected', (c) => c.json(c.get('user')));

    const response = await app.request('http://localhost/protected', {
      method: 'GET',
    }, {
      DB: {} as D1Database,
      JWKS_URL: 'http://localhost/dev/jwks',
      JWT_ISSUER: 'http://localhost:8787',
      ENVIRONMENT: 'production',
    });

    expect(response.status).toBe(401);
  });
});
