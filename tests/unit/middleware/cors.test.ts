import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppEnv } from '@/types/env';

function buildApp(environment: 'production' | 'development') {
  const PROD_ORIGINS = ['https://ufcim.pages.dev'];
  const DEV_ORIGINS = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:8787',
    'http://127.0.0.1:8787',
  ];

  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    const origins = c.env.ENVIRONMENT === 'production' ? PROD_ORIGINS : DEV_ORIGINS;
    const middleware = cors({
      origin: origins,
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Bootstrap-Token'],
      exposeHeaders: [],
      credentials: false,
      maxAge: 86400,
    });
    return middleware(c, next);
  });
  app.get('/test', (c) => c.json({ ok: true }));

  return app;
}

const fakeEnv = {
  DB: {} as D1Database,
  JWKS_URL: '',
  JWT_ISSUER: '',
  JWT_SIGNING_SECRET: '',
  INVITE_BASE_URL: '',
  ADMIN_BASE_URL: '',
};

describe('CORS middleware', () => {
  it('blocks an untrusted origin in production', async () => {
    const app = buildApp('production');
    const res = await app.request(
      'http://localhost/test',
      { method: 'GET', headers: { Origin: 'https://evil.com' } },
      { ...fakeEnv, ENVIRONMENT: 'production' },
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('https://evil.com');
  });

  it('allows the Pages origin in production', async () => {
    const app = buildApp('production');
    const res = await app.request(
      'http://localhost/test',
      { method: 'GET', headers: { Origin: 'https://ufcim.pages.dev' } },
      { ...fakeEnv, ENVIRONMENT: 'production' },
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://ufcim.pages.dev');
  });

  it('includes X-Bootstrap-Token in preflight allowed headers', async () => {
    const app = buildApp('production');
    const res = await app.request(
      'http://localhost/test',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://ufcim.pages.dev',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'x-bootstrap-token',
        },
      },
      { ...fakeEnv, ENVIRONMENT: 'production' },
    );
    const allowed = res.headers.get('Access-Control-Allow-Headers') ?? '';
    expect(allowed.toLowerCase()).toContain('x-bootstrap-token');
  });
});
