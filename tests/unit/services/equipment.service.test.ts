import { beforeEach, describe, expect, it } from 'vitest';
import { EquipmentService } from '@/services/equipment.service';
import { ConflictError, NotFoundError } from '@/middleware/error-handler';
import { createMockDb, SEED } from '../helpers/mock-db';

describe('EquipmentService.create', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: EquipmentService;

  beforeEach(() => {
    db = createMockDb();
    service = new EquipmentService(db);
    db._insert.returning.mockResolvedValue([SEED.equipment]);
  });

  it('throws NotFoundError when the space does not exist', async () => {
    db.query.spaces.findFirst.mockResolvedValue(undefined);

    await expect(
      service.create('user-1', {
        assetId: '2020002660',
        spaceId: SEED.space.id,
        name: 'Datashow',
        type: 'projector',
        status: 'working',
      })
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ConflictError when the asset ID already exists', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.equipment.findFirst.mockResolvedValue(SEED.equipment);

    await expect(
      service.create('user-1', {
        assetId: SEED.equipment.assetId,
        spaceId: SEED.space.id,
        name: 'Datashow',
        type: 'projector',
        status: 'working',
      })
    ).rejects.toThrow(ConflictError);
  });

  it('creates equipment when the asset ID is unique', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.equipment.findFirst.mockResolvedValue(undefined);
    db._insert.returning.mockResolvedValue([
      { ...SEED.equipment, assetId: '2020002660', name: 'Datashow' },
    ]);

    const result = await service.create('user-1', {
      assetId: '2020002660',
      spaceId: SEED.space.id,
      name: 'Datashow',
      type: 'projector',
      status: 'working',
    });

    expect(result.assetId).toBe('2020002660');
    expect(result.name).toBe('Datashow');
  });
});
