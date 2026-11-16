import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, Env } from '@/types/env';
import type { JwtPayload } from '@/types/auth';
import { globalErrorHandler } from '@/middleware/error-handler';

const listMock = vi.fn().mockResolvedValue({
  data: [],
  pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
  actors: [],
});

vi.mock('@/db/client', () => ({
  createDb: vi.fn(() => ({})),
}));

vi.mock('@/services/department-audit-log.service', () => ({
  DepartmentAuditLogService: class {
    list = listMock;
  },
}));

const { logRoutes } = await import('@/routes/logs');

function makeEnv(): Env {
  return { DB: {} as unknown as D1Database, ENVIRONMENT: 'development' } as Env;
}

function makeApp(keycloakRole: string, department = 'iaud') {
  const app = new Hono<AppEnv>();
  app.onError(globalErrorHandler);
  app.use('*', async (c, next) => {
    c.set('user', {
      sub: 'staff-1',
      department,
      realm_access: { roles: [keycloakRole] },
    } as JwtPayload);
    await next();
  });
  app.route('/logs', logRoutes);
  return app;
}

describe('GET /logs — RBAC and validation (#60)', () => {
  beforeEach(() => {
    listMock.mockClear();
  });

  it.each(['ufcim-student', 'ufcim-professor', 'ufcim-maintenance'])('blocks %s with 403', async (role) => {
    const res = await makeApp(role).request('/logs', {}, makeEnv());
    expect(res.status).toBe(403);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('allows staff and forwards department and validated filters', async () => {
    const res = await makeApp('ufcim-staff', 'iaud').request(
      '/logs?userId=u-2&actionType=create_reservation&referenceType=reservation&dateFrom=2026-05-01&dateTo=2026-05-31&page=2&limit=10',
      {},
      makeEnv(),
    );

    expect(res.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith('staff-1', 'iaud', {
      userId: 'u-2',
      actionType: 'create_reservation',
      referenceType: 'reservation',
      dateFrom: '2026-05-01',
      dateTo: '2026-05-31',
      page: 2,
      limit: 10,
    });
  });

  it('rejects invalid query parameters with 400', async () => {
    const res = await makeApp('ufcim-staff').request('/logs?referenceType=user', {}, makeEnv());
    expect(res.status).toBe(400);
    expect(listMock).not.toHaveBeenCalled();
  });
});
