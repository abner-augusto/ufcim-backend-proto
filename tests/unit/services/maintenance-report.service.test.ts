import { beforeEach, describe, expect, it } from 'vitest';
import {
  MaintenanceReportService,
  brokenIntervals,
  overlapMs,
  resolveRange,
} from '@/services/maintenance-report.service';
import { AppError, NotFoundError } from '@/middleware/error-handler';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { createMockDb } from '../helpers/mock-db';

// Campus is UTC-3: 03:00Z is local midnight. "Now" is 2026-09-16 12:00 local.
const NOW = new Date('2026-09-16T15:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

const SPACE_IAUD = {
  id: 's-1', name: 'Sala B2-03', number: 'B2-03', block: 'Bloco 2',
  department: { id: 'iaud', name: 'IAUD' },
};
const SPACE_DC = {
  id: 's-2', name: 'Lab 1', number: 'L1', block: 'Bloco 9',
  department: { id: 'dc', name: 'Departamento de Computação' },
};

const EQUIPMENT = [
  { id: 'eq-1', assetId: '0000000001', name: 'Projetor', type: 'projector', status: 'broken', notes: null, updatedAt: '2026-09-14T03:00:00.000Z', spaceId: 's-1', space: SPACE_IAUD },
  { id: 'eq-2', assetId: '0000000002', name: 'Cadeira', type: 'furniture', status: 'working', notes: null, updatedAt: '2026-09-01T03:00:00.000Z', spaceId: 's-2', space: SPACE_DC },
  { id: 'eq-3', assetId: '0000000003', name: 'Ar-condicionado', type: 'hvac', status: 'broken', notes: null, updatedAt: '2026-09-01T03:00:00.000Z', spaceId: 's-1', space: SPACE_IAUD },
];

const MARIA = { id: 'u-maria', name: 'Maria' };
const JOAO = { id: 'u-joao', name: 'João' };

const HISTORY = [
  // Baseline snapshot written by migration 0004
  { id: 'h-0', equipmentId: 'eq-1', fromStatus: 'working', toStatus: 'working', changedBy: null, changedAt: '2026-09-01T03:00:00.000Z', source: 'system', changer: null },
  { id: 'h-0b', equipmentId: 'eq-2', fromStatus: 'working', toStatus: 'working', changedBy: null, changedAt: '2026-09-01T03:00:00.000Z', source: 'system', changer: null },
  { id: 'h-0c', equipmentId: 'eq-3', fromStatus: 'broken', toStatus: 'broken', changedBy: null, changedAt: '2026-09-01T03:00:00.000Z', source: 'system', changer: null },
  // eq-1: broken 2 days, under repair 3 days, working 4 days, broken again (open)
  { id: 'h-1', equipmentId: 'eq-1', fromStatus: 'working', toStatus: 'broken', changedBy: 'u-maria', changedAt: '2026-09-05T03:00:00.000Z', source: 'report', changer: MARIA },
  { id: 'h-2', equipmentId: 'eq-1', fromStatus: 'broken', toStatus: 'under_repair', changedBy: 'u-joao', changedAt: '2026-09-07T03:00:00.000Z', source: 'manual', changer: JOAO },
  { id: 'h-3', equipmentId: 'eq-1', fromStatus: 'under_repair', toStatus: 'working', changedBy: 'u-joao', changedAt: '2026-09-10T03:00:00.000Z', source: 'manual', changer: JOAO },
  { id: 'h-4', equipmentId: 'eq-1', fromStatus: 'working', toStatus: 'broken', changedBy: 'u-maria', changedAt: '2026-09-14T03:00:00.000Z', source: 'report', changer: MARIA },
];

const REPORTS = [
  { id: 'r-4', equipmentId: 'eq-1', reportedBy: 'u-maria', description: 'Lâmpada queimada', severity: 'major', status: 'resolved', acknowledgedBy: null, acknowledgedAt: null, resolvedAt: '2026-08-02T12:00:00.000Z', dismissedReason: null, createdAt: '2026-08-01T12:00:00.000Z', reporter: MARIA, acknowledger: null },
  { id: 'r-1', equipmentId: 'eq-1', reportedBy: 'u-maria', description: 'Não liga', severity: 'major', status: 'resolved', acknowledgedBy: 'u-joao', acknowledgedAt: '2026-09-05T09:00:00.000Z', resolvedAt: '2026-09-10T03:00:00.000Z', dismissedReason: null, createdAt: '2026-09-05T03:00:00.000Z', reporter: MARIA, acknowledger: JOAO },
  { id: 'r-3', equipmentId: 'eq-1', reportedBy: 'u-joao', description: 'Ruído', severity: 'minor', status: 'dismissed', acknowledgedBy: null, acknowledgedAt: null, resolvedAt: '2026-09-12T13:00:00.000Z', dismissedReason: 'Duplicado', createdAt: '2026-09-12T12:00:00.000Z', reporter: JOAO, acknowledger: null },
  { id: 'r-2', equipmentId: 'eq-1', reportedBy: 'u-maria', description: 'Imagem piscando', severity: 'blocking', status: 'acknowledged', acknowledgedBy: 'u-joao', acknowledgedAt: '2026-09-14T05:00:00.000Z', resolvedAt: null, dismissedReason: null, createdAt: '2026-09-14T03:00:00.000Z', reporter: MARIA, acknowledger: JOAO },
  // Outside the default 90-day window (before 2026-06-19 local)
  { id: 'r-old', equipmentId: 'eq-3', reportedBy: 'u-maria', description: 'Antigo', severity: 'major', status: 'resolved', acknowledgedBy: null, acknowledgedAt: null, resolvedAt: '2026-05-02T12:00:00.000Z', dismissedReason: null, createdAt: '2026-05-01T12:00:00.000Z', reporter: MARIA, acknowledger: null },
];

describe('resolveRange', () => {
  it('defaults to the last 90 campus days ending today', () => {
    const r = resolveRange({}, NOW);
    expect(r).toMatchObject({ from: '2026-06-19', to: '2026-09-16', days: 90 });
    expect(r.startMs).toBe(Date.parse('2026-06-19T03:00:00.000Z'));
    expect(r.endMs).toBe(Date.parse('2026-09-17T03:00:00.000Z'));
  });

  it('defaults "from" to 89 days before an explicit "to"', () => {
    expect(resolveRange({ to: '2026-03-31' }, NOW)).toMatchObject({ from: '2026-01-01', to: '2026-03-31', days: 90 });
  });

  it('rejects a range longer than 90 days', () => {
    expect(() => resolveRange({ from: '2026-01-01', to: '2026-04-01' }, NOW)).toThrow(AppError);
  });

  it('rejects "from" after "to"', () => {
    expect(() => resolveRange({ from: '2026-09-10', to: '2026-09-01' }, NOW)).toThrow(AppError);
  });
});

describe('brokenIntervals / overlapMs', () => {
  it('pairs each entry into broken with the next exit and leaves the last one open until now', () => {
    const intervals = brokenIntervals(HISTORY.filter((h) => h.equipmentId === 'eq-1'), NOW.getTime());
    expect(intervals).toEqual([
      { start: Date.parse('2026-09-05T03:00:00.000Z'), end: Date.parse('2026-09-07T03:00:00.000Z') },
      { start: Date.parse('2026-09-14T03:00:00.000Z'), end: NOW.getTime() },
    ]);
    // 2 days + 2.5 days open
    expect(overlapMs(intervals, 0, NOW.getTime()) / DAY).toBe(4.5);
  });

  it('treats a broken baseline snapshot as the start of an open interval', () => {
    const intervals = brokenIntervals(HISTORY.filter((h) => h.equipmentId === 'eq-3'), NOW.getTime());
    expect(intervals).toEqual([{ start: Date.parse('2026-09-01T03:00:00.000Z'), end: NOW.getTime() }]);
  });

  it('ignores repeated entries into broken while already broken', () => {
    const intervals = brokenIntervals(
      [
        { toStatus: 'broken', changedAt: '2026-09-01T00:00:00.000Z' },
        { toStatus: 'broken', changedAt: '2026-09-02T00:00:00.000Z' },
        { toStatus: 'working', changedAt: '2026-09-03T00:00:00.000Z' },
      ],
      NOW.getTime()
    );
    expect(intervals).toHaveLength(1);
    expect((intervals[0].end - intervals[0].start) / DAY).toBe(2);
  });

  it('clips intervals to the requested window', () => {
    const intervals = [{ start: 0, end: 10 * DAY }];
    expect(overlapMs(intervals, 2 * DAY, 5 * DAY)).toBe(3 * DAY);
    expect(overlapMs(intervals, 11 * DAY, 12 * DAY)).toBe(0);
  });
});

// A room ticket (MEL-026): no equipment, in the window, open and serious.
const ROOM_TICKET = { id: 'r-room', equipmentId: null, spaceId: 's-1', category: 'lighting', reportedBy: 'u-maria', description: 'Lâmpadas queimadas', severity: 'blocking', status: 'pending', acknowledgedBy: null, acknowledgedAt: null, resolvedAt: null, dismissedReason: null, createdAt: '2026-09-14T03:00:00.000Z', reporter: MARIA, acknowledger: null };

describe('MaintenanceReportService.listEquipment', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: MaintenanceReportService;

  beforeEach(() => {
    db = createMockDb();
    service = new MaintenanceReportService(db, () => NOW);
    db.query.equipment.findMany.mockResolvedValue(EQUIPMENT as never);
    db.query.equipmentReports.findMany.mockResolvedValue(REPORTS as never);
    db.query.equipmentStatusHistory.findMany.mockResolvedValue(HISTORY as never);
    db.query.equipmentStatusHistory.findFirst.mockResolvedValue(HISTORY[0] as never);
  });

  it('aggregates counts, broken time and recurrence per equipment', async () => {
    const result = await service.listEquipment({});

    expect(result.range).toEqual({ from: '2026-06-19', to: '2026-09-16', days: 90 });
    expect(result.historySince).toBe('2026-09-01T03:00:00.000Z');

    const eq1 = result.equipment.find((e) => e.id === 'eq-1')!;
    expect(eq1).toMatchObject({
      name: 'Projetor',
      assetId: '0000000001',
      status: 'broken',
      space: { id: 's-1', number: 'B2-03', block: 'Bloco 2', department: 'IAUD' },
      reportCount: 4,
      openCount: 1,
      resolvedCount: 2,
      dismissedCount: 1,
      lastReportAt: '2026-09-14T03:00:00.000Z',
      lastSeverity: 'blocking',
      recurrences: 2,
      isRecurrent: true,
      breakdownCount: 2,
      repairCount: 1,
      timeInBrokenDays: 4.5,
    });
  });

  it('includes items currently not working even without events, and skips idle working ones', async () => {
    const result = await service.listEquipment({});
    const ids = result.equipment.map((e) => e.id);

    expect(ids).toContain('eq-3');
    expect(ids).not.toContain('eq-2');
    expect(result.equipment.find((e) => e.id === 'eq-3')!.timeInBrokenDays).toBe(15.5);
  });

  it('orders rows by time broken, longest first', async () => {
    const result = await service.listEquipment({});
    expect(result.equipment.map((e) => e.id)).toEqual(['eq-3', 'eq-1']);
  });

  it('ignores reports outside the window', async () => {
    const result = await service.listEquipment({});
    const eq3 = result.equipment.find((e) => e.id === 'eq-3')!;
    expect(eq3.reportCount).toBe(0);
    expect(eq3.lastReportAt).toBeNull();
  });

  it('clips broken time and counts to an explicit window', async () => {
    const result = await service.listEquipment({ from: '2026-09-06', to: '2026-09-08' });
    const eq1 = result.equipment.find((e) => e.id === 'eq-1')!;

    // Broken 09-05 → 09-07 (local midnight); window starts 09-06 → 1 day
    expect(eq1.timeInBrokenDays).toBe(1);
    expect(eq1.reportCount).toBe(0);
    expect(eq1.breakdownCount).toBe(0);
  });

  it('filters by space, department, equipment, status and severity', async () => {
    expect((await service.listEquipment({ spaceId: 's-2' })).equipment).toEqual([]);
    expect((await service.listEquipment({ departmentId: 'dc' })).equipment).toEqual([]);
    expect((await service.listEquipment({ departmentId: 'iaud' })).equipment.map((e) => e.id)).toEqual(['eq-3', 'eq-1']);
    // An explicit equipment filter returns it even when idle
    expect((await service.listEquipment({ equipmentId: 'eq-2' })).equipment.map((e) => e.id)).toEqual(['eq-2']);
    expect((await service.listEquipment({ status: 'working' })).equipment).toEqual([]);

    const bySeverity = await service.listEquipment({ severity: 'blocking' });
    expect(bySeverity.equipment.map((e) => e.id)).toEqual(['eq-1']);
    expect(bySeverity.equipment[0].reportCount).toBe(1);
  });

  it('builds a daily series of reports and broken equipment-days', async () => {
    const result = await service.listEquipment({ from: '2026-09-13', to: '2026-09-17' });

    expect(result.series.map((d) => d.date)).toEqual([
      '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17',
    ]);
    const day14 = result.series.find((d) => d.date === '2026-09-14')!;
    expect(day14.reports).toBe(1);
    expect(day14.brokenDays).toBe(2); // eq-1 and eq-3 broken all day
    const day16 = result.series.find((d) => d.date === '2026-09-16')!;
    expect(day16.brokenDays).toBe(1); // half a day each, until now
    expect(result.series.find((d) => d.date === '2026-09-17')!.brokenDays).toBe(0);
  });

  it('rejects ranges above the 90-day cap', async () => {
    await expect(service.listEquipment({ from: '2026-01-01', to: '2026-09-16' })).rejects.toThrow(AppError);
  });

  it('returns null historySince when no history exists yet', async () => {
    db.query.equipmentStatusHistory.findFirst.mockResolvedValue(undefined);
    expect((await service.listEquipment({})).historySince).toBeNull();
  });

  it('ignores room tickets, which have no equipment (MEL-026)', async () => {
    const baseline = await service.listEquipment({});
    db.query.equipmentReports.findMany.mockResolvedValue([...REPORTS, ROOM_TICKET] as never);

    const withRoomTicket = await service.listEquipment({});

    expect(withRoomTicket).toEqual(baseline);
  });

  it('filters room tickets out in SQL (MEL-026)', async () => {
    await service.listEquipment({});
    const call = db.query.equipmentReports.findMany.mock.calls[0]?.[0];

    expect(new SQLiteSyncDialect().sqlToQuery(call.where).sql).toContain('"equipment_reports"."equipment_id" is not null');
  });
});

describe('MaintenanceReportService.getEquipmentReport', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: MaintenanceReportService;

  beforeEach(() => {
    db = createMockDb();
    service = new MaintenanceReportService(db, () => NOW);
    db.query.equipment.findFirst.mockResolvedValue(EQUIPMENT[0] as never);
    db.query.equipmentReports.findMany.mockResolvedValue(REPORTS.filter((r) => r.equipmentId === 'eq-1') as never);
    db.query.equipmentStatusHistory.findMany.mockResolvedValue(HISTORY.filter((h) => h.equipmentId === 'eq-1') as never);
    db.query.equipmentStatusHistory.findFirst.mockResolvedValue(HISTORY[0] as never);
  });

  it('throws NotFoundError for an unknown equipment', async () => {
    db.query.equipment.findFirst.mockResolvedValue(undefined);
    await expect(service.getEquipmentReport('missing', {})).rejects.toThrow(NotFoundError);
  });

  it('computes summary metrics: broken time, averages, last occurrence and recurrences', async () => {
    const report = await service.getEquipmentReport('eq-1', {});

    expect(report.equipment).toMatchObject({ id: 'eq-1', name: 'Projetor', status: 'broken' });
    expect(report.summary).toEqual({
      reportCount: 4,
      openCount: 1,
      resolvedCount: 2,
      dismissedCount: 1,
      breakdownCount: 2,
      repairCount: 1,
      timeInBrokenDays: 4.5,
      // (6h + 2h) / 2 acknowledged reports
      averageTimeToAcknowledgeHours: 4,
      // (24h + 120h) / 2 resolved reports; dismissed ones do not count
      averageTimeToResolveHours: 72,
      lastOccurrenceAt: '2026-09-14T03:00:00.000Z',
      recurrences: 2,
      isRecurrent: true,
    });
  });

  it('returns null averages when no report was acknowledged or resolved', async () => {
    db.query.equipmentReports.findMany.mockResolvedValue([]);
    const report = await service.getEquipmentReport('eq-1', {});

    expect(report.summary.averageTimeToAcknowledgeHours).toBeNull();
    expect(report.summary.averageTimeToResolveHours).toBeNull();
    expect(report.summary.recurrences).toBe(0);
    expect(report.summary.isRecurrent).toBe(false);
  });

  it('merges report lifecycle and status transitions into one chronological timeline', async () => {
    const report = await service.getEquipmentReport('eq-1', { from: '2026-09-05', to: '2026-09-07' });

    expect(report.timeline.map((e) => [e.type, e.at, e.label])).toEqual([
      ['report', '2026-09-05T03:00:00.000Z', 'Reportado (Importante)'],
      ['status', '2026-09-05T03:00:00.000Z', 'Funcionando → Com defeito'],
      ['report', '2026-09-05T09:00:00.000Z', 'Chamado em análise'],
      ['status', '2026-09-07T03:00:00.000Z', 'Com defeito → Em manutenção'],
    ]);
    expect(report.timeline[0]).toMatchObject({ severity: 'major', status: 'pending', author: 'Maria', description: 'Não liga' });
    expect(report.timeline[1]).toMatchObject({ status: 'broken', fromStatus: 'working', source: 'report', author: 'Maria' });
    expect(report.timeline[2]).toMatchObject({ status: 'acknowledged', author: 'João' });
  });

  it('labels dismissals with the reason and skips baseline snapshots', async () => {
    const report = await service.getEquipmentReport('eq-1', {});
    const labels = report.timeline.map((e) => e.label);

    expect(labels).toContain('Chamado descartado');
    expect(report.timeline.find((e) => e.label === 'Chamado descartado')!.description).toBe('Duplicado');
    expect(labels).toContain('Chamado resolvido');
    expect(report.timeline.some((e) => e.fromStatus === e.status && e.type === 'status')).toBe(false);
    // chronological
    const times = report.timeline.map((e) => e.at);
    expect([...times].sort()).toEqual(times);
  });

  it('builds the per-day series with broken fraction for the equipment', async () => {
    const report = await service.getEquipmentReport('eq-1', { from: '2026-09-04', to: '2026-09-07' });

    expect(report.series).toEqual([
      { date: '2026-09-04', reports: 0, brokenDays: 0 },
      { date: '2026-09-05', reports: 1, brokenDays: 1 },
      { date: '2026-09-06', reports: 0, brokenDays: 1 },
      { date: '2026-09-07', reports: 0, brokenDays: 0 },
    ]);
  });
});
