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

  it('returns all three slots as available when no reservations or blockings exist', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([]);

    const slots = await service.getAvailability(SEED.space.id, '2099-06-15');

    expect(slots).toHaveLength(3);
    expect(slots.every((s) => s.status === 'available')).toBe(true);
  });

  it('marks a slot as reserved when a confirmed reservation exists', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([SEED.reservation]); // morning confirmed
    db.query.blockings.findMany.mockResolvedValue([]);

    const slots = await service.getAvailability(SEED.space.id, '2099-06-15');
    const morning = slots.find((s) => s.timeSlot === 'morning');
    const afternoon = slots.find((s) => s.timeSlot === 'afternoon');

    expect(morning?.status).toBe('reserved');
    expect(afternoon?.status).toBe('available');
  });

  it('marks a slot as blocked when an active blocking exists', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([SEED.blocking]); // morning blocked

    const slots = await service.getAvailability(SEED.space.id, '2099-06-15');
    const morning = slots.find((s) => s.timeSlot === 'morning');

    expect(morning?.status).toBe('blocked');
  });

  it('blocked takes priority over reserved on the same slot', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    // Same slot is both reserved and blocked (edge case — e.g., reservation not yet overridden)
    db.query.reservations.findMany.mockResolvedValue([SEED.reservation]); // morning
    db.query.blockings.findMany.mockResolvedValue([SEED.blocking]);       // morning

    const slots = await service.getAvailability(SEED.space.id, '2099-06-15');
    const morning = slots.find((s) => s.timeSlot === 'morning');

    expect(morning?.status).toBe('blocked');
  });

  it('returns slots for all three time slots in order', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);

    const slots = await service.getAvailability(SEED.space.id, '2099-06-15');

    expect(slots.map((s) => s.timeSlot)).toEqual(['morning', 'afternoon', 'evening']);
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
