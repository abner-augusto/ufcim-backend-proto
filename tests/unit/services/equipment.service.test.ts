import { beforeEach, describe, expect, it } from 'vitest';
import { EquipmentService } from '@/services/equipment.service';
import { ConflictError, NotFoundError } from '@/middleware/error-handler';
import { equipmentStatusHistory } from '@/db/schema';
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

describe('EquipmentService.updateStatus — status history (MEL-013)', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: EquipmentService;

  beforeEach(() => {
    db = createMockDb();
    service = new EquipmentService(db);
    db.query.equipment.findFirst.mockResolvedValue({ ...SEED.equipment, status: 'working' });
    db._update.returning.mockResolvedValue([{ ...SEED.equipment, status: 'broken' }]);
  });

  it('records a manual from→to transition in the same batch as the update', async () => {
    const result = await service.updateStatus(SEED.equipment.id, 'user-1', { status: 'broken' });

    expect(result.status).toBe('broken');
    expect(db._batch).toHaveBeenCalledTimes(1);
    expect(db._insert.fn).toHaveBeenCalledWith(equipmentStatusHistory);
    expect(db._insert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        equipmentId: SEED.equipment.id,
        fromStatus: 'working',
        toStatus: 'broken',
        changedBy: 'user-1',
        source: 'manual',
      })
    );
  });

  it('does not record history when the status is unchanged (e.g. notes-only edit)', async () => {
    db._update.returning.mockResolvedValue([{ ...SEED.equipment, notes: 'novo' }]);

    await service.updateStatus(SEED.equipment.id, 'user-1', { status: 'working', notes: 'novo' });

    expect(db._insert.fn).not.toHaveBeenCalledWith(equipmentStatusHistory);
    expect(db._batch).not.toHaveBeenCalled();
  });

  it('throws NotFoundError and writes nothing when the equipment does not exist', async () => {
    db.query.equipment.findFirst.mockResolvedValue(undefined);

    await expect(
      service.updateStatus('missing', 'user-1', { status: 'broken' })
    ).rejects.toThrow(NotFoundError);
    expect(db._insert.fn).not.toHaveBeenCalled();
  });
});
