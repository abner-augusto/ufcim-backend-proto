import { describe, it, expect, beforeEach } from 'vitest';
import { BlockingService } from '@/services/blocking.service';
import { NotFoundError, ConflictError } from '@/middleware/error-handler';
import { createMockDb, SEED } from '../helpers/mock-db';

const STAFF_ID = SEED.blocking.createdBy;

const CREATE_INPUT = {
  spaceId: SEED.space.id,
  date: SEED.blocking.date,
  timeSlot: SEED.blocking.timeSlot,
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

    await expect(service.create(STAFF_ID, CREATE_INPUT)).rejects.toThrow(NotFoundError);
  });

  it('throws ConflictError when an active blocking already exists for the slot', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.blockings.findFirst.mockResolvedValue(SEED.blocking); // duplicate

    await expect(service.create(STAFF_ID, CREATE_INPUT)).rejects.toThrow(ConflictError);
  });

  it('creates a blocking when the slot is free', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.blockings.findFirst.mockResolvedValue(undefined);  // no duplicate
    db.query.reservations.findFirst.mockResolvedValue(undefined); // no conflicting reservation

    const result = await service.create(STAFF_ID, CREATE_INPUT);

    expect(result).toMatchObject({ id: SEED.blocking.id });
    expect(db._insert.fn).toHaveBeenCalled();
  });

  it('overrides a confirmed reservation on the same slot', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.blockings.findFirst.mockResolvedValue(undefined);
    db.query.reservations.findFirst.mockResolvedValue(SEED.reservation); // conflicting
    db._update.returning.mockResolvedValue([{ ...SEED.reservation, status: 'overridden' }]);

    await service.create(STAFF_ID, CREATE_INPUT);

    // update called to override the reservation
    expect(db._update.fn).toHaveBeenCalled();
    // notification + audit log inserts were triggered
    expect(db._insert.fn).toHaveBeenCalled();
  });

  it('sends a notification when a confirmed reservation is overridden', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.blockings.findFirst.mockResolvedValue(undefined);
    db.query.reservations.findFirst.mockResolvedValue(SEED.reservation);
    db._update.returning.mockResolvedValue([{ ...SEED.reservation, status: 'overridden' }]);
    db._insert.returning.mockResolvedValue([{}]);

    await service.create(STAFF_ID, CREATE_INPUT);

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
