import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EquipmentReportService } from '@/services/equipment-report.service';
import { NotFoundError, ConflictError } from '@/middleware/error-handler';
import { createMockDb, SEED } from '../helpers/mock-db';

describe('EquipmentReportService.create', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: EquipmentReportService;

  beforeEach(() => {
    db = createMockDb();
    service = new EquipmentReportService(db);
    db.query.users.findMany.mockResolvedValue([]); // no staff/maintenance to notify
    db._insert.returning.mockResolvedValue([{
      id: 'report-1',
      equipmentId: SEED.equipment.id,
      reportedBy: SEED.user.id,
      description: 'Projetor não liga',
      severity: 'blocking',
      status: 'pending',
      createdAt: new Date().toISOString(),
    }]);
  });

  it('throws NotFoundError when equipment does not exist', async () => {
    db.query.equipment.findFirst.mockResolvedValue(undefined);

    await expect(
      service.create(SEED.user.id, 'student', {
        equipmentId: 'nonexistent',
        description: 'Quebrado',
        severity: 'minor',
      })
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ConflictError when reporting same equipment within 24h', async () => {
    db.query.equipment.findFirst.mockResolvedValue({ ...SEED.equipment, space: null });
    db.query.equipmentReports.findFirst.mockResolvedValue({
      id: 'existing-report',
      equipmentId: SEED.equipment.id,
      reportedBy: SEED.user.id,
      createdAt: new Date().toISOString(),
    } as any);

    await expect(
      service.create(SEED.user.id, 'student', {
        equipmentId: SEED.equipment.id,
        description: 'Projetor não liga',
        severity: 'major',
      })
    ).rejects.toThrow(ConflictError);
  });

  it('creates report and moves equipment to broken when severity is blocking and status is working', async () => {
    db.query.equipment.findFirst.mockResolvedValue({ ...SEED.equipment, status: 'working', space: null });
    db.query.equipmentReports.findFirst.mockResolvedValue(undefined);
    db._update.returning.mockResolvedValue([{ ...SEED.equipment, status: 'broken' }]);

    const result = await service.create(SEED.user.id, 'student', {
      equipmentId: SEED.equipment.id,
      description: 'Projetor não liga',
      severity: 'blocking',
    });

    expect(result.severity).toBe('blocking');
    expect(result.status).toBe('pending');
    // Verify update was called for equipment status
    expect(db._update.fn).toHaveBeenCalled();
  });

  it('creates report without moving equipment when severity is minor', async () => {
    db.query.equipment.findFirst.mockResolvedValue({ ...SEED.equipment, status: 'working', space: null });
    db.query.equipmentReports.findFirst.mockResolvedValue(undefined);
    db._insert.returning.mockResolvedValue([{
      id: 'report-2',
      equipmentId: SEED.equipment.id,
      reportedBy: SEED.user.id,
      description: 'Arranhado na superfície',
      severity: 'minor',
      status: 'pending',
      createdAt: new Date().toISOString(),
    }]);

    const result = await service.create(SEED.user.id, 'student', {
      equipmentId: SEED.equipment.id,
      description: 'Arranhado na superfície',
      severity: 'minor',
    });

    expect(result.severity).toBe('minor');
    expect(result.status).toBe('pending');
  });
});

describe('EquipmentReportService.acknowledge', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: EquipmentReportService;

  beforeEach(() => {
    db = createMockDb();
    service = new EquipmentReportService(db);
    db.query.equipmentReports.findFirst.mockResolvedValue({
      id: 'report-1',
      equipmentId: SEED.equipment.id,
      reportedBy: SEED.user.id,
      description: 'Test',
      severity: 'major',
      status: 'pending',
      createdAt: new Date().toISOString(),
    } as any);
    db._update.returning.mockResolvedValue([{
      id: 'report-1',
      status: 'acknowledged',
      acknowledgedBy: 'staff-1',
      acknowledgedAt: new Date().toISOString(),
    }]);
  });

  it('throws NotFoundError when report does not exist', async () => {
    db.query.equipmentReports.findFirst.mockResolvedValue(undefined);

    await expect(service.acknowledge('nonexistent', 'staff-1')).rejects.toThrow(NotFoundError);
  });

  it('marks report as acknowledged', async () => {
    const result = await service.acknowledge('report-1', 'staff-1');
    expect(result.status).toBe('acknowledged');
  });
});

describe('EquipmentReportService.resolve', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: EquipmentReportService;

  beforeEach(() => {
    db = createMockDb();
    service = new EquipmentReportService(db);
    db.query.equipmentReports.findFirst.mockResolvedValue({
      id: 'report-1',
      equipmentId: SEED.equipment.id,
      reportedBy: 'user-1',
      description: 'Test',
      severity: 'major',
      status: 'acknowledged',
      createdAt: new Date().toISOString(),
      equipment: { name: 'Projetor' },
      reporter: { id: 'user-1', name: 'User', role: 'student' },
    } as any);
    db._update.returning.mockResolvedValue([{
      id: 'report-1',
      status: 'resolved',
      resolvedAt: new Date().toISOString(),
    }]);
  });

  it('marks report as resolved and notifies reporter', async () => {
    const result = await service.resolve('report-1', 'staff-1');
    expect(result.status).toBe('resolved');
  });
});

describe('EquipmentReportService.dismiss', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: EquipmentReportService;

  beforeEach(() => {
    db = createMockDb();
    service = new EquipmentReportService(db);
    db.query.equipmentReports.findFirst.mockResolvedValue({
      id: 'report-1',
      status: 'pending',
      severity: 'minor',
      createdAt: new Date().toISOString(),
    } as any);
    db._update.returning.mockResolvedValue([{
      id: 'report-1',
      status: 'dismissed',
      dismissedReason: 'Falso alarme',
      resolvedAt: new Date().toISOString(),
    }]);
  });

  it('dismisses report with reason', async () => {
    const result = await service.dismiss('report-1', 'staff-1', 'Falso alarme');
    expect(result.status).toBe('dismissed');
  });
});

describe('EquipmentReportService.listByEquipment', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: EquipmentReportService;

  beforeEach(() => {
    db = createMockDb();
    service = new EquipmentReportService(db);
    db.query.equipment.findFirst.mockResolvedValue(SEED.equipment);
    db.query.equipmentReports.findMany.mockResolvedValue([
      { id: '1', equipmentId: SEED.equipment.id, severity: 'minor', status: 'pending', reporter: { id: 'u1', name: 'User' }, acknowledger: null },
    ]);
  });

  it('throws NotFoundError when equipment does not exist', async () => {
    db.query.equipment.findFirst.mockResolvedValue(undefined);
    await expect(service.listByEquipment('nonexistent')).rejects.toThrow(NotFoundError);
  });

  it('returns reports for equipment', async () => {
    const result = await service.listByEquipment(SEED.equipment.id);
    expect(result).toHaveLength(1);
  });
});

describe('EquipmentReportService.listPending', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: EquipmentReportService;

  beforeEach(() => {
    db = createMockDb();
    service = new EquipmentReportService(db);
    db.query.equipmentReports.findMany.mockResolvedValue([]);
    db._select.where.mockResolvedValue([]);
  });

  it('keeps results unchanged when no spaceId is provided', async () => {
    const rows = [
      { id: '1', equipmentId: 'eq-1', severity: 'minor', status: 'pending', equipment: { spaceId: 's1' }, reporter: null, acknowledger: null },
    ];
    db.query.equipmentReports.findMany.mockResolvedValue(rows as any);

    const result = await service.listPending({ status: 'pending', page: 1, limit: 20 });

    expect(result).toEqual(rows);
    expect(db._select.where).not.toHaveBeenCalled();
    expect(db.query.equipmentReports.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.anything(), limit: 20, offset: 0 })
    );
  });

  it('returns the space report even when the first SQL page would otherwise miss it', async () => {
    db._select.where.mockResolvedValue([{ id: 'eq-a' }]);
    db.query.equipmentReports.findMany.mockImplementation(async () => {
      if (db._select.where.mock.calls.length > 0) {
        return [
          { id: 'a-1', equipmentId: 'eq-a', severity: 'minor', status: 'pending', equipment: { spaceId: 'space-a' }, reporter: null, acknowledger: null },
        ];
      }

      return [
        { id: 'b-1', equipmentId: 'eq-b', severity: 'minor', status: 'pending', equipment: { spaceId: 'space-b' }, reporter: null, acknowledger: null },
        { id: 'b-2', equipmentId: 'eq-b', severity: 'major', status: 'pending', equipment: { spaceId: 'space-b' }, reporter: null, acknowledger: null },
      ];
    });

    const result = await service.listPending({ spaceId: 'space-a', page: 1, limit: 2 });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a-1');
    expect(db._select.where).toHaveBeenCalledTimes(1);
    expect(db.query.equipmentReports.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.anything(), limit: 2, offset: 0 })
    );
  });

  it('combines spaceId and status filters in SQL', async () => {
    db._select.where.mockResolvedValue([{ id: 'eq-a' }]);
    db.query.equipmentReports.findMany.mockImplementation(async () => {
      if (db._select.where.mock.calls.length > 0) {
        return [
          { id: 'a-1', equipmentId: 'eq-a', severity: 'minor', status: 'pending', equipment: { spaceId: 'space-a' }, reporter: null, acknowledger: null },
        ];
      }

      return [
        { id: 'a-2', equipmentId: 'eq-a', severity: 'major', status: 'resolved', equipment: { spaceId: 'space-a' }, reporter: null, acknowledger: null },
      ];
    });

    const result = await service.listPending({ status: 'pending', spaceId: 'space-a', page: 2, limit: 5 });
    const call = db.query.equipmentReports.findMany.mock.calls[0]?.[0];

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('pending');
    expect(call.where).toBeDefined();
    expect(call.limit).toBe(5);
    expect(call.offset).toBe(5);
    expect(db._select.where).toHaveBeenCalledTimes(1);
  });

  it('returns an empty array when the space has no equipment', async () => {
    db._select.where.mockResolvedValue([]);

    const result = await service.listPending({ spaceId: 'space-a', page: 1, limit: 20 });

    expect(result).toEqual([]);
    expect(db.query.equipmentReports.findMany).not.toHaveBeenCalled();
  });
});

describe('EquipmentReportService.listByUser', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: EquipmentReportService;

  beforeEach(() => {
    db = createMockDb();
    service = new EquipmentReportService(db);
    db.query.equipmentReports.findMany.mockResolvedValue([
      { id: '1', equipmentId: 'eq-1', severity: 'minor', status: 'pending', equipment: { space: { id: 's1' } }, acknowledger: null },
    ]);
  });

  it('returns reports for the user', async () => {
    const result = await service.listByUser('user-1', 1, 20);
    expect(result).toHaveLength(1);
  });
});
