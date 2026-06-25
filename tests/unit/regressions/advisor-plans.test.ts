import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { BlockingService } from '@/services/blocking.service';
import { InvitationService } from '@/services/invitation.service';
import { ReservationService } from '@/services/reservation.service';
import { ConflictError } from '@/middleware/error-handler';
import type { Env } from '@/types/env';
import { createMockDb, SEED } from '../helpers/mock-db';

const USER_ID = SEED.reservation.userId;
const PROFESSOR_ID = '00000000-0000-0000-0000-000000000002';
const TEST_ENV: Env = {
  DB: {} as D1Database,
  JWKS_URL: '',
  JWT_ISSUER: 'http://localhost',
  JWT_SIGNING_SECRET: 'test-secret',
  INVITE_BASE_URL: 'http://localhost',
  ADMIN_BASE_URL: 'http://localhost/admin',
  ENVIRONMENT: 'development',
};

function createInvitationMockDb() {
  const selectWhere = vi.fn().mockResolvedValue([{ total: 0 }]);
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const selectFn = vi.fn().mockReturnValue({ from: selectFrom });

  return {
    query: {
      users: { findFirst: vi.fn().mockResolvedValue(undefined) },
      departments: { findFirst: vi.fn().mockResolvedValue({ id: 'iaud', name: 'IAUD', campus: 'Benfica' }) },
      invitations: {
        findFirst: vi.fn().mockResolvedValue(undefined),
        findMany: vi.fn().mockResolvedValue([]),
      },
      auditLogs: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    },
    select: selectFn,
    _select: { where: selectWhere },
  };
}

describe('advisor plan regressions', () => {
  it('keeps recurring reservation series exempt from per-role active caps', async () => {
    const db = createMockDb();
    const service = new ReservationService(db);

    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([]);
    db._insert.returning.mockResolvedValue([SEED.reservation]);
    db._select.where.mockResolvedValue([{ total: 10 }]);

    const result = await service.createRecurring(PROFESSOR_ID, 'professor', SEED.space.department, {
      spaceId: SEED.space.id,
      startDate: '2099-06-02',
      endDate: '2099-06-16',
      dayOfWeek: 1,
      startTime: '09:00',
      endTime: '10:00',
      description: 'Weekly lecture',
    });

    expect(result.created.length).toBeGreaterThan(0);
    expect(result.skipped).toEqual([]);
    expect(db._select.where).not.toHaveBeenCalled();
  });

  it('uses SQL limit/offset and count for admin reservation lists', async () => {
    const db = createMockDb();
    const service = new ReservationService(db);

    db.query.reservations.findMany.mockResolvedValue([SEED.reservation]);
    db._select.where.mockResolvedValueOnce([{ total: 42 }]);

    const result = await service.listForAdmin({
      spaceId: SEED.space.id,
      status: 'confirmed',
      page: 3,
      limit: 10,
    });

    const args = db.query.reservations.findMany.mock.calls[0][0];
    expect(args.where).toBeDefined();
    expect(args.limit).toBe(10);
    expect(args.offset).toBe(20);
    expect(db._select.where).toHaveBeenCalledWith(args.where);
    expect(result.pagination).toEqual({ page: 3, limit: 10, total: 42, totalPages: 5 });
  });

  it('uses SQL limit/offset and count for active blocking lists', async () => {
    const db = createMockDb();
    const service = new BlockingService(db);

    db.query.blockings.findMany.mockResolvedValue([SEED.blocking]);
    db._select.where.mockResolvedValueOnce([{ total: 11 }]);

    const result = await service.listActive({ dateFrom: '2099-06-01', page: 2, limit: 5 });

    const args = db.query.blockings.findMany.mock.calls[0][0];
    expect(args.where).toBeDefined();
    expect(args.limit).toBe(5);
    expect(args.offset).toBe(5);
    expect(db._select.where).toHaveBeenCalledWith(args.where);
    expect(result.pagination).toEqual({ page: 2, limit: 5, total: 11, totalPages: 3 });
  });

  it('uses SQL predicates and count for derived invitation statuses', async () => {
    const db = createInvitationMockDb();
    const service = new InvitationService(db as never, TEST_ENV);
    const invitation = {
      id: 'inv-1',
      email: 'pending@ufc.br',
      role: 'student',
      name: 'Pending User',
      registration: null,
      department: 'iaud',
      tokenHash: 'hash',
      purpose: 'invite',
      invitedBy: USER_ID,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      acceptedAt: null,
      acceptedUserId: null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
    };

    db.query.invitations.findMany.mockResolvedValue([invitation]);
    db._select.where.mockResolvedValueOnce([{ total: 6 }]);

    const result = await service.list({ status: 'pending', page: 2, limit: 4 });

    const args = db.query.invitations.findMany.mock.calls[0][0];
    expect(args.where).toBeDefined();
    expect(args.limit).toBe(4);
    expect(args.offset).toBe(4);
    expect(db._select.where).toHaveBeenCalledWith(args.where);
    expect(result.pagination).toEqual({ page: 2, limit: 4, total: 6, totalPages: 2 });
  });

  it('translates exact duplicate confirmed slots into the existing conflict error', async () => {
    const db = createMockDb();
    const service = new ReservationService(db);

    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([]);
    db._select.where.mockResolvedValueOnce([{ total: 0 }]);
    db._insert.returning.mockRejectedValueOnce(
      new Error('D1_ERROR: UNIQUE constraint failed: reservations.space_id')
    );

    await expect(
      service.create(USER_ID, 'professor', SEED.space.department, {
        spaceId: SEED.space.id,
        date: SEED.reservation.date,
        startTime: '09:00',
        endTime: '10:00',
      })
    ).rejects.toThrow(ConflictError);
  });

  it('keeps the generated D1 migration focused on the exact-slot unique index', () => {
    const sql = readFileSync('migrations/0002_tired_james_howlett.sql', 'utf8').trim();

    expect(sql).toBe(
      "CREATE UNIQUE INDEX `reservations_confirmed_slot_unq` ON `reservations` (`space_id`,`date`,`start_time`,`end_time`) WHERE status = 'confirmed';"
    );
  });
});
