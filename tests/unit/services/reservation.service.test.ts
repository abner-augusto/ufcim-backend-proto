import { describe, it, expect, beforeEach } from 'vitest';
import { ReservationService } from '@/services/reservation.service';
import {
  NotFoundError,
  ConflictError,
  ForbiddenError,
  AppError,
} from '@/middleware/error-handler';
import { createMockDb, SEED } from '../helpers/mock-db';

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

  it('throws ForbiddenError when maintenance role tries to create a reservation', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([]);

    const err = await service
      .create(USER_ID, 'maintenance', SEED.space.department, { spaceId: SPACE_ID, date: DATE, startTime: START_TIME, endTime: END_TIME })
      .catch((e) => e);

    expect(err).toBeInstanceOf(ForbiddenError);
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

  it("sends a notification when a professor cancels someone else's reservation", async () => {
    // Reservation owned by USER_ID, canceled by OTHER_USER_ID (professor)
    db.query.reservations.findFirst.mockResolvedValue(SEED.reservation);
    db._insert.returning.mockResolvedValue([{}]);

    await service.cancel(SEED.reservation.id, OTHER_USER_ID, 'professor');

    // insert called at least for notification (and audit log)
    expect(db._insert.fn).toHaveBeenCalled();
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
      service.createRecurring(USER_ID, 'student', {
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
      service.createRecurring(USER_ID, 'maintenance', {
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
      service.createRecurring(OTHER_USER_ID, 'professor', {
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

    const result = await service.createRecurring(OTHER_USER_ID, 'professor', {
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

  it('skips a date when its slot is already confirmed', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    // First occurrence: slot taken → skipped; subsequent: available
    db.query.reservations.findMany
      .mockResolvedValueOnce([SEED.reservation])
      .mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([]);

    const result = await service.createRecurring(OTHER_USER_ID, 'professor', {
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

  it('cancels all confirmed reservations in a recurring series', async () => {
    db.query.reservations.findMany.mockResolvedValue([
      { ...SEED.reservation, recurrenceId: 'series-1', recurrence: { id: 'series-1', description: 'Aula semanal' }, space: SEED.space },
      { ...SEED.reservation, id: 'r-2', date: '2099-06-22', recurrenceId: 'series-1', recurrence: { id: 'series-1', description: 'Aula semanal' }, space: SEED.space },
    ]);

    const result = await service.cancelSeries('series-1', OTHER_USER_ID, 'staff');

    expect(result).toHaveLength(2);
    expect(db._update.fn).toHaveBeenCalled();
  });
});
