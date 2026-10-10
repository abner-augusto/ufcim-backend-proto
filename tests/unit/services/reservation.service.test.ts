import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
import { ReservationService } from '@/services/reservation.service';
import {
  NotFoundError,
  ConflictError,
  ForbiddenError,
  AppError,
} from '@/middleware/error-handler';
import { createMockDb, SEED } from '../helpers/mock-db';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

const USER_ID = SEED.reservation.userId;
const OTHER_USER_ID = '00000000-0000-0000-0000-000000000002';
const SPACE_ID = SEED.space.id;
const DATE = SEED.reservation.date;
const START_TIME = '09:00';
const END_TIME = '10:00';

describe('ReservationService.create', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: ReservationService;

  beforeEach(() => {
    db = createMockDb();
    service = new ReservationService(db);
    // Default: insert operations succeed
    db._insert.returning.mockResolvedValue([SEED.reservation]);
  });

  it('throws NotFoundError when space does not exist', async () => {
    db.query.spaces.findFirst.mockResolvedValue(undefined);

    await expect(
      service.create(USER_ID, 'professor', 'Any Dept', { spaceId: SPACE_ID, date: DATE, startTime: START_TIME, endTime: END_TIME })
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ForbiddenError when student tries to reserve outside their department', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space); // dept: Ciência da Computação

    await expect(
      service.create(USER_ID, 'student', 'Administração', { spaceId: SPACE_ID, date: DATE, startTime: START_TIME, endTime: END_TIME })
    ).rejects.toThrow(ForbiddenError);
  });

  it('throws ForbiddenError when professor tries to reserve outside their department', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space); // dept: Ciência da Computação

    await expect(
      service.create(OTHER_USER_ID, 'professor', 'Administração', { spaceId: SPACE_ID, date: DATE, startTime: START_TIME, endTime: END_TIME })
    ).rejects.toThrow(ForbiddenError);
  });

  it('allows staff to reserve outside their department', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space); // dept: Ciência da Computação
    db.query.reservations.findMany.mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([]);
    db._select.where.mockResolvedValueOnce([{ total: 0 }]);

    await expect(
      service.create(OTHER_USER_ID, 'staff', 'Administração', { spaceId: SPACE_ID, date: DATE, startTime: START_TIME, endTime: END_TIME })
    ).resolves.toMatchObject({ id: SEED.reservation.id });
  });

  it('throws ConflictError when a reservation overlaps the requested time range', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([SEED.reservation]);
    db.query.blockings.findMany.mockResolvedValue([]);

    await expect(
      service.create(USER_ID, 'professor', 'Ciência da Computação', { spaceId: SPACE_ID, date: DATE, startTime: START_TIME, endTime: END_TIME })
    ).rejects.toThrow(ConflictError);
  });

  it('throws ConflictError when the room is blocked for the requested time range', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([SEED.blocking]);

    await expect(
      service.create(USER_ID, 'professor', 'Ciência da Computação', { spaceId: SPACE_ID, date: DATE, startTime: '08:00', endTime: '09:00' })
    ).rejects.toThrow(ConflictError);
  });

  it('throws ConflictError on a partial half-hour overlap (16:00–17:00 vs 16:30–17:30, MEL-024)', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([
      { ...SEED.reservation, startTime: '16:00', endTime: '17:00' },
    ]);
    db.query.blockings.findMany.mockResolvedValue([]);

    await expect(
      service.create(USER_ID, 'professor', 'Ciência da Computação', { spaceId: SPACE_ID, date: DATE, startTime: '16:30', endTime: '17:30' })
    ).rejects.toThrow(ConflictError);
  });

  it('accepts a half-hour range right after an existing reservation (MEL-024)', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([
      { ...SEED.reservation, startTime: '15:30', endTime: '16:30' },
    ]);
    db.query.blockings.findMany.mockResolvedValue([]);
    db._select.where.mockResolvedValueOnce([{ total: 0 }]);

    await expect(
      service.create(USER_ID, 'professor', 'Ciência da Computação', { spaceId: SPACE_ID, date: DATE, startTime: '16:30', endTime: '18:00' })
    ).resolves.toMatchObject({ id: SEED.reservation.id });
  });

  it('throws ConflictError when the reservation falls within closed hours', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);

    await expect(
      service.create(USER_ID, 'professor', 'Ciência da Computação', { spaceId: SPACE_ID, date: DATE, startTime: '23:00', endTime: '24:00' })
    ).rejects.toThrow(ConflictError);
  });

  it('throws RESERVATION_LIMIT when student has reached 5 active reservations', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([]);
    db._select.where.mockResolvedValueOnce([{ total: 5 }]);

    const err = await service
      .create(USER_ID, 'student', SEED.space.department, { spaceId: SPACE_ID, date: DATE, startTime: START_TIME, endTime: END_TIME })
      .catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('RESERVATION_LIMIT');
  });

  it('throws RESERVATION_LIMIT when professor has reached 10 active reservations', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([]);
    db._select.where.mockResolvedValueOnce([{ total: 10 }]);

    const err = await service
      .create(OTHER_USER_ID, 'professor', SEED.space.department, { spaceId: SPACE_ID, date: DATE, startTime: START_TIME, endTime: END_TIME })
      .catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('RESERVATION_LIMIT');
  });

  it('throws ConflictError when the confirmed slot unique index rejects the insert', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([]);
    db._select.where.mockResolvedValueOnce([{ total: 0 }]);
    db._insert.returning.mockRejectedValueOnce(new Error('D1_ERROR: UNIQUE constraint failed: reservations.space_id'));

    await expect(
      service.create(USER_ID, 'professor', SEED.space.department, { spaceId: SPACE_ID, date: DATE, startTime: START_TIME, endTime: END_TIME })
    ).rejects.toThrow(ConflictError);
  });

  it('throws ForbiddenError when maintenance role tries to create a reservation', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([]);

    const err = await service
      .create(USER_ID, 'maintenance', SEED.space.department, { spaceId: SPACE_ID, date: DATE, startTime: START_TIME, endTime: END_TIME })
      .catch((e) => e);

    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it('does not count past reservations toward the active limit', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([]);
    // Simulate: query returns 0 because the date filter excludes past records
    db._select.where.mockResolvedValueOnce([{ total: 0 }]);
    db._insert.returning.mockResolvedValue([SEED.reservation]);

    await expect(
      service.create(USER_ID, 'student', SEED.space.department, { spaceId: SPACE_ID, date: DATE, startTime: START_TIME, endTime: END_TIME })
    ).resolves.toMatchObject({ id: SEED.reservation.id });
  });

  it('creates and returns a reservation for a professor with no conflicts', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([]);
    db._select.where.mockResolvedValueOnce([{ total: 0 }]);
    db._insert.returning.mockResolvedValue([SEED.reservation]);

    const result = await service.create(
      OTHER_USER_ID,
      'professor',
      'Ciência da Computação',
      { spaceId: SPACE_ID, date: DATE, startTime: START_TIME, endTime: END_TIME }
    );

    expect(result).toMatchObject({ id: SEED.reservation.id });
  });
});

describe('ReservationService.create — same-day past hour (BUG-005)', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: ReservationService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2099-06-15T18:40:00Z')); // 15:40 in Fortaleza
    db = createMockDb();
    service = new ReservationService(db);
  });

  afterEach(() => vi.useRealTimers());

  it('rejects a start whose half-hour slot already ended (15:00 at 15:40, MEL-024)', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([]);

    await expect(
      service.create(USER_ID, 'professor', SEED.space.department, {
        spaceId: SPACE_ID,
        date: '2099-06-15',
        startTime: '15:00',
        endTime: '16:00',
      })
    ).rejects.toThrow(ConflictError);
  });

  it('rejects an ended slot today', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([]);

    await expect(
      service.create(USER_ID, 'professor', SEED.space.department, {
        spaceId: SPACE_ID,
        date: '2099-06-15',
        startTime: '14:00',
        endTime: '15:00',
      })
    ).rejects.toThrow(ConflictError);
  });

  it('allows the in-progress half-hour slot (15:30 at 15:40, MEL-024)', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([]);
    db._select.where.mockResolvedValueOnce([{ total: 0 }]);
    db._insert.returning.mockResolvedValue([SEED.reservation]);

    const result = await service.create(USER_ID, 'professor', SEED.space.department, {
      spaceId: SPACE_ID,
      date: '2099-06-15',
      startTime: '15:30',
      endTime: '16:30',
    });

    expect(result).toMatchObject({ id: SEED.reservation.id });
  });

  it('allows a future hour today', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([]);
    db._select.where.mockResolvedValueOnce([{ total: 0 }]);
    db._insert.returning.mockResolvedValue([SEED.reservation]);

    const result = await service.create(USER_ID, 'professor', SEED.space.department, {
      spaceId: SPACE_ID,
      date: '2099-06-15',
      startTime: '16:00',
      endTime: '17:00',
    });

    expect(result).toMatchObject({ id: SEED.reservation.id });
  });

  it('ignores the clock for future dates', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([]);
    db._select.where.mockResolvedValueOnce([{ total: 0 }]);
    db._insert.returning.mockResolvedValue([SEED.reservation]);

    const result = await service.create(USER_ID, 'professor', SEED.space.department, {
      spaceId: SPACE_ID,
      date: '2099-06-16',
      startTime: '07:00',
      endTime: '08:00',
    });

    expect(result).toMatchObject({ id: SEED.reservation.id });
  });
});

describe('ReservationService.cancel', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: ReservationService;

  beforeEach(() => {
    db = createMockDb();
    service = new ReservationService(db);
    db._update.returning.mockResolvedValue([{ ...SEED.reservation, status: 'canceled' }]);
    db._insert.returning.mockResolvedValue([{}]); // for audit log / notification inserts
  });

  it('throws NotFoundError when reservation does not exist', async () => {
    db.query.reservations.findFirst.mockResolvedValue(undefined);

    await expect(service.cancel('no-such-id', USER_ID, 'professor')).rejects.toThrow(NotFoundError);
  });

  it('throws AppError(ALREADY_CANCELED) when reservation is already canceled', async () => {
    db.query.reservations.findFirst.mockResolvedValue({ ...SEED.reservation, status: 'canceled' });

    const err = await service.cancel(SEED.reservation.id, USER_ID, 'professor').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('ALREADY_CANCELED');
  });

  it("throws ForbiddenError when student tries to cancel another user's reservation", async () => {
    db.query.reservations.findFirst.mockResolvedValue(SEED.reservation); // owned by USER_ID

    await expect(
      service.cancel(SEED.reservation.id, OTHER_USER_ID, 'student')
    ).rejects.toThrow(ForbiddenError);
  });

  it('throws ForbiddenError when maintenance role tries to cancel', async () => {
    db.query.reservations.findFirst.mockResolvedValue(SEED.reservation);

    await expect(
      service.cancel(SEED.reservation.id, USER_ID, 'maintenance')
    ).rejects.toThrow(ForbiddenError);
  });

  it('allows a student to cancel their own reservation', async () => {
    db.query.reservations.findFirst.mockResolvedValue(SEED.reservation); // owned by USER_ID

    const result = await service.cancel(SEED.reservation.id, USER_ID, 'student');
    expect(result).toMatchObject({ status: 'canceled' });
  });

  it("throws ForbiddenError when a professor tries to cancel someone else's reservation (MEL-023)", async () => {
    db.query.reservations.findFirst.mockResolvedValue(SEED.reservation); // owned by USER_ID

    await expect(
      service.cancel(SEED.reservation.id, OTHER_USER_ID, 'professor')
    ).rejects.toThrow(ForbiddenError);
    expect(db._update.fn).not.toHaveBeenCalled();
  });

  it('allows a professor to cancel their own reservation', async () => {
    db.query.reservations.findFirst.mockResolvedValue(SEED.reservation); // owned by USER_ID

    const result = await service.cancel(SEED.reservation.id, USER_ID, 'professor');
    expect(result).toMatchObject({ status: 'canceled' });
  });

  it("lets staff cancel someone else's reservation and notifies the owner", async () => {
    // Reservation owned by USER_ID, canceled by OTHER_USER_ID (staff)
    db.query.reservations.findFirst.mockResolvedValue(SEED.reservation);
    db._insert.returning.mockResolvedValue([{}]);

    const result = await service.cancel(SEED.reservation.id, OTHER_USER_ID, 'staff');

    expect(result).toMatchObject({ status: 'canceled' });
    expect(db._insert.values).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, type: 'canceled' })
    );
  });

  it('does NOT send a notification when a user cancels their own reservation', async () => {
    db.query.reservations.findFirst.mockResolvedValue(SEED.reservation); // userId === USER_ID
    db._insert.returning.mockResolvedValue([{}]);

    await service.cancel(SEED.reservation.id, USER_ID, 'student');

    // insert is called once for the audit log only, not twice (audit + notification)
    const callCount = db._insert.fn.mock.calls.length;
    expect(callCount).toBe(1); // audit log only
  });
});

describe('ReservationService.createRecurring', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: ReservationService;

  beforeEach(() => {
    db = createMockDb();
    service = new ReservationService(db);
    db._insert.returning.mockResolvedValue([SEED.reservation]);
  });

  it('throws ForbiddenError for student role', async () => {
    await expect(
      service.createRecurring(USER_ID, 'student', SEED.space.department, {
        spaceId: SPACE_ID,
        startDate: '2099-06-02',
        endDate: '2099-06-30',
        dayOfWeek: 1,
        startTime: START_TIME,
        endTime: END_TIME,
        description: 'Weekly',
      })
    ).rejects.toThrow(ForbiddenError);
  });

  it('throws ForbiddenError for maintenance role', async () => {
    await expect(
      service.createRecurring(USER_ID, 'maintenance', SEED.space.department, {
        spaceId: SPACE_ID,
        startDate: '2099-06-02',
        endDate: '2099-06-30',
        dayOfWeek: 1,
        startTime: START_TIME,
        endTime: END_TIME,
        description: 'Weekly',
      })
    ).rejects.toThrow(ForbiddenError);
  });

  it('throws ForbiddenError when professor creates a recurring series outside their department', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space); // dept: Ciência da Computação

    await expect(
      service.createRecurring(OTHER_USER_ID, 'professor', 'Administração', {
        spaceId: SPACE_ID,
        startDate: '2099-06-02',
        endDate: '2099-06-30',
        dayOfWeek: 1,
        startTime: START_TIME,
        endTime: END_TIME,
        description: 'Weekly',
      })
    ).rejects.toThrow(ForbiddenError);
  });

  it('throws NotFoundError when space does not exist', async () => {
    db.query.spaces.findFirst.mockResolvedValue(undefined);

    await expect(
      service.createRecurring(OTHER_USER_ID, 'professor', SEED.space.department, {
        spaceId: SPACE_ID,
        startDate: '2099-06-02',
        endDate: '2099-06-30',
        dayOfWeek: 1,
        startTime: START_TIME,
        endTime: END_TIME,
        description: 'Weekly',
      })
    ).rejects.toThrow(NotFoundError);
  });

  it('skips conflicting dates and returns created + skipped lists', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    // All slots available → no skips
    db.query.reservations.findMany.mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([]);

    const result = await service.createRecurring(OTHER_USER_ID, 'professor', SEED.space.department, {
      spaceId: SPACE_ID,
      startDate: '2099-06-02', // Monday
      endDate: '2099-06-16',   // 3 Mondays: 2, 9, 16
      dayOfWeek: 1,
      startTime: START_TIME,
      endTime: END_TIME,
      description: 'Weekly lecture',
    });

    expect(result.skipped).toHaveLength(0);
    expect(result.created.length).toBeGreaterThan(0);
    expect(result.recurrenceId).toBeTruthy();
  });

  it('allows a professor at the active-reservation cap to still create a series', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([]); // all slots free
    db.query.blockings.findMany.mockResolvedValue([]);
    // Simulate the user already holding the cap. If createRecurring still called
    // enforceActiveLimit, this would surface as a RESERVATION_LIMIT error.
    db._select.where.mockResolvedValue([{ total: 10 }]);

    const result = await service.createRecurring(OTHER_USER_ID, 'professor', SEED.space.department, {
      spaceId: SPACE_ID,
      startDate: '2099-06-02', // Monday
      endDate: '2099-06-16',   // 3 Mondays
      dayOfWeek: 1,
      startTime: START_TIME,
      endTime: END_TIME,
      description: 'Weekly lecture',
    });

    expect(result.created.length).toBeGreaterThan(0);
    expect(result.skipped).toHaveLength(0);
  });

  it('skips a date when its slot is already confirmed', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    // First occurrence: slot taken → skipped; subsequent: available
    db.query.reservations.findMany
      .mockResolvedValueOnce([SEED.reservation])
      .mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([]);

    const result = await service.createRecurring(OTHER_USER_ID, 'professor', SEED.space.department, {
      spaceId: SPACE_ID,
      startDate: '2099-06-02',
      endDate: '2099-06-16',
      dayOfWeek: 1,
      startTime: START_TIME,
      endTime: END_TIME,
      description: 'Weekly lecture',
    });

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe('Faixa de horário indisponível');
  });
});

describe('ReservationService.listForAdmin', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: ReservationService;

  beforeEach(() => {
    db = createMockDb();
    service = new ReservationService(db);
  });

  it('returns paginated reservations using SQL limit and offset', async () => {
    db.query.reservations.findMany.mockResolvedValue([SEED.reservation]);
    db._select.where.mockResolvedValueOnce([{ total: 1 }]);

    const result = await service.listForAdmin({ page: 1, limit: 20 });

    expect(result).toEqual({
      data: [SEED.reservation],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    expect(db.query.reservations.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: undefined,
      limit: 20,
      offset: 0,
    }));
  });

  it('passes status filters through SQL and offsets page 2', async () => {
    db.query.reservations.findMany.mockResolvedValue([]);
    db._select.where.mockResolvedValueOnce([{ total: 0 }]);

    await service.listForAdmin({ status: 'confirmed', page: 2, limit: 10 });

    const args = db.query.reservations.findMany.mock.calls[0][0];
    expect(args.where).toBeDefined();
    expect(args.offset).toBe(10);
    expect(db._select.where).toHaveBeenCalledWith(args.where);
  });
});

describe('ReservationService.cancelSeries', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: ReservationService;

  beforeEach(() => {
    db = createMockDb();
    service = new ReservationService(db);
    db._insert.returning.mockResolvedValue([{}]);
    db._update.returning.mockResolvedValue([
      { ...SEED.reservation, recurrenceId: 'series-1', status: 'canceled' },
      { ...SEED.reservation, id: 'r-2', date: '2099-06-22', recurrenceId: 'series-1', status: 'canceled' },
    ]);
  });

  it('throws NotFoundError when the series does not exist', async () => {
    db.query.reservations.findMany.mockResolvedValue([]);

    await expect(service.cancelSeries('missing-series', OTHER_USER_ID, 'staff')).rejects.toThrow(NotFoundError);
  });

  it('cancels only upcoming confirmed reservations in a recurring series', async () => {
    db.query.reservations.findMany.mockResolvedValue([
      { ...SEED.reservation, recurrenceId: 'series-1', recurrence: { id: 'series-1', description: 'Aula semanal' }, space: SEED.space },
      { ...SEED.reservation, id: 'r-2', date: '2099-06-22', recurrenceId: 'series-1', recurrence: { id: 'series-1', description: 'Aula semanal' }, space: SEED.space },
    ]);

    const result = await service.cancelSeries('series-1', OTHER_USER_ID, 'staff');

    expect(result).toHaveLength(2);
    expect(db._update.fn).toHaveBeenCalled();
  });

  it('throws ALREADY_CANCELED when all upcoming reservations are already canceled', async () => {
    db.query.reservations.findMany.mockResolvedValue([
      { ...SEED.reservation, date: '2020-01-01', recurrenceId: 'series-1', status: 'confirmed', recurrence: null, space: SEED.space },
      { ...SEED.reservation, id: 'r-2', date: '2020-01-08', recurrenceId: 'series-1', status: 'confirmed', recurrence: null, space: SEED.space },
    ]);

    const err = await service.cancelSeries('series-1', OTHER_USER_ID, 'staff').catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('ALREADY_CANCELED');
  });

  it('throws ForbiddenError when a student tries to cancel a series', async () => {
    db.query.reservations.findMany.mockResolvedValue([
      { ...SEED.reservation, recurrenceId: 'series-1', recurrence: { id: 'series-1', description: 'Aula', createdBy: OTHER_USER_ID, requesterUserId: null }, space: SEED.space },
    ]);

    await expect(service.cancelSeries('series-1', USER_ID, 'student')).rejects.toThrow(ForbiddenError);
    expect(db._update.fn).not.toHaveBeenCalled();
  });

  it("throws ForbiddenError when a professor cancels someone else's series (MEL-023)", async () => {
    db.query.reservations.findMany.mockResolvedValue([
      { ...SEED.reservation, recurrenceId: 'series-1', recurrence: { id: 'series-1', description: 'Aula', createdBy: USER_ID }, space: SEED.space },
    ]);

    await expect(service.cancelSeries('series-1', OTHER_USER_ID, 'professor')).rejects.toThrow(ForbiddenError);
    expect(db._update.fn).not.toHaveBeenCalled();
  });

  it('lets a professor cancel their own series (MEL-023)', async () => {
    db.query.reservations.findMany.mockResolvedValue([
      { ...SEED.reservation, recurrenceId: 'series-1', recurrence: { id: 'series-1', description: 'Aula', createdBy: USER_ID }, space: SEED.space },
    ]);

    await expect(service.cancelSeries('series-1', USER_ID, 'professor')).resolves.toHaveLength(2);
  });

  it('throws ForbiddenError when maintenance tries to cancel a series', async () => {
    await expect(service.cancelSeries('series-1', USER_ID, 'maintenance')).rejects.toThrow(ForbiddenError);
  });
});

describe('ReservationService.update (MEL-023)', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: ReservationService;
  const DEPT = SEED.space.department;

  beforeEach(() => {
    db = createMockDb();
    service = new ReservationService(db);
    db.query.reservations.findFirst.mockResolvedValue(SEED.reservation); // owned by USER_ID, 2099-06-15 09:00–10:00
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([]);
    db._update.returning.mockImplementation(async () => [
      { ...SEED.reservation, ...db._update.set.mock.calls.at(-1)?.[0] },
    ]);
  });

  afterEach(() => vi.useRealTimers());

  it('lets the owner move the reservation to another time and keeps it confirmed', async () => {
    const result = await service.update(SEED.reservation.id, USER_ID, 'professor', DEPT, {
      startTime: '14:00',
      endTime: '15:30',
      description: 'Banca de TCC',
    });

    expect(result).toMatchObject({ startTime: '14:00', endTime: '15:30', status: 'confirmed', description: 'Banca de TCC' });
    const set = db._update.set.mock.calls[0][0];
    expect(set).toMatchObject({ date: DATE, startTime: '14:00', endTime: '15:30', timeSlot: 'afternoon' });
    expect(set).not.toHaveProperty('status');
    expect(set).not.toHaveProperty('spaceId');
    expect(set).not.toHaveProperty('recurrenceId');
  });

  it('keeps a recurring occurrence attached to its series', async () => {
    const occurrence = { ...SEED.reservation, recurrenceId: 'series-1' };
    db.query.reservations.findFirst.mockResolvedValue(occurrence);
    db._update.returning.mockImplementation(async () => [
      { ...occurrence, ...db._update.set.mock.calls.at(-1)?.[0] },
    ]);

    const result = await service.update(SEED.reservation.id, USER_ID, 'professor', DEPT, { startTime: '11:00', endTime: '12:00' });

    expect(result).toMatchObject({ recurrenceId: 'series-1', startTime: '11:00' });
    expect(db._update.set.mock.calls[0][0]).not.toHaveProperty('recurrenceId');
  });

  it('treats the reservation itself as free when checking conflicts', async () => {
    db.query.reservations.findMany.mockResolvedValue([SEED.reservation]); // 09:00–10:00, same id

    await expect(
      service.update(SEED.reservation.id, USER_ID, 'professor', DEPT, { startTime: '09:30', endTime: '10:30' })
    ).resolves.toMatchObject({ startTime: '09:30', endTime: '10:30' });
  });

  it('throws ConflictError (409) when the new range overlaps another reservation', async () => {
    db.query.reservations.findMany.mockResolvedValue([
      SEED.reservation,
      { ...SEED.reservation, id: 'other-reservation', userId: OTHER_USER_ID, startTime: '10:00', endTime: '11:00' },
    ]);

    const err = await service
      .update(SEED.reservation.id, USER_ID, 'professor', DEPT, { startTime: '09:30', endTime: '10:30' })
      .catch((e) => e);

    expect(err).toBeInstanceOf(ConflictError);
    expect((err as AppError).statusCode).toBe(409);
    expect(db._update.fn).not.toHaveBeenCalled();
  });

  it('throws ConflictError when the new range hits an active blocking', async () => {
    db.query.blockings.findMany.mockResolvedValue([SEED.blocking]); // 08:00–09:00

    await expect(
      service.update(SEED.reservation.id, USER_ID, 'professor', DEPT, { startTime: '08:00', endTime: '09:00' })
    ).rejects.toThrow(ConflictError);
  });

  it('throws ConflictError when the new range falls within closed hours', async () => {
    await expect(
      service.update(SEED.reservation.id, USER_ID, 'professor', DEPT, { startTime: '22:00', endTime: '23:00' })
    ).rejects.toThrow(ConflictError);
  });

  it('throws ConflictError (409) for a reservation that already happened', async () => {
    db.query.reservations.findFirst.mockResolvedValue({ ...SEED.reservation, date: '2020-01-01' });

    const err = await service
      .update(SEED.reservation.id, USER_ID, 'professor', DEPT, { description: 'x' })
      .catch((e) => e);

    expect(err).toBeInstanceOf(ConflictError);
    expect(db._update.fn).not.toHaveBeenCalled();
  });

  it('throws ConflictError (409) for a reservation in progress', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2099-06-15T12:30:00Z')); // 09:30 in Fortaleza, inside 09:00–10:00

    await expect(
      service.update(SEED.reservation.id, USER_ID, 'professor', DEPT, { description: 'x' })
    ).rejects.toThrow(ConflictError);
  });

  it('throws ConflictError (409) for a canceled reservation', async () => {
    db.query.reservations.findFirst.mockResolvedValue({ ...SEED.reservation, status: 'canceled' });

    await expect(
      service.update(SEED.reservation.id, USER_ID, 'professor', DEPT, { description: 'x' })
    ).rejects.toThrow(ConflictError);
  });

  it('throws a 400 when the merged range is shorter than 1 hour', async () => {
    // Only startTime changes: 09:30 with the stored 10:00 end lasts 30 minutes.
    const err = await service
      .update(SEED.reservation.id, USER_ID, 'professor', DEPT, { startTime: '09:30' })
      .catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(400);
  });

  it('throws a 400 when the merged end is not after the start', async () => {
    const err = await service
      .update(SEED.reservation.id, USER_ID, 'professor', DEPT, { startTime: '11:00' })
      .catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(400);
  });

  it('throws NotFoundError when the reservation does not exist', async () => {
    db.query.reservations.findFirst.mockResolvedValue(undefined);

    await expect(
      service.update('missing', USER_ID, 'professor', DEPT, { description: 'x' })
    ).rejects.toThrow(NotFoundError);
  });

  it.each(['student', 'professor'])("throws ForbiddenError (403) when a %s edits someone else's reservation", async (role) => {
    const err = await service
      .update(SEED.reservation.id, OTHER_USER_ID, role, DEPT, { description: 'x' })
      .catch((e) => e);

    expect(err).toBeInstanceOf(ForbiddenError);
    expect((err as AppError).statusCode).toBe(403);
    expect(db._update.fn).not.toHaveBeenCalled();
  });

  it('throws ForbiddenError when maintenance edits a reservation', async () => {
    await expect(
      service.update(SEED.reservation.id, OTHER_USER_ID, 'maintenance', DEPT, { description: 'x' })
    ).rejects.toThrow(ForbiddenError);
  });

  it("lets staff edit anyone's reservation, even outside their department", async () => {
    await expect(
      service.update(SEED.reservation.id, OTHER_USER_ID, 'staff', 'Administração', { date: '2099-06-16' })
    ).resolves.toMatchObject({ date: '2099-06-16' });
  });

  it('keeps the department check for students and professors', async () => {
    await expect(
      service.update(SEED.reservation.id, USER_ID, 'student', 'Administração', { description: 'x' })
    ).rejects.toThrow(ForbiddenError);
  });

  it('notifies the owner with type "modified" when someone else edits', async () => {
    await service.update(SEED.reservation.id, OTHER_USER_ID, 'staff', DEPT, { startTime: '14:00', endTime: '15:00' });

    expect(db._insert.values).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, type: 'modified' })
    );
  });

  it('does not notify the owner when they edit their own reservation', async () => {
    await service.update(SEED.reservation.id, USER_ID, 'professor', DEPT, { startTime: '14:00', endTime: '15:00' });

    expect(db._insert.values).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'modified' }));
  });

  it('writes an update_reservation audit entry with the from → to change', async () => {
    await service.update(SEED.reservation.id, USER_ID, 'professor', DEPT, { date: '2099-06-16', startTime: '14:00', endTime: '15:00' });

    const audit = db._insert.values.mock.calls
      .map(([values]) => values)
      .find((values) => values.actionType === 'update_reservation');
    expect(audit).toBeDefined();
    expect(audit.referenceId).toBe(SEED.reservation.id);
    expect(audit.details).toContain('2099-06-15 09:00-10:00');
    expect(audit.details).toContain('2099-06-16 14:00-15:00');
    expect(audit.details).toContain('→');
  });

  it('throws ConflictError when the confirmed slot unique index rejects the update', async () => {
    db._update.returning.mockRejectedValueOnce(new Error('D1_ERROR: UNIQUE constraint failed: reservations.space_id'));

    await expect(
      service.update(SEED.reservation.id, USER_ID, 'professor', DEPT, { startTime: '14:00', endTime: '15:00' })
    ).rejects.toThrow(ConflictError);
  });
});

describe('ReservationService.getSeriesImpact', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: ReservationService;

  beforeEach(() => {
    db = createMockDb();
    service = new ReservationService(db);
  });

  it('counts only future confirmed occurrences and reports the earliest future date', async () => {
    db.query.reservations.findMany.mockResolvedValue([
      // past confirmed — ignored
      { ...SEED.reservation, id: 'r-past', date: '2020-01-06', status: 'confirmed', recurrenceId: 'series-1' },
      // future confirmed (out of order to verify sorting)
      { ...SEED.reservation, id: 'r-future-2', date: '2099-06-29', status: 'confirmed', recurrenceId: 'series-1' },
      { ...SEED.reservation, id: 'r-future-1', date: '2099-06-22', status: 'confirmed', recurrenceId: 'series-1' },
      // future canceled — ignored
      { ...SEED.reservation, id: 'r-canceled', date: '2099-07-06', status: 'canceled', recurrenceId: 'series-1' },
    ]);

    const result = await service.getSeriesImpact('series-1');

    expect(result).toEqual({ futureCount: 2, firstDate: '2099-06-22' });
  });

  it('throws NotFoundError when the series does not exist', async () => {
    db.query.reservations.findMany.mockResolvedValue([]);

    await expect(service.getSeriesImpact('missing-series')).rejects.toThrow(NotFoundError);
  });
});

// ─── MEL-025: reserve on behalf of someone else ─────────────────────────────

const STAFF_ID = SEED.user.id; // Carlos Oliveira, staff
const REQUESTER_ID = OTHER_USER_ID;
const STAFF_USER = { ...SEED.user, disabledAt: null, deletedAt: null };
const REQUESTER_USER = {
  ...SEED.user,
  id: REQUESTER_ID,
  name: 'Dra. Maria Costa',
  role: 'professor',
  email: 'maria.costa@ufc.br',
  disabledAt: null,
  deletedAt: null,
};

/** The users the service loads by id (requester and acting staff). */
function mockUsers(db: ReturnType<typeof createMockDb>, ...rows: Array<Record<string, unknown>>) {
  db.query.users.findMany.mockResolvedValue(rows);
}

const dialect = new SQLiteSyncDialect();
const toSql = (where: unknown) => dialect.sqlToQuery(where as SQL).sql;

function insertedValues(db: ReturnType<typeof createMockDb>) {
  return db._insert.values.mock.calls.map(([values]) => values);
}

function notifications(db: ReturnType<typeof createMockDb>) {
  return insertedValues(db).filter((v) => 'title' in v && 'message' in v);
}

describe('ReservationService.create — on behalf of someone (MEL-025)', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: ReservationService;
  const base = { spaceId: SPACE_ID, date: DATE, startTime: START_TIME, endTime: END_TIME };

  beforeEach(() => {
    db = createMockDb();
    service = new ReservationService(db);
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([]);
    db._insert.returning.mockImplementation(async () => [insertedValues(db).at(-1)]);
    mockUsers(db, STAFF_USER, REQUESTER_USER);
  });

  it('keeps staff as the owner and records a registered requester', async () => {
    const result = await service.create(STAFF_ID, 'staff', 'Administração', {
      ...base,
      requesterUserId: REQUESTER_ID,
      requesterContact: 'maria@ufc.br',
    });

    expect(result).toMatchObject({
      userId: STAFF_ID,
      createdBy: STAFF_ID,
      requesterUserId: REQUESTER_ID,
      requesterName: null,
      requesterContact: 'maria@ufc.br',
    });
  });

  it('records a free-text requester', async () => {
    const result = await service.create(STAFF_ID, 'staff', 'Administração', {
      ...base,
      requesterName: 'Coordenação do CAU',
    });

    expect(result).toMatchObject({
      userId: STAFF_ID,
      createdBy: STAFF_ID,
      requesterUserId: null,
      requesterName: 'Coordenação do CAU',
      requesterContact: null,
    });
  });

  it('records created_by on a plain reservation too', async () => {
    const result = await service.create(USER_ID, 'professor', SEED.space.department, base);
    expect(result).toMatchObject({ userId: USER_ID, createdBy: USER_ID, requesterUserId: null, requesterName: null });
  });

  it.each(['student', 'professor'])('rejects requester fields from a %s with 403', async (role) => {
    for (const fields of [{ requesterUserId: REQUESTER_ID }, { requesterName: 'Fulano' }, { requesterContact: 'x' }]) {
      const err = await service.create(USER_ID, role, SEED.space.department, { ...base, ...fields }).catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenError);
    }
    expect(db._insert.fn).not.toHaveBeenCalled();
  });

  it.each([
    ['does not exist', undefined],
    ['is disabled', { ...REQUESTER_USER, disabledAt: '2026-01-01T00:00:00.000Z' }],
    ['is deleted', { ...REQUESTER_USER, deletedAt: '2026-01-01T00:00:00.000Z' }],
    ['is maintenance', { ...REQUESTER_USER, role: 'maintenance' }],
  ])('rejects a requester that %s with 400', async (_label, requester) => {
    mockUsers(db, STAFF_USER, ...(requester ? [requester] : []));

    const err = await service
      .create(STAFF_ID, 'staff', 'Administração', { ...base, requesterUserId: REQUESTER_ID })
      .catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(400);
    expect((err as AppError).code).toBe('INVALID_REQUESTER');
    expect(db._insert.fn).not.toHaveBeenCalled();
  });

  it('rejects staff naming themselves as the requester with 400', async () => {
    const err = await service
      .create(STAFF_ID, 'staff', 'Administração', { ...base, requesterUserId: STAFF_ID })
      .catch((e) => e);
    expect((err as AppError).statusCode).toBe(400);
  });

  it('notifies the registered requester and audits "<staff> reservou <sala> para <solicitante>"', async () => {
    await service.create(STAFF_ID, 'staff', 'Administração', { ...base, requesterUserId: REQUESTER_ID });

    expect(notifications(db)).toContainEqual(
      expect.objectContaining({ userId: REQUESTER_ID, type: 'confirmed', message: expect.stringContaining('Carlos Oliveira') })
    );
    const audit = insertedValues(db).find((v) => v.actionType === 'create_reservation');
    expect(audit.details).toContain('Carlos Oliveira reservou o espaço A101');
    expect(audit.details).toContain('para Dra. Maria Costa');
  });

  it('audits a free-text requester and notifies nobody else', async () => {
    await service.create(STAFF_ID, 'staff', 'Administração', { ...base, requesterName: 'Coordenação do CAU' });

    const audit = insertedValues(db).find((v) => v.actionType === 'create_reservation');
    expect(audit.details).toContain('para Coordenação do CAU');
    expect(notifications(db).map((n) => n.userId)).toEqual([STAFF_ID]);
  });
});

describe('ReservationService.createRecurring — on behalf of someone (MEL-025)', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: ReservationService;
  const base = {
    spaceId: SPACE_ID,
    startDate: '2099-06-01',
    endDate: '2099-06-30',
    dayOfWeek: 1,
    startTime: START_TIME,
    endTime: END_TIME,
    description: 'Aula de Projeto',
  };

  beforeEach(() => {
    db = createMockDb();
    service = new ReservationService(db);
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([]);
    db._insert.returning.mockImplementation(async () => [insertedValues(db).at(-1)]);
    mockUsers(db, STAFF_USER, REQUESTER_USER);
  });

  it('stores the requester on the series and on every occurrence', async () => {
    const result = await service.createRecurring(STAFF_ID, 'staff', 'Administração', {
      ...base,
      requesterUserId: REQUESTER_ID,
      requesterContact: 'maria@ufc.br',
    });

    const recurrence = insertedValues(db).find((v) => v.id === result.recurrenceId);
    expect(recurrence).toMatchObject({ createdBy: STAFF_ID, requesterUserId: REQUESTER_ID, requesterContact: 'maria@ufc.br' });
    expect(result.created.length).toBeGreaterThan(0);
    for (const reservation of result.created) {
      expect(reservation).toMatchObject({ userId: STAFF_ID, createdBy: STAFF_ID, requesterUserId: REQUESTER_ID, requesterName: null });
    }
  });

  it('stores a free-text requester on the series', async () => {
    const result = await service.createRecurring(STAFF_ID, 'staff', 'Administração', { ...base, requesterName: 'Centro Acadêmico' });

    const recurrence = insertedValues(db).find((v) => v.id === result.recurrenceId);
    expect(recurrence).toMatchObject({ requesterUserId: null, requesterName: 'Centro Acadêmico' });
    expect(result.created[0]).toMatchObject({ requesterName: 'Centro Acadêmico' });
  });

  it('rejects requester fields from a professor with 403', async () => {
    await expect(
      service.createRecurring(OTHER_USER_ID, 'professor', SEED.space.department, { ...base, requesterName: 'Fulano' })
    ).rejects.toThrow(ForbiddenError);
    expect(db._insert.fn).not.toHaveBeenCalled();
  });

  it('rejects an inactive requester with 400', async () => {
    mockUsers(db, STAFF_USER, { ...REQUESTER_USER, disabledAt: '2026-01-01T00:00:00.000Z' });

    const err = await service
      .createRecurring(STAFF_ID, 'staff', 'Administração', { ...base, requesterUserId: REQUESTER_ID })
      .catch((e) => e);
    expect((err as AppError).statusCode).toBe(400);
    expect(db._insert.fn).not.toHaveBeenCalled();
  });

  it('notifies the requester once and audits the series for them', async () => {
    await service.createRecurring(STAFF_ID, 'staff', 'Administração', { ...base, requesterUserId: REQUESTER_ID });

    const toRequester = notifications(db).filter((n) => n.userId === REQUESTER_ID);
    expect(toRequester).toHaveLength(1);
    expect(toRequester[0]).toMatchObject({ type: 'confirmed' });
    const audit = insertedValues(db).find((v) => v.actionType === 'create_recurring_reservation');
    expect(audit.details).toContain('Carlos Oliveira reservou');
    expect(audit.details).toContain('para Dra. Maria Costa');
  });
});

describe('ReservationService — registered requester rights and notifications (MEL-025)', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: ReservationService;
  const DEPT = SEED.space.department;
  const onBehalf = { ...SEED.reservation, userId: STAFF_ID, createdBy: STAFF_ID, requesterUserId: REQUESTER_ID, requesterName: null };

  beforeEach(() => {
    db = createMockDb();
    service = new ReservationService(db);
    db.query.reservations.findFirst.mockResolvedValue(onBehalf);
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([]);
    db._update.returning.mockImplementation(async () => [{ ...onBehalf, ...db._update.set.mock.calls.at(-1)?.[0] }]);
    mockUsers(db, STAFF_USER, REQUESTER_USER);
  });

  it('lets the requester cancel and notifies the staff owner', async () => {
    await expect(service.cancel(onBehalf.id, REQUESTER_ID, 'professor')).resolves.toMatchObject({ status: 'canceled' });
    expect(notifications(db)).toContainEqual(expect.objectContaining({ userId: STAFF_ID, type: 'canceled' }));
    expect(notifications(db).some((n) => n.userId === REQUESTER_ID)).toBe(false);
  });

  it('does not let the requester edit (403)', async () => {
    await expect(
      service.update(onBehalf.id, REQUESTER_ID, 'professor', DEPT, { description: 'x' })
    ).rejects.toThrow(ForbiddenError);
    expect(db._update.fn).not.toHaveBeenCalled();
  });

  it('notifies the requester when staff edits the reservation', async () => {
    await service.update(onBehalf.id, STAFF_ID, 'staff', 'Administração', { startTime: '14:00', endTime: '15:00' });

    expect(notifications(db)).toContainEqual(
      expect.objectContaining({ userId: REQUESTER_ID, type: 'modified', message: expect.stringContaining('A101') })
    );
  });

  it('notifies the requester when staff cancels the reservation', async () => {
    await service.cancel(onBehalf.id, STAFF_ID, 'staff', 'Sala interditada');

    expect(notifications(db)).toContainEqual(
      expect.objectContaining({ userId: REQUESTER_ID, type: 'canceled', message: expect.stringContaining('Sala interditada') })
    );
  });

  it('does not notify a free-text requester (no account)', async () => {
    db.query.reservations.findFirst.mockResolvedValue({ ...onBehalf, requesterUserId: null, requesterName: 'Fulano' });

    await service.cancel(onBehalf.id, STAFF_ID, 'staff');
    expect(notifications(db)).toHaveLength(0);
  });

  describe('series', () => {
    const series = (overrides: Record<string, unknown> = {}) => [
      {
        ...onBehalf,
        recurrenceId: 'series-1',
        recurrence: { id: 'series-1', description: 'Aula', createdBy: STAFF_ID, requesterUserId: REQUESTER_ID },
        space: SEED.space,
        ...overrides,
      },
      {
        ...onBehalf,
        id: 'r-2',
        date: '2099-06-22',
        recurrenceId: 'series-1',
        recurrence: { id: 'series-1', description: 'Aula', createdBy: STAFF_ID, requesterUserId: REQUESTER_ID },
        space: SEED.space,
        ...overrides,
      },
    ];

    beforeEach(() => {
      db._update.returning.mockResolvedValue([{ ...onBehalf, status: 'canceled' }]);
    });

    it.each(['student', 'professor'])('lets a %s requester cancel the series', async (role) => {
      db.query.reservations.findMany.mockResolvedValue(series());

      await expect(service.cancelSeries('series-1', REQUESTER_ID, role)).resolves.toBeDefined();
      expect(db._update.fn).toHaveBeenCalled();
    });

    it('notifies the requester once when staff cancels the series', async () => {
      db.query.reservations.findMany.mockResolvedValue(series());

      await service.cancelSeries('series-1', STAFF_ID, 'staff');

      const toRequester = notifications(db).filter((n) => n.userId === REQUESTER_ID);
      expect(toRequester).toHaveLength(1);
      expect(toRequester[0]).toMatchObject({ type: 'canceled', message: expect.stringContaining('2 reservas') });
    });

    it('does not let another student cancel the series', async () => {
      db.query.reservations.findMany.mockResolvedValue(series());

      await expect(service.cancelSeries('series-1', USER_ID, 'student')).rejects.toThrow(ForbiddenError);
    });
  });
});

describe('ReservationService.listByUser (MEL-025)', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: ReservationService;

  beforeEach(() => {
    db = createMockDb();
    service = new ReservationService(db);
  });

  it('includes reservations where I am the registered requester, with stable ordering and pagination', async () => {
    db.query.reservations.findMany.mockResolvedValue([]);

    await service.listByUser(REQUESTER_ID, 'professor', 2, 10);

    const args = db.query.reservations.findMany.mock.calls[0][0];
    expect(toSql(args.where)).toMatch(/"user_id" = \? or .*"requester_user_id" = \?/);
    expect(args.limit).toBe(10);
    expect(args.offset).toBe(10);
    expect(args.orderBy).toBeTypeOf('function');
  });

  it('marks reservations made for me and hides the contact from non-staff', async () => {
    db.query.reservations.findMany.mockResolvedValue([
      {
        ...SEED.reservation,
        userId: STAFF_ID,
        createdBy: STAFF_ID,
        requesterUserId: REQUESTER_ID,
        requesterName: null,
        requesterContact: 'maria@ufc.br',
        creator: { id: STAFF_ID, name: 'Carlos Oliveira' },
        requester: { id: REQUESTER_ID, name: 'Dra. Maria Costa' },
        space: SEED.space,
      },
    ]);

    const [row] = await service.listByUser(REQUESTER_ID, 'professor', 1, 20);

    expect(row).toMatchObject({
      onBehalfOfMe: true,
      registeredBy: { id: STAFF_ID, name: 'Carlos Oliveira' },
      requester: { userId: REQUESTER_ID, name: 'Dra. Maria Costa' },
    });
    expect(row).not.toHaveProperty('requesterContact');
  });

  it('shows staff the requester and contact of reservations they registered', async () => {
    db.query.reservations.findMany.mockResolvedValue([
      {
        ...SEED.reservation,
        userId: STAFF_ID,
        createdBy: STAFF_ID,
        requesterUserId: null,
        requesterName: 'Coordenação do CAU',
        requesterContact: '85 3366-0000',
        creator: { id: STAFF_ID, name: 'Carlos Oliveira' },
        requester: null,
        space: SEED.space,
      },
    ]);

    const [row] = await service.listByUser(STAFF_ID, 'staff', 1, 20);

    expect(row).toMatchObject({
      onBehalfOfMe: false,
      requester: { userId: null, name: 'Coordenação do CAU' },
      requesterContact: '85 3366-0000',
    });
  });
});
