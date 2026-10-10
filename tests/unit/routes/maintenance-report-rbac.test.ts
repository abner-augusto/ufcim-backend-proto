import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, Env } from '@/types/env';
import type { JwtPayload } from '@/types/auth';
import { globalErrorHandler } from '@/middleware/error-handler';

// rbac runs before any DB access. Past the guard, the mocked DB returns empty
// collections (list → 200) or misses the equipment lookup (detail → 404).
vi.mock('@/db/client', () => {
  const table = () => ({
    findFirst: vi.fn().mockResolvedValue(undefined),
    findMany: vi.fn().mockResolvedValue([]),
  });
  return {
    createDb: vi.fn(() => ({
      query: { equipment: table(), equipmentReports: table(), equipmentStatusHistory: table() },
    })),
  };
});

const { reportRoutes } = await import('@/routes/reports');
const { equipmentRoutes } = await import('@/routes/equipment');

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

function makeApp(keycloakRole: string) {
  const app = new Hono<AppEnv>();
  app.onError(globalErrorHandler);
  app.use('*', async (c, next) => {
    c.set('user', { sub: 'user-1', realm_access: { roles: [keycloakRole] } } as JwtPayload);
    await next();
  });
  app.route('/reports', reportRoutes);
  app.route('/equipment', equipmentRoutes);
  return app;
}

const LIST_PATH = '/reports/maintenance/equipment';
const DETAIL_PATH = '/equipment/eq-1/maintenance-report';

describe('maintenance history endpoints — RBAC (MEL-013)', () => {
  for (const role of ['ufcim-student', 'ufcim-professor']) {
    it(`blocks ${role} with 403 on both endpoints`, async () => {
      const app = makeApp(role);
      expect((await app.request(LIST_PATH, {}, makeEnv())).status).toBe(403);
      expect((await app.request(DETAIL_PATH, {}, makeEnv())).status).toBe(403);
    });
  }

  for (const role of ['ufcim-staff', 'ufcim-maintenance']) {
    it(`lets ${role} through`, async () => {
      const app = makeApp(role);
      const list = await app.request(LIST_PATH, {}, makeEnv());
      expect(list.status).toBe(200);
      const body = await list.json();
      expect(body.range.days).toBe(90);
      expect(body.equipment).toEqual([]);

      expect((await app.request(DETAIL_PATH, {}, makeEnv())).status).toBe(404);
    });
  }

  it('rejects malformed filters and ranges above 90 days', async () => {
    const app = makeApp('ufcim-staff');
    expect((await app.request(`${LIST_PATH}?from=01-01-2026`, {}, makeEnv())).status).toBe(400);
    expect((await app.request(`${LIST_PATH}?severity=huge`, {}, makeEnv())).status).toBe(400);

    const tooLong = await app.request(`${LIST_PATH}?from=2026-01-01&to=2026-06-01`, {}, makeEnv());
    expect(tooLong.status).toBe(400);
    expect((await tooLong.json()).code).toBe('RANGE_TOO_LARGE');
  });
});
