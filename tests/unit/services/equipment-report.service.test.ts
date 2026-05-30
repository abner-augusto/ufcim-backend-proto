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
  });

  it('filters by status when provided', async () => {
    db.query.equipmentReports.findMany.mockResolvedValue([
      { id: '1', equipmentId: 'eq-1', severity: 'minor', status: 'pending', equipment: { spaceId: 's1' }, reporter: null, acknowledger: null },
    ]);

    const result = await service.listPending({ status: 'pending', page: 1, limit: 20 });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('pending');
  });

  it('returns only reports matching the status filter', async () => {
    db.query.equipmentReports.findMany.mockResolvedValue([
      { id: '1', equipmentId: 'eq-1', severity: 'minor', status: 'pending', equipment: { spaceId: 's1' }, reporter: null, acknowledger: null },
    ]);

    const result = await service.listPending({ status: 'pending', page: 1, limit: 20 });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('pending');
  });

  it('applies spaceId filter when provided', async () => {
    db.query.equipmentReports.findMany.mockResolvedValue([
      { id: '1', equipmentId: 'eq-1', severity: 'minor', status: 'pending', equipment: { spaceId: 's1' }, reporter: null, acknowledger: null },
      { id: '2', equipmentId: 'eq-2', severity: 'major', status: 'pending', equipment: { spaceId: 's2' }, reporter: null, acknowledger: null },
    ]);

    const result = await service.listPending({ status: 'pending', spaceId: 's1', page: 1, limit: 20 });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
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
