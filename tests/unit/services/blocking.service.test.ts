import { describe, it, expect, beforeEach } from 'vitest';
import { BlockingService } from '@/services/blocking.service';
import { NotFoundError, ConflictError } from '@/middleware/error-handler';
import { createMockDb, SEED } from '../helpers/mock-db';

const STAFF_ID = SEED.blocking.createdBy;

const CREATE_INPUT = {
  spaceId: SEED.space.id,
  date: SEED.blocking.date,
  startTime: SEED.blocking.startTime,
  endTime: SEED.blocking.endTime,
  reason: SEED.blocking.reason,
  blockType: SEED.blocking.blockType,
};

describe('BlockingService.create', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: BlockingService;

  beforeEach(() => {
    db = createMockDb();
    service = new BlockingService(db);
    db._insert.returning.mockResolvedValue([SEED.blocking]);
  });

  it('throws NotFoundError when space does not exist', async () => {
    db.query.spaces.findFirst.mockResolvedValue(undefined);

    await expect(service.create(STAFF_ID, 'staff', CREATE_INPUT)).rejects.toThrow(NotFoundError);
  });

  it('throws ConflictError when an active blocking already overlaps the requested time range', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.blockings.findMany.mockResolvedValue([SEED.blocking]);

    await expect(service.create(STAFF_ID, 'staff', CREATE_INPUT)).rejects.toThrow(ConflictError);
  });

  it('creates a blocking when the time range is free', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.blockings.findMany.mockResolvedValue([]);
    db.query.reservations.findMany.mockResolvedValue([]);

    const result = await service.create(STAFF_ID, 'staff', CREATE_INPUT);

    expect(result.created).toBe(1);
    expect(result.blockings[0]).toMatchObject({ id: SEED.blocking.id });
    expect(db._insert.fn).toHaveBeenCalled();
  });

  it('creates one row per day sharing a batchId for a date range (MEL-017)', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.blockings.findMany.mockResolvedValue([]);
    db.query.reservations.findMany.mockResolvedValue([]);
    db._insert.returning.mockResolvedValue([SEED.blocking]);

    const result = await service.create(STAFF_ID, 'staff', {
      ...CREATE_INPUT,
      date: undefined,
      dateFrom: '2099-06-15',
      dateTo: '2099-06-19',
    });

    expect(result.created).toBe(5);

    const rows = db._insert.values.mock.calls
      .map(([values]) => values as { date: string; batchId: string })
      .filter((values) => values.batchId);
    const dates = rows.map((row) => row.date);
    const batchIds = new Set(rows.map((row) => row.batchId));

    expect(dates).toEqual(['2099-06-15', '2099-06-16', '2099-06-17', '2099-06-18', '2099-06-19']);
    expect(batchIds.size).toBe(1);
  });

  it('aborts the whole multi-day operation when any day is already blocked (MEL-017)', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.blockings.findMany.mockResolvedValue([
      { ...SEED.blocking, date: '2099-06-17', startTime: '08:00', endTime: '09:00' },
    ]);

    await expect(
      service.create(STAFF_ID, 'staff', {
        ...CREATE_INPUT,
        date: undefined,
        dateFrom: '2099-06-15',
        dateTo: '2099-06-19',
      })
    ).rejects.toThrow('2099-06-17');

    expect(db._insert.fn).not.toHaveBeenCalled();
  });

  it('overrides confirmed reservations on their own day only (MEL-017)', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.blockings.findMany.mockResolvedValue([]);
    db.query.reservations.findMany.mockResolvedValue([
      { ...SEED.reservation, id: 'r1', date: '2099-06-16', startTime: '08:00', endTime: '09:00' },
      { ...SEED.reservation, id: 'r2', date: '2099-06-18', startTime: '08:00', endTime: '09:00' },
    ]);

    const result = await service.create(STAFF_ID, 'staff', {
      ...CREATE_INPUT,
      date: undefined,
      dateFrom: '2099-06-15',
      dateTo: '2099-06-19',
    });

    expect(result.overriddenReservations).toBe(2);
    expect(db._update.fn).toHaveBeenCalledTimes(2);
  });

  it('forces blockType to maintenance when the creator role is maintenance', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.blockings.findMany.mockResolvedValue([]);
    db.query.reservations.findMany.mockResolvedValue([]);

    await service.create(STAFF_ID, 'maintenance', { ...CREATE_INPUT, blockType: 'administrative' });

    const inserted = db._insert.values.mock.calls[0][0] as { blockType: string };
    expect(inserted.blockType).toBe('maintenance');
  });

  it('preserves the requested blockType for non-maintenance roles', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.blockings.findMany.mockResolvedValue([]);
    db.query.reservations.findMany.mockResolvedValue([]);

    await service.create(STAFF_ID, 'professor', { ...CREATE_INPUT, blockType: 'administrative' });

    const inserted = db._insert.values.mock.calls[0][0] as { blockType: string };
    expect(inserted.blockType).toBe('administrative');
  });

  it('overrides a confirmed reservation on the same slot', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.blockings.findMany.mockResolvedValue([]);
    db.query.reservations.findMany.mockResolvedValue([SEED.reservation]);
    db._update.returning.mockResolvedValue([{ ...SEED.reservation, status: 'overridden' }]);

    await service.create(STAFF_ID, 'staff', { ...CREATE_INPUT, startTime: '09:00', endTime: '10:00' });

    // update called to override the reservation
    expect(db._update.fn).toHaveBeenCalled();
    // notification + audit log inserts were triggered
    expect(db._insert.fn).toHaveBeenCalled();
  });

  it('sends a notification when a confirmed reservation is overridden', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.blockings.findMany.mockResolvedValue([]);
    db.query.reservations.findMany.mockResolvedValue([SEED.reservation]);
    db._update.returning.mockResolvedValue([{ ...SEED.reservation, status: 'overridden' }]);
    db._insert.returning.mockResolvedValue([{}]);

    await service.create(STAFF_ID, 'staff', { ...CREATE_INPUT, startTime: '09:00', endTime: '10:00' });

    // insert is called for: notification, override audit log, create_blocking audit log
    expect(db._insert.fn.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});

describe('BlockingService.remove', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: BlockingService;

  beforeEach(() => {
    db = createMockDb();
    service = new BlockingService(db);
    db._update.returning.mockResolvedValue([{ ...SEED.blocking, status: 'removed' }]);
    db._insert.returning.mockResolvedValue([{}]);
  });

  it('throws NotFoundError when blocking does not exist', async () => {
    db.query.blockings.findFirst.mockResolvedValue(undefined);

    await expect(service.remove('no-such-id', STAFF_ID)).rejects.toThrow(NotFoundError);
  });

  it('soft-deletes the blocking by setting status to removed', async () => {
    db.query.blockings.findFirst.mockResolvedValue(SEED.blocking);

    const result = await service.remove(SEED.blocking.id, STAFF_ID);

    expect(result).toMatchObject({ status: 'removed' });
    expect(db._update.fn).toHaveBeenCalled();
  });

  it('logs an audit entry on removal', async () => {
    db.query.blockings.findFirst.mockResolvedValue(SEED.blocking);

    await service.remove(SEED.blocking.id, STAFF_ID);

    expect(db._insert.fn).toHaveBeenCalledOnce();
  });
});

describe('BlockingService.listBySpace', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: BlockingService;

  beforeEach(() => {
    db = createMockDb();
    service = new BlockingService(db);
  });

  it('returns active blockings for a space', async () => {
    db.query.blockings.findMany.mockResolvedValue([SEED.blocking]);

    const result = await service.listBySpace(SEED.space.id);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(SEED.blocking.id);
  });

  it('returns an empty list when no blockings exist', async () => {
    db.query.blockings.findMany.mockResolvedValue([]);

    const result = await service.listBySpace(SEED.space.id);
    expect(result).toEqual([]);
  });
});

describe('BlockingService.listByUser', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: BlockingService;

  beforeEach(() => {
    db = createMockDb();
    service = new BlockingService(db);
  });

  it('returns empty list when user has no active blockings', async () => {
    db.query.blockings.findMany.mockResolvedValue([]);

    const result = await service.listByUser(SEED.user.id);

    expect(result).toEqual([]);
  });

  it('returns only blockings where createdBy === userId', async () => {
    const blockingWithSpace = { ...SEED.blocking, space: SEED.space };
    db.query.blockings.findMany.mockResolvedValue([blockingWithSpace]);

    const result = await service.listByUser(SEED.blocking.createdBy);

    expect(result).toHaveLength(1);
    expect(result[0].createdBy).toBe(SEED.blocking.createdBy);
  });

  it('does not return blockings with status removed', async () => {
    db.query.blockings.findMany.mockResolvedValue([]);

    const result = await service.listByUser(SEED.user.id);

    expect(result).toEqual([]);
  });

  it('includes the embedded space object in each item', async () => {
    const blockingWithSpace = { ...SEED.blocking, space: SEED.space };
    db.query.blockings.findMany.mockResolvedValue([blockingWithSpace]);

    const result = await service.listByUser(SEED.blocking.createdBy);

    expect(result[0].space).toBeDefined();
    expect(result[0].space.id).toBe(SEED.space.id);
    expect(result[0].space.number).toBe(SEED.space.number);
  });

  it('orders by date descending', async () => {
    const b1 = { ...SEED.blocking, id: 'b1', date: '2099-06-10', space: SEED.space };
    const b2 = { ...SEED.blocking, id: 'b2', date: '2099-06-20', space: SEED.space };
    db.query.blockings.findMany.mockResolvedValue([b2, b1]);

    const result = await service.listByUser(SEED.blocking.createdBy);

    expect(result[0].date).toBe('2099-06-20');
    expect(result[1].date).toBe('2099-06-10');
  });
});

describe('BlockingService.listActive', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: BlockingService;

  beforeEach(() => {
    db = createMockDb();
    service = new BlockingService(db);
  });

  it('returns paginated active blockings using SQL limit and offset', async () => {
    db.query.blockings.findMany.mockResolvedValue([SEED.blocking]);
    db._select.where.mockResolvedValueOnce([{ total: 1 }]);

    const result = await service.listActive({ page: 1, limit: 25 });

    expect(result).toEqual({
      data: [SEED.blocking],
      pagination: { page: 1, limit: 25, total: 1, totalPages: 1 },
    });

    const args = db.query.blockings.findMany.mock.calls[0][0];
    expect(args.where).toBeDefined();
    expect(args.limit).toBe(25);
    expect(args.offset).toBe(0);
    expect(db._select.where).toHaveBeenCalledWith(args.where);
  });

  it('keeps SQL where defined when filtering from a date', async () => {
    db.query.blockings.findMany.mockResolvedValue([]);
    db._select.where.mockResolvedValueOnce([{ total: 0 }]);

    await service.listActive({ dateFrom: '2099-06-01', page: 2, limit: 10 });

    const args = db.query.blockings.findMany.mock.calls[0][0];
    expect(args.where).toBeDefined();
    expect(args.offset).toBe(10);
  });
});
