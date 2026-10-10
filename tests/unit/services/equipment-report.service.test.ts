import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EquipmentReportService } from '@/services/equipment-report.service';
import { AppError, NotFoundError, ConflictError } from '@/middleware/error-handler';
import { equipment, equipmentReports, equipmentStatusHistory } from '@/db/schema';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import { createMockDb, SEED } from '../helpers/mock-db';

const dialect = new SQLiteSyncDialect();
/** Renders a drizzle `where` to SQL so tests can assert the actual filter. */
const toSql = (where: SQL) => dialect.sqlToQuery(where);

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

  it('records the auto-move working→broken as a report-sourced history row (MEL-013)', async () => {
    db.query.equipment.findFirst.mockResolvedValue({ ...SEED.equipment, status: 'working', space: null });
    db.query.equipmentReports.findFirst.mockResolvedValue(undefined);

    await service.create(SEED.user.id, 'student', {
      equipmentId: SEED.equipment.id,
      description: 'Projetor não liga',
      severity: 'major',
    });

    expect(db._batch).toHaveBeenCalledTimes(1);
    expect(db._insert.fn).toHaveBeenCalledWith(equipmentStatusHistory);
    expect(db._insert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        equipmentId: SEED.equipment.id,
        fromStatus: 'working',
        toStatus: 'broken',
        changedBy: SEED.user.id,
        source: 'report',
      })
    );
  });

  it('records no history when the equipment is not auto-moved (minor, or already not working)', async () => {
    db.query.equipment.findFirst.mockResolvedValue({ ...SEED.equipment, status: 'under_repair', space: null });
    db.query.equipmentReports.findFirst.mockResolvedValue(undefined);

    await service.create(SEED.user.id, 'student', {
      equipmentId: SEED.equipment.id,
      description: 'Continua sem funcionar',
      severity: 'blocking',
    });

    expect(db._insert.fn).not.toHaveBeenCalledWith(equipmentStatusHistory);
    expect(db._update.fn).not.toHaveBeenCalled();
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

  it('blocks a second report while any open report exists — even from another user (MEL-015)', async () => {
    db.query.equipment.findFirst.mockResolvedValue({ ...SEED.equipment, space: null });
    db.query.equipmentReports.findMany.mockResolvedValue([
      { id: 'open-report', equipmentId: SEED.equipment.id, status: 'acknowledged' },
    ] as never);

    await expect(
      service.create('another-user', 'professor', {
        equipmentId: SEED.equipment.id,
        description: 'Continua quebrado',
        severity: 'major',
      })
    ).rejects.toThrow('já possui um chamado em aberto');

    expect(db._insert.fn).not.toHaveBeenCalled();
  });

  it('allows a new report once the previous one is resolved or dismissed (MEL-015)', async () => {
    db.query.equipment.findFirst.mockResolvedValue({ ...SEED.equipment, status: 'working', space: null });
    db.query.equipmentReports.findMany.mockResolvedValue([
      { id: 'old-report', equipmentId: SEED.equipment.id, status: 'resolved' },
    ] as never);
    db.query.equipmentReports.findFirst.mockResolvedValue(undefined);

    const result = await service.create('another-user', 'professor', {
      equipmentId: SEED.equipment.id,
      description: 'Voltou a falhar',
      severity: 'minor',
    });

    expect(result.status).toBe('pending');
  });
});

describe('EquipmentReportService.getOpenStatusByEquipmentIds', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: EquipmentReportService;

  beforeEach(() => {
    db = createMockDb();
    service = new EquipmentReportService(db);
  });

  it('returns an empty map without querying when there are no ids', async () => {
    const map = await service.getOpenStatusByEquipmentIds([]);

    expect(map.size).toBe(0);
    expect(db.query.equipmentReports.findMany).not.toHaveBeenCalled();
  });

  it('prefers acknowledged over pending and ignores closed reports (MEL-015)', async () => {
    db.query.equipmentReports.findMany.mockResolvedValue([
      { equipmentId: 'eq-1', status: 'pending' },
      { equipmentId: 'eq-1', status: 'acknowledged' },
      { equipmentId: 'eq-2', status: 'resolved' },
      { equipmentId: 'eq-3', status: 'pending' },
    ] as never);

    const map = await service.getOpenStatusByEquipmentIds(['eq-1', 'eq-2', 'eq-3']);

    expect(map.get('eq-1')).toBe('acknowledged');
    expect(map.has('eq-2')).toBe(false);
    expect(map.get('eq-3')).toBe('pending');
    expect(map.size).toBe(2);
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

  it('filters a space by the ticket space_id in SQL, so room tickets match too (MEL-026)', async () => {
    await service.listPending({ status: 'pending', spaceId: 'space-a', page: 2, limit: 5 });
    const call = db.query.equipmentReports.findMany.mock.calls[0]?.[0];
    const where = toSql(call.where);

    expect(where.sql).toContain('"equipment_reports"."space_id" = ?');
    expect(where.sql).toContain('"equipment_reports"."status" = ?');
    expect(where.params).toEqual(['pending', 'space-a']);
    expect(call.limit).toBe(5);
    expect(call.offset).toBe(5);
    // No equipment lookup any more: a room with no equipment can still have tickets.
    expect(db._select.where).not.toHaveBeenCalled();
  });

  it('lists room tickets with their space and department (MEL-026)', async () => {
    const roomTicket = {
      id: 'room-1', equipmentId: null, spaceId: 'space-a', category: 'lighting', severity: 'minor', status: 'pending',
      equipment: null, space: { id: 'space-a', number: 'B2-03', department: { id: 'iaud', name: 'IAUD' } },
      reporter: null, acknowledger: null,
    };
    db.query.equipmentReports.findMany.mockResolvedValue([roomTicket] as never);

    const result = await service.listPending({ status: 'pending', page: 1, limit: 20 });
    const call = db.query.equipmentReports.findMany.mock.calls[0]?.[0];

    expect(result).toEqual([roomTicket]);
    expect(call.with).toMatchObject({
      space: { with: { department: true } },
      equipment: { with: { space: { with: { department: true } } } },
    });
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

  it('loads the ticket space so room tickets carry their room (MEL-026)', async () => {
    await service.listByUser('user-1', 1, 20);
    const call = db.query.equipmentReports.findMany.mock.calls[0]?.[0];
    expect(call.with).toMatchObject({ space: true });
  });
});

// ─── Room tickets (MEL-026) ────────────────────────────────────────────────

const ROOM_INPUT = {
  spaceId: SEED.space.id,
  category: 'lighting' as const,
  description: 'Duas lâmpadas queimadas',
  severity: 'blocking' as const,
};

describe('EquipmentReportService.create — room tickets (MEL-026)', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: EquipmentReportService;

  beforeEach(() => {
    db = createMockDb();
    service = new EquipmentReportService(db);
    db.query.spaces.findFirst.mockResolvedValue({ ...SEED.space } as never);
    db.query.users.findMany.mockResolvedValue([]);
    db._insert.returning.mockResolvedValue([{
      id: 'room-1',
      equipmentId: null,
      spaceId: SEED.space.id,
      category: 'lighting',
      reportedBy: SEED.user.id,
      description: ROOM_INPUT.description,
      severity: 'blocking',
      status: 'pending',
      createdAt: new Date().toISOString(),
    }]);
  });

  it('stores a ticket with the space and category and no equipment', async () => {
    const result = await service.create(SEED.user.id, 'student', ROOM_INPUT);

    expect(result).toMatchObject({ equipmentId: null, spaceId: SEED.space.id, category: 'lighting', status: 'pending' });
    expect(db._insert.fn).toHaveBeenCalledWith(equipmentReports);
    expect(db._insert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        equipmentId: null,
        spaceId: SEED.space.id,
        category: 'lighting',
        description: 'Duas lâmpadas queimadas',
        severity: 'blocking',
        status: 'pending',
      })
    );
  });

  it('never touches equipment status or writes status history, even when blocking', async () => {
    await service.create(SEED.user.id, 'student', ROOM_INPUT);

    expect(db.query.equipment.findFirst).not.toHaveBeenCalled();
    expect(db._update.fn).not.toHaveBeenCalled();
    expect(db._batch).not.toHaveBeenCalled();
    expect(db._insert.fn).not.toHaveBeenCalledWith(equipmentStatusHistory);
  });

  it('throws NotFoundError when the space does not exist', async () => {
    db.query.spaces.findFirst.mockResolvedValue(undefined);

    await expect(service.create(SEED.user.id, 'student', ROOM_INPUT)).rejects.toThrow(NotFoundError);
    expect(db._insert.fn).not.toHaveBeenCalled();
  });

  it('returns 409 while the same room has an open ticket in the same category, from any user', async () => {
    db.query.equipmentReports.findMany.mockResolvedValue([
      { id: 'open', equipmentId: null, spaceId: SEED.space.id, category: 'lighting', status: 'acknowledged' },
    ] as never);

    const attempt = service.create('another-user', 'professor', ROOM_INPUT);

    await expect(attempt).rejects.toThrow(ConflictError);
    await expect(service.create('another-user', 'professor', ROOM_INPUT)).rejects.toThrow(
      'já possui um chamado em aberto'
    );
    expect(db._insert.fn).not.toHaveBeenCalled();
  });

  it('queries open tickets by space, category and open status without equipment', async () => {
    await service.create(SEED.user.id, 'student', ROOM_INPUT);
    const call = db.query.equipmentReports.findMany.mock.calls[0]?.[0];
    const where = toSql(call.where);

    expect(where.sql).toContain('"equipment_reports"."space_id" = ?');
    expect(where.sql).toContain('"equipment_reports"."equipment_id" is null');
    expect(where.sql).toContain('"equipment_reports"."status" in (?, ?)');
    expect(where.params).toEqual(expect.arrayContaining([SEED.space.id, 'pending', 'acknowledged']));
  });

  it('allows a ticket when the open one is in another category', async () => {
    db.query.equipmentReports.findMany.mockResolvedValue([
      { id: 'open', equipmentId: null, spaceId: SEED.space.id, category: 'plumbing', status: 'pending' },
    ] as never);

    const result = await service.create(SEED.user.id, 'student', ROOM_INPUT);
    expect(result.status).toBe('pending');
  });

  it('allows a ticket when only an equipment ticket is open in the room', async () => {
    db.query.equipmentReports.findMany.mockResolvedValue([
      { id: 'eq-open', equipmentId: SEED.equipment.id, spaceId: SEED.space.id, category: null, status: 'pending' },
    ] as never);

    const result = await service.create(SEED.user.id, 'student', ROOM_INPUT);
    expect(result.status).toBe('pending');
  });

  it('keeps the 24h anti-spam per user for the same room and category', async () => {
    db.query.equipmentReports.findFirst.mockResolvedValue({ id: 'recent', status: 'resolved' } as never);

    await expect(service.create(SEED.user.id, 'student', ROOM_INPUT)).rejects.toThrow('últimas 24h');
  });

  it('notifies staff and maintenance with the category label', async () => {
    db.query.users.findMany.mockResolvedValue([
      { id: 'staff-1', role: 'staff' },
      { id: 'maint-1', role: 'maintenance' },
      { id: 'student-1', role: 'student' },
    ] as never);

    await service.create(SEED.user.id, 'student', ROOM_INPUT);

    const notified = db._insert.values.mock.calls
      .map(([v]) => v as { userId?: string; title?: string; message?: string })
      .filter((v) => v.title === 'Novo chamado de manutenção');
    expect(notified.map((v) => v.userId)).toEqual(['staff-1', 'maint-1']);
    expect(notified[0].message).toContain('Sala A101');
    expect(notified[0].message).toContain('Iluminação');
  });

  it('rejects an input carrying both an equipment and a room target', async () => {
    await expect(
      service.create(SEED.user.id, 'student', { ...ROOM_INPUT, equipmentId: SEED.equipment.id } as never)
    ).rejects.toThrow(AppError);
    expect(db._insert.fn).not.toHaveBeenCalled();
  });
});

describe('EquipmentReportService.create — equipment tickets keep their room (MEL-026)', () => {
  it('copies the equipment space into the ticket and leaves the category empty', async () => {
    const db = createMockDb();
    const service = new EquipmentReportService(db);
    db.query.equipment.findFirst.mockResolvedValue({ ...SEED.equipment, status: 'working', space: null });
    db.query.users.findMany.mockResolvedValue([]);

    await service.create(SEED.user.id, 'student', {
      equipmentId: SEED.equipment.id,
      description: 'Arranhado na superfície',
      severity: 'minor',
    });

    expect(db._insert.values).toHaveBeenCalledWith(
      expect.objectContaining({ equipmentId: SEED.equipment.id, spaceId: SEED.equipment.spaceId, category: null })
    );
  });
});

describe('EquipmentReportService.getOpenRoomStatusByCategory (MEL-026)', () => {
  it('maps open room tickets per category, preferring acknowledged and ignoring equipment tickets', async () => {
    const db = createMockDb();
    const service = new EquipmentReportService(db);
    db.query.equipmentReports.findMany.mockResolvedValue([
      { equipmentId: null, category: 'lighting', status: 'pending' },
      { equipmentId: null, category: 'lighting', status: 'acknowledged' },
      { equipmentId: null, category: 'plumbing', status: 'pending' },
      { equipmentId: null, category: 'painting', status: 'resolved' },
      { equipmentId: 'eq-1', category: null, status: 'pending' },
    ] as never);

    const map = await service.getOpenRoomStatusByCategory(SEED.space.id);

    expect(Object.fromEntries(map)).toEqual({ lighting: 'acknowledged', plumbing: 'pending' });
  });
});

describe('EquipmentReportService acknowledge/resolve — room tickets (MEL-026)', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: EquipmentReportService;
  const roomTicket = {
    id: 'room-1',
    equipmentId: null,
    spaceId: SEED.space.id,
    category: 'electrical',
    reportedBy: 'user-1',
    description: 'Tomada solta',
    severity: 'major',
    status: 'pending',
    createdAt: new Date().toISOString(),
    equipment: null,
    space: { ...SEED.space },
    reporter: { id: 'user-1', name: 'User', role: 'student' },
  };

  beforeEach(() => {
    db = createMockDb();
    service = new EquipmentReportService(db);
    db.query.equipmentReports.findFirst.mockResolvedValue(roomTicket as never);
  });

  it('acknowledges a room ticket', async () => {
    db._update.returning.mockResolvedValue([{ ...roomTicket, status: 'acknowledged', acknowledgedBy: 'staff-1' }]);

    const result = await service.acknowledge('room-1', 'staff-1');

    expect(result.status).toBe('acknowledged');
    expect(db._update.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'acknowledged', acknowledgedBy: 'staff-1' }));
  });

  it('resolves a room ticket and tells the reporter which room problem was fixed', async () => {
    db._update.returning.mockResolvedValue([{ ...roomTicket, status: 'resolved' }]);

    const result = await service.resolve('room-1', 'staff-1');

    expect(result.status).toBe('resolved');
    expect(db._update.fn).toHaveBeenCalledWith(equipmentReports);
    expect(db._update.fn).not.toHaveBeenCalledWith(equipment);
    expect(db._insert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        title: 'Reporte resolvido',
        message: expect.stringContaining('Tomadas e elétrica'),
      })
    );
    const call = db.query.equipmentReports.findFirst.mock.calls[0]?.[0];
    expect(call.with).toMatchObject({ space: true });
  });
});
