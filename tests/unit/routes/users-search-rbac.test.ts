import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, Env } from '@/types/env';
import type { JwtPayload } from '@/types/auth';
import { globalErrorHandler } from '@/middleware/error-handler';

// The staff path reaches the service; the users lookup returns one row.
const findMany = vi.fn().mockResolvedValue([
  { id: 'prof-1', name: 'Dra. Maria Costa', role: 'professor', department: { id: 'iaud', name: 'IAUD' } },
]);
vi.mock('@/db/client', () => ({
  createDb: vi.fn(() => ({ query: { users: { findMany } } })),
}));

const { userRoutes } = await import('@/routes/users');

function makeEnv(): Env {
  return { DB: {} as unknown as D1Database, ENVIRONMENT: 'development' } as Env;
}

function makeApp(keycloakRole: string) {
  const app = new Hono<AppEnv>();
  app.onError(globalErrorHandler);
  app.use('*', async (c, next) => {
    c.set('user', { sub: 'user-1', realm_access: { roles: [keycloakRole] } } as JwtPayload);
    await next();
  });
  app.route('/users', userRoutes);
  return app;
}

describe('GET /users/search — RBAC and validation (MEL-025)', () => {
  it.each(['ufcim-student', 'ufcim-professor', 'ufcim-maintenance'])('blocks %s with 403', async (role) => {
    const res = await makeApp(role).request('/users/search?q=maria', {}, makeEnv());
    expect(res.status).toBe(403);
  });

  it('answers staff with { id, name, role, department }', async () => {
    const res = await makeApp('ufcim-staff').request('/users/search?q=maria', {}, makeEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 'prof-1', name: 'Dra. Maria Costa', role: 'professor', department: 'IAUD' }]);
  });

  it('rejects a query shorter than 2 characters with 400', async () => {
    const res = await makeApp('ufcim-staff').request('/users/search?q=%20m%20', {}, makeEnv());
    expect(res.status).toBe(400);
  });
});
