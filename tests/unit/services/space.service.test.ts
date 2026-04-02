import { describe, it, expect, beforeEach } from 'vitest';
import { SpaceService } from '@/services/space.service';
import { NotFoundError } from '@/middleware/error-handler';
import { createMockDb, SEED } from '../helpers/mock-db';

describe('SpaceService.getAvailability', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: SpaceService;

  beforeEach(() => {
    db = createMockDb();
    service = new SpaceService(db);
    // Audit log insert must succeed
    db._insert.returning.mockResolvedValue([{ id: 'log-1' }]);
  });

  it('throws NotFoundError when space does not exist', async () => {
    db.query.spaces.findFirst.mockResolvedValue(undefined);
    await expect(service.getAvailability('no-such-id', '2099-06-15')).rejects.toThrow(NotFoundError);
  });

  it('returns hourly availability and marks open hours as available when no reservations or blockings exist', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([]);

    const slots = await service.getAvailability(SEED.space.id, '2099-06-15');

    expect(slots).toHaveLength(24);
    expect(slots.find((s) => s.startTime === '09:00')?.status).toBe('available');
    expect(slots.find((s) => s.startTime === '23:00')?.status).toBe('closed');
  });

  it('marks an hourly interval as reserved when a confirmed reservation exists', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([SEED.reservation]); // morning confirmed
    db.query.blockings.findMany.mockResolvedValue([]);

    const slots = await service.getAvailability(SEED.space.id, '2099-06-15');
    const reservedHour = slots.find((s) => s.startTime === '09:00');
    const openHour = slots.find((s) => s.startTime === '11:00');

    expect(reservedHour?.status).toBe('reserved');
    expect(openHour?.status).toBe('available');
  });

  it('marks an hourly interval as blocked when an active blocking exists', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([SEED.blocking]); // morning blocked

    const slots = await service.getAvailability(SEED.space.id, '2099-06-15');
    const morning = slots.find((s) => s.startTime === '08:00');

    expect(morning?.status).toBe('blocked');
  });

  it('blocked takes priority over reserved on overlapping hourly intervals', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([SEED.reservation]);
    db.query.blockings.findMany.mockResolvedValue([{ ...SEED.blocking, startTime: '09:00', endTime: '10:00' }]);

    const slots = await service.getAvailability(SEED.space.id, '2099-06-15');
    const morning = slots.find((s) => s.startTime === '09:00');

    expect(morning?.status).toBe('blocked');
  });

  it('returns hourly slots in order', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);

    const slots = await service.getAvailability(SEED.space.id, '2099-06-15');

    expect(slots[0]?.startTime).toBe('00:00');
    expect(slots[23]?.startTime).toBe('23:00');
  });
});

describe('SpaceService.getById', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: SpaceService;

  beforeEach(() => {
    db = createMockDb();
    service = new SpaceService(db);
  });

  it('throws NotFoundError when space does not exist', async () => {
    db.query.spaces.findFirst.mockResolvedValue(undefined);
    await expect(service.getById('no-such-id')).rejects.toThrow(NotFoundError);
  });

  it('returns the space with equipment', async () => {
    const spaceWithEquipment = { ...SEED.space, equipment: [] };
    db.query.spaces.findFirst.mockResolvedValue(spaceWithEquipment);

    const result = await service.getById(SEED.space.id);
    expect(result).toEqual(spaceWithEquipment);
  });
});
