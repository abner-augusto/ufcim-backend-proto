import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, Env } from '@/types/env';
import type { JwtPayload } from '@/types/auth';
import { globalErrorHandler } from '@/middleware/error-handler';

const create = vi.fn();
const createRecurring = vi.fn();
const update = vi.fn();

vi.mock('@/db/client', () => ({
  createDb: vi.fn(() => ({})),
}));

vi.mock('@/services/reservation.service', () => ({
  ReservationService: class {
    create = create;
    createRecurring = createRecurring;
    update = update;
  },
}));

const { reservationRoutes } = await import('@/routes/reservations');

function makeEnv(): Env {
  return { DB: {} as unknown as D1Database, ENVIRONMENT: 'development' } as Env;
}

function makeApp() {
  const app = new Hono<AppEnv>();
  app.onError(globalErrorHandler);
  app.use('*', async (c, next) => {
    c.set('user', {
      sub: 'prof-1',
      department: 'iaud',
      realm_access: { roles: ['ufcim-professor'] },
    } as JwtPayload);
    await next();
  });
  app.route('/reservations', reservationRoutes);
  return app;
}

function postJson(path: string, body: unknown) {
  return makeApp().request(
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    makeEnv()
  );
}

function patchJson(path: string, body: unknown) {
  return makeApp().request(
    path,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    makeEnv()
  );
}

const VALID_SPACE = '550e8400-e29b-41d4-a716-446655440000';
const DESC_300 = 'x'.repeat(300);
const DESC_301 = 'x'.repeat(301);

describe('reservation description length validation on routes (#28)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    create.mockImplementation(async (_u, _r, _d, body) => ({ id: 'res-1', description: body.description }));
    createRecurring.mockImplementation(async (_u, _r, _d, body) => ({ created: [{ id: 'res-1', description: body.description }], skipped: [] }));
    update.mockImplementation(async (id, _u, _r, _d, body) => ({ id, description: body.description }));
  });

  it('POST /reservations accepts 300 chars (201) and rejects 301 chars (400)', async () => {
    const base = { spaceId: VALID_SPACE, date: '2099-06-15', startTime: '09:00', endTime: '10:00' };

    const ok = await postJson('/reservations', { ...base, description: DESC_300 });
    expect(ok.status).toBe(201);
    expect(create).toHaveBeenCalledTimes(1);

    const tooLong = await postJson('/reservations', { ...base, description: DESC_301 });
    expect(tooLong.status).toBe(400);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('POST /reservations/recurring accepts 300 chars (201) and rejects 301 chars (400)', async () => {
    const base = {
      spaceId: VALID_SPACE,
      startDate: '2099-06-15',
      endDate: '2099-07-15',
      daysOfWeek: [1],
      startTime: '14:00',
      endTime: '15:00',
    };

    const ok = await postJson('/reservations/recurring', { ...base, description: DESC_300 });
    expect(ok.status).toBe(201);
    expect(createRecurring).toHaveBeenCalledTimes(1);

    const tooLong = await postJson('/reservations/recurring', { ...base, description: DESC_301 });
    expect(tooLong.status).toBe(400);
    expect(createRecurring).toHaveBeenCalledTimes(1);
  });

  it('PATCH /reservations/:id accepts 300 chars (200) and rejects 301 chars (400)', async () => {
    const ok = await patchJson('/reservations/res-1', { description: DESC_300 });
    expect(ok.status).toBe(200);
    expect(update).toHaveBeenCalledTimes(1);

    const tooLong = await patchJson('/reservations/res-1', { description: DESC_301 });
    expect(tooLong.status).toBe(400);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
