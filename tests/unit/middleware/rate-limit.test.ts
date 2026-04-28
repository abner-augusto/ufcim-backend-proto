import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { rateLimit } from '@/middleware/rate-limit';
import type { AppEnv, Env } from '@/types/env';

// ─── Mock DB ─────────────────────────────────────────────────────────────────

function mockEnv(
  initialBuckets: Record<string, { count: number; windowStart: string }> = {},
  overrides: Partial<Env> = {}
) {
  const buckets = new Map(Object.entries(initialBuckets));
  return {
    DB: {
      prepare: (_sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async <T>(): Promise<T | null> => {
            const [key, _ws1, ws2, windowSeconds] = args as [string, string, string, number];
            const existing = buckets.get(key);
            const nowSec = Math.floor(new Date(ws2 as string).getTime() / 1000);

            if (!existing) {
              buckets.set(key, { count: 1, windowStart: ws2 as string });
              return { count: 1 } as T;
            }

            const startSec = Math.floor(new Date(existing.windowStart).getTime() / 1000);
            const elapsed = nowSec - startSec;

            if (elapsed >= (windowSeconds as number)) {
              buckets.set(key, { count: 1, windowStart: ws2 as string });
              return { count: 1 } as T;
            }

            const newCount = existing.count + 1;
            buckets.set(key, { count: newCount, windowStart: existing.windowStart });
            return { count: newCount } as T;
          },
        }),
      }),
    } as unknown as D1Database,
    JWKS_URL: '',
    JWT_ISSUER: '',
    JWT_SIGNING_SECRET: '',
    INVITE_BASE_URL: '',
    ADMIN_BASE_URL: '',
    ENVIRONMENT: 'development' as const,
    ...overrides,
  };
}

function buildApp(opts: Parameters<typeof rateLimit>[0]) {
  const app = new Hono<AppEnv>();
  app.use('*', rateLimit(opts));
  app.get('/test', (c) => c.json({ ok: true }));
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('rateLimit middleware', () => {
  it('allows requests up to max (10)', async () => {
    const app = buildApp({ namespace: 'login', max: 10, windowSeconds: 60 });
    const env = mockEnv();

    for (let i = 0; i < 10; i++) {
      const res = await app.request('http://localhost/test', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }, env);
      expect(res.status).toBe(200);
    }
  });

  it('blocks the 11th request with 429', async () => {
    const app = buildApp({ namespace: 'login', max: 10, windowSeconds: 60 });
    const env = mockEnv();

    for (let i = 0; i < 10; i++) {
      await app.request('http://localhost/test', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }, env);
    }

    const res = await app.request('http://localhost/test', {
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    }, env);
    expect(res.status).toBe(429);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('RATE_LIMITED');
  });

  it('sets Retry-After header on 429', async () => {
    const app = buildApp({ namespace: 'login', max: 1, windowSeconds: 60 });
    const env = mockEnv();

    await app.request('http://localhost/test', {
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    }, env);

    const res = await app.request('http://localhost/test', {
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    }, env);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
  });

  it('resets counter after the window expires', async () => {
    const app = buildApp({ namespace: 'login', max: 1, windowSeconds: 60 });
    // Pre-seed an expired bucket (window started 2 minutes ago)
    const oldStart = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const env = mockEnv({ 'login:1.2.3.4': { count: 1, windowStart: oldStart } });

    const res = await app.request('http://localhost/test', {
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    }, env);
    expect(res.status).toBe(200);
  });

  it('falls back to "unknown" when no IP header is present', async () => {
    const app = buildApp({ namespace: 'login', max: 1, windowSeconds: 60 });
    const env = mockEnv();

    await app.request('http://localhost/test', {}, env);
    const res = await app.request('http://localhost/test', {}, env);
    expect(res.status).toBe(429);
  });

  it('maintains independent counts per IP', async () => {
    const app = buildApp({ namespace: 'login', max: 1, windowSeconds: 60 });
    const env = mockEnv();

    // First IP hits the limit
    await app.request('http://localhost/test', { headers: { 'CF-Connecting-IP': '10.0.0.1' } }, env);
    const blocked = await app.request('http://localhost/test', { headers: { 'CF-Connecting-IP': '10.0.0.1' } }, env);
    expect(blocked.status).toBe(429);

    // Second IP still passes
    const ok = await app.request('http://localhost/test', { headers: { 'CF-Connecting-IP': '10.0.0.2' } }, env);
    expect(ok.status).toBe(200);
  });
});
