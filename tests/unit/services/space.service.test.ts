import { describe, it, expect, beforeEach } from 'vitest';
import { SpaceService } from '@/services/space.service';
import { ConflictError, NotFoundError } from '@/middleware/error-handler';
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

  it('returns half-hour availability and marks open slots as available when no reservations or blockings exist', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([]);

    const slots = await service.getAvailability(SEED.space.id, '2099-06-15');

    expect(slots).toHaveLength(48);
    expect(slots.find((s) => s.startTime === '09:00')?.status).toBe('available');
    expect(slots.find((s) => s.startTime === '09:30')?.status).toBe('available');
    expect(slots.find((s) => s.startTime === '23:00')?.status).toBe('closed');
  });

  it('marks only the half-hours a 16:30–18:00 reservation covers (MEL-024)', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.reservations.findMany.mockResolvedValue([
      { ...SEED.reservation, startTime: '16:30', endTime: '18:00' },
    ]);
    db.query.blockings.findMany.mockResolvedValue([]);

    const slots = await service.getAvailability(SEED.space.id, '2099-06-15');
    const status = (time: string) => slots.find((s) => s.startTime === time)?.status;

    expect(status('16:00')).toBe('available');
    expect(status('16:30')).toBe('reserved');
    expect(status('17:30')).toBe('reserved');
    expect(status('18:00')).toBe('available');
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

  it('returns half-hour slots in order', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);

    const slots = await service.getAvailability(SEED.space.id, '2099-06-15');

    expect(slots[0]?.startTime).toBe('00:00');
    expect(slots[1]?.startTime).toBe('00:30');
    expect(slots[47]?.startTime).toBe('23:30');
    expect(slots[47]?.endTime).toBe('24:00');
  });
});

describe('SpaceService.getAvailability — reservation made on behalf of someone (MEL-025)', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: SpaceService;
  const staff = { id: SEED.user.id, name: 'Carlos Oliveira', role: 'staff' };
  const prof = { id: 'prof-1', name: 'Dra. Maria Costa', role: 'professor' };
  const onBehalf = {
    ...SEED.reservation,
    userId: staff.id,
    createdBy: staff.id,
    requesterUserId: prof.id,
    requesterName: null,
    requesterContact: 'maria@ufc.br',
    description: null,
    user: staff,
    requester: prof,
    recurrence: null,
  };
  const reservationAt9 = async (viewer: { userId: string; role: 'student' | 'professor' | 'staff' | 'maintenance' }) => {
    const slots = await service.getAvailability(SEED.space.id, '2099-06-15', viewer);
    return slots.find((s) => s.startTime === '09:00') as { reservation?: Record<string, unknown> } | undefined;
  };

  beforeEach(() => {
    db = createMockDb();
    service = new SpaceService(db);
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db.query.blockings.findMany.mockResolvedValue([]);
    db.query.reservations.findMany.mockResolvedValue([onBehalf]);
  });

  it('loads the requester relation', async () => {
    await reservationAt9({ userId: 'x', role: 'staff' });
    expect(db.query.reservations.findMany.mock.calls[0][0].with).toMatchObject({ requester: true });
  });

  it('shows the registered requester as the author and the contact to staff', async () => {
    const slot = await reservationAt9({ userId: 'other-staff', role: 'staff' });
    expect(slot?.reservation).toMatchObject({
      author: { displayName: 'Dra. Maria Costa', role: 'professor' },
      requesterContact: 'maria@ufc.br',
    });
  });

  it('keeps the privacy rule for students and hides the contact', async () => {
    const slot = await reservationAt9({ userId: 'stud-1', role: 'student' });
    expect(slot?.reservation).toMatchObject({ author: { displayName: 'professor', role: 'professor' } });
    expect(slot?.reservation).not.toHaveProperty('requesterContact');
  });

  it('hides the contact from professors and marks the requester as self', async () => {
    const slot = await reservationAt9({ userId: prof.id, role: 'professor' });
    expect(slot?.reservation).toMatchObject({ isSelf: true, author: { displayName: 'Dra. Maria Costa' } });
    expect(slot?.reservation).not.toHaveProperty('requesterContact');
  });

  it('shows a free-text requester by name to privileged viewers', async () => {
    db.query.reservations.findMany.mockResolvedValue([
      { ...onBehalf, requesterUserId: null, requester: null, requesterName: 'Coordenação do CAU' },
    ]);
    const slot = await reservationAt9({ userId: 'other-prof', role: 'professor' });
    expect(slot?.reservation).toMatchObject({ isSelf: false, author: { displayName: 'Coordenação do CAU' } });
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
    expect(result).toEqual({ ...spaceWithEquipment, openRoomReportStatus: {} });
  });

  it('exposes open room tickets per category (MEL-026)', async () => {
    db.query.spaces.findFirst.mockResolvedValue({ ...SEED.space, equipment: [] });
    db.query.equipmentReports.findMany.mockResolvedValue([
      { equipmentId: null, category: 'lighting', status: 'pending' },
      { equipmentId: null, category: 'plumbing', status: 'acknowledged' },
      { equipmentId: null, category: 'painting', status: 'resolved' },
    ] as never);

    const result = await service.getById(SEED.space.id);

    expect(result.openRoomReportStatus).toEqual({ lighting: 'pending', plumbing: 'acknowledged' });
  });

  it('exposes the open report status per equipment (MEL-015)', async () => {
    const spaceWithEquipment = { ...SEED.space, equipment: [{ ...SEED.equipment }] };
    db.query.spaces.findFirst.mockResolvedValue(spaceWithEquipment);
    db.query.equipmentReports.findMany.mockResolvedValue([
      { equipmentId: SEED.equipment.id, status: 'acknowledged' },
    ] as never);

    const result = await service.getById(SEED.space.id);

    expect(result.equipment[0]).toMatchObject({
      id: SEED.equipment.id,
      openReportStatus: 'acknowledged',
    });
  });

  it('sets openReportStatus to null when the equipment has no open report', async () => {
    const spaceWithEquipment = { ...SEED.space, equipment: [{ ...SEED.equipment }] };
    db.query.spaces.findFirst.mockResolvedValue(spaceWithEquipment);
    db.query.equipmentReports.findMany.mockResolvedValue([]);

    const result = await service.getById(SEED.space.id);

    expect(result.equipment[0]).toMatchObject({ openReportStatus: null });
  });
});

describe('SpaceService.delete', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: SpaceService;

  beforeEach(() => {
    db = createMockDb();
    service = new SpaceService(db);
    db._insert.returning.mockResolvedValue([{ id: 'log-1' }]);
  });

  it('throws ConflictError when the space has confirmed reservations', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db._select.where.mockResolvedValueOnce([{ reservationCount: 1 }]);

    await expect(service.delete(SEED.space.id, 'user-1')).rejects.toThrow(ConflictError);
  });

  it('throws ConflictError when the space has active blockings', async () => {
    db.query.spaces.findFirst.mockResolvedValue(SEED.space);
    db._select.where.mockResolvedValueOnce([{ reservationCount: 0 }]);
    db._select.where.mockResolvedValueOnce([{ blockingCount: 1 }]);

    await expect(service.delete(SEED.space.id, 'user-1')).rejects.toThrow(ConflictError);
  });
});
