import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, Env } from '@/types/env';
import type { JwtPayload } from '@/types/auth';
import { globalErrorHandler } from '@/middleware/error-handler';

// rbac runs before any DB access, so the 403 path never touches the DB. For the
// professor path we let the space lookup miss → NotFoundError (404), which proves
// the request got *past* the role guard.
vi.mock('@/db/client', () => ({
  createDb: vi.fn(() => ({
    query: {
      spaces: { findFirst: vi.fn().mockResolvedValue(undefined) },
    },
  })),
}));

const { spaceRoutes } = await import('@/routes/spaces');

function makeEnv(): Env {
  return {
    DB: {} as unknown as D1Database,
    JWKS_URL: '',
    JWT_ISSUER: 'http://localhost',
    JWT_SIGNING_SECRET: 'test-secret',
    INVITE_BASE_URL: '',
    ADMIN_BASE_URL: '',
    BOOTSTRAP_TOKEN: 'x',
    ENVIRONMENT: 'development',
  } as Env;
}

function userWithRole(keycloakRole: string): JwtPayload {
  return {
    sub: 'user-1',
    realm_access: { roles: [keycloakRole] },
  } as JwtPayload;
}

// Mounts the real spaces routes behind a stub auth middleware that injects the
// given user — mirroring `api.use('*', authMiddleware)` in app.ts.
function makeApp(user: JwtPayload) {
  const app = new Hono<AppEnv>();
  app.onError(globalErrorHandler);
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/spaces', spaceRoutes);
  return app;
}

const REPORT_PATH = '/spaces/00000000-0000-0000-0000-000000000011/report?startDate=2026-01-01&endDate=2026-01-31';

describe('GET /spaces/:id/report — RBAC (BUG-009)', () => {
  it('blocks students with 403 FORBIDDEN', async () => {
    const res = await makeApp(userWithRole('ufcim-student')).request(REPORT_PATH, {}, makeEnv());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('FORBIDDEN');
  });

  it('validates the report query via middleware', async () => {
    const res = await makeApp(userWithRole('ufcim-professor')).request('/spaces/00000000-0000-0000-0000-000000000011/report', {}, makeEnv());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'startDate' }),
        expect.objectContaining({ field: 'endDate' }),
      ])
    );
  });

  it('lets professors past the role guard (not 403)', async () => {
    const res = await makeApp(userWithRole('ufcim-professor')).request(REPORT_PATH, {}, makeEnv());
    expect(res.status).not.toBe(403);
    // space lookup misses in this test → past the guard, into the handler
    expect(res.status).toBe(404);
  });

  it('validates the availability query via middleware', async () => {
    const res = await makeApp(userWithRole('ufcim-student')).request('/spaces/00000000-0000-0000-0000-000000000011/availability', {}, makeEnv());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'date' })])
    );
  });
});
