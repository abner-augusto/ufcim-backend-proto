import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, type Database } from '@/db/client';
import {
  auditLogs,
  blockings,
  departments,
  recurrences,
  reservations,
  spaces,
  users,
} from '@/db/schema';
import { DepartmentAuditLogService } from '@/services/department-audit-log.service';
import { createSqliteD1, sqlite } from '../helpers/d1-sqlite';

const NOW = '2026-01-01T00:00:00.000Z';

function withD1Raw(
  d1: D1Database,
  raw: ReturnType<typeof createSqliteD1>['raw'],
): D1Database {
  const wrapStmt = (sql: string, params: unknown[] = []) => {
    const inner = d1.prepare(sql).bind(...params) as D1PreparedStatement & {
      raw?: () => Promise<unknown[][]>;
    };
    return {
      bind: (...nextParams: unknown[]) => wrapStmt(sql, nextParams),
      first: <T>() => inner.first<T>(),
      all: <T>() => inner.all<T>(),
      run: () => inner.run(),
      raw: async () => raw.prepare(sql).all(...params).map((row) => Object.values(row)),
    };
  };
  return {
    prepare: (sql: string) => wrapStmt(sql),
    batch: (stmts: D1PreparedStatement[]) => d1.batch(stmts),
  } as unknown as D1Database;
}

describe.skipIf(!sqlite)('DepartmentAuditLogService.list (#60)', () => {
  let db: Database;
  let service: DepartmentAuditLogService;

  beforeEach(async () => {
    const { d1, raw } = createSqliteD1();
    db = createDb(withD1Raw(d1, raw));
    service = new DepartmentAuditLogService(db);

    await db.insert(departments).values([
      { id: 'iaud', name: 'IAUD', campus: 'Benfica', createdAt: NOW, updatedAt: NOW },
      { id: 'dc', name: 'DC', campus: 'Pici', createdAt: NOW, updatedAt: NOW },
    ]);

    await db.insert(users).values([
      { id: 'staff-1', name: 'Carlos Oliveira', role: 'staff', department: 'iaud', email: 'carlos@ufc.br', createdAt: NOW, updatedAt: NOW },
      { id: 'staff-2', name: 'Ana Paula', role: 'staff', department: 'iaud', email: 'ana@ufc.br', createdAt: NOW, updatedAt: NOW },
      { id: 'prof-1', name: 'Dra. Maria Costa', role: 'professor', department: 'iaud', email: 'maria@ufc.br', createdAt: NOW, updatedAt: NOW },
      { id: 'dc-staff', name: 'Técnico DC', role: 'staff', department: 'dc', email: 'dc@ufc.br', createdAt: NOW, updatedAt: NOW },
    ]);

    await db.insert(spaces).values([
      { id: 'sp-iaud-1', name: 'Sala de Leitura', number: 'B1-01', type: 'study_room', block: 'Bloco 1', campus: 'Benfica', department: 'iaud', capacity: 40, createdAt: NOW, updatedAt: NOW },
      { id: 'sp-iaud-2', name: 'LEAU', number: 'B1-02', type: 'study_room', block: 'Bloco 1', campus: 'Benfica', department: 'iaud', capacity: 20, createdAt: NOW, updatedAt: NOW },
      { id: 'sp-dc-1', name: 'Lab DC', number: 'D1-01', type: 'classroom', block: 'Bloco 910', campus: 'Pici', department: 'dc', capacity: 30, createdAt: NOW, updatedAt: NOW },
    ]);

    await db.insert(recurrences).values({
      id: 'rec-1',
      description: 'Ateliê Semanal',
      createdBy: 'staff-1',
      createdAt: NOW,
    });

    await db.insert(reservations).values([
      {
        id: 'res-iaud-1',
        spaceId: 'sp-iaud-1',
        userId: 'staff-1',
        createdBy: 'staff-1',
        date: '2026-06-10',
        timeSlot: 'morning',
        startTime: '08:00',
        endTime: '10:00',
        status: 'confirmed',
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: 'res-iaud-series-1',
        spaceId: 'sp-iaud-2',
        userId: 'staff-1',
        createdBy: 'staff-1',
        recurrenceId: 'rec-1',
        date: '2026-06-15',
        timeSlot: 'afternoon',
        startTime: '14:00',
        endTime: '16:00',
        status: 'confirmed',
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: 'res-iaud-series-2',
        spaceId: 'sp-iaud-2',
        userId: 'staff-1',
        createdBy: 'staff-1',
        recurrenceId: 'rec-1',
        date: '2026-06-22',
        timeSlot: 'afternoon',
        startTime: '14:00',
        endTime: '16:00',
        status: 'confirmed',
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: 'res-dc-1',
        spaceId: 'sp-dc-1',
        userId: 'dc-staff',
        createdBy: 'dc-staff',
        date: '2026-06-11',
        timeSlot: 'morning',
        startTime: '08:00',
        endTime: '10:00',
        status: 'confirmed',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);

    await db.insert(blockings).values([
      {
        id: 'blk-iaud-1',
        spaceId: 'sp-iaud-2',
        createdBy: 'staff-2',
        date: '2026-06-12',
        timeSlot: 'evening',
        startTime: '18:00',
        endTime: '20:00',
        reason: 'Manutenção elétrica',
        blockType: 'maintenance',
        status: 'active',
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: 'blk-dc-1',
        spaceId: 'sp-dc-1',
        createdBy: 'dc-staff',
        date: '2026-06-12',
        timeSlot: 'evening',
        startTime: '18:00',
        endTime: '20:00',
        reason: 'Reforma DC',
        blockType: 'administrative',
        status: 'active',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);

    await db.insert(auditLogs).values([
      {
        id: 'log-res-create',
        userId: 'staff-1',
        actionType: 'create_reservation',
        referenceId: 'res-iaud-1',
        referenceType: 'reservation',
        timestamp: '2026-05-10T14:00:00.000Z',
        details: 'Reservou o espaço B1-01',
      },
      {
        id: 'log-res-series',
        userId: 'staff-1',
        actionType: 'create_recurring_reservation',
        referenceId: 'rec-1',
        referenceType: 'reservation',
        timestamp: '2026-05-11T01:30:00.000Z', // 22:30 of 2026-05-10 in Fortaleza (UTC-3)
        details: 'Reservou 2 datas do espaço B1-02',
      },
      {
        id: 'log-blk-create',
        userId: 'staff-2',
        actionType: 'create_blocking',
        referenceId: 'blk-iaud-1',
        referenceType: 'blocking',
        timestamp: '2026-05-12T15:00:00.000Z',
        details: 'Bloqueou o espaço B1-02',
      },
      {
        id: 'log-login',
        userId: 'staff-1',
        actionType: 'auth.login.success',
        referenceId: 'staff-1',
        referenceType: 'user',
        timestamp: '2026-05-13T10:00:00.000Z',
        details: null,
      },
      {
        id: 'log-admin-space',
        userId: 'staff-1',
        actionType: 'create_space',
        referenceId: 'sp-iaud-1',
        referenceType: 'space',
        timestamp: '2026-05-13T11:00:00.000Z',
        details: 'Criou o espaço B1-01',
      },
      {
        id: 'log-dc-res',
        userId: 'dc-staff',
        actionType: 'create_reservation',
        referenceId: 'res-dc-1',
        referenceType: 'reservation',
        timestamp: '2026-05-13T12:00:00.000Z',
        details: 'Reservou o espaço D1-01',
      },
      {
        id: 'log-dc-blk',
        userId: 'dc-staff',
        actionType: 'create_blocking',
        referenceId: 'blk-dc-1',
        referenceType: 'blocking',
        timestamp: '2026-05-13T13:00:00.000Z',
        details: 'Bloqueou o espaço D1-01',
      },
    ]);
  });

  it('returns only reservation and blocking actions of the staff department, excluding login, admin, and other departments', async () => {
    const result = await service.list('staff-1', 'iaud', { page: 1, limit: 20 });

    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 3, totalPages: 1 });
    expect(result.data.map((item) => item.id)).toEqual([
      'log-blk-create',
      'log-res-series',
      'log-res-create',
    ]);

    const byId = Object.fromEntries(result.data.map((item) => [item.id, item]));
    expect(byId['log-res-create']).toMatchObject({
      actor: { id: 'staff-1', name: 'Carlos Oliveira' },
      actionType: 'create_reservation',
      referenceType: 'reservation',
      space: { id: 'sp-iaud-1', name: 'Sala de Leitura', number: 'B1-01' },
      targetDate: '2026-06-10',
      targetEndDate: null,
      startTime: '08:00',
      endTime: '10:00',
      reservationId: 'res-iaud-1',
      recurrenceId: null,
    });

    expect(byId['log-res-series']).toMatchObject({
      actor: { id: 'staff-1', name: 'Carlos Oliveira' },
      actionType: 'create_recurring_reservation',
      space: { id: 'sp-iaud-2', name: 'LEAU', number: 'B1-02' },
      targetDate: '2026-06-15',
      targetEndDate: '2026-06-22',
      reservationId: 'res-iaud-series-1',
      recurrenceId: 'rec-1',
    });

    expect(byId['log-blk-create']).toMatchObject({
      actor: { id: 'staff-2', name: 'Ana Paula' },
      actionType: 'create_blocking',
      referenceType: 'blocking',
      space: { id: 'sp-iaud-2', name: 'LEAU', number: 'B1-02' },
      targetDate: '2026-06-12',
      startTime: '18:00',
      endTime: '20:00',
      reservationId: null,
      recurrenceId: null,
    });

    expect(JSON.stringify(result.data)).not.toContain('carlos@ufc.br');
    expect(JSON.stringify(result.data)).not.toContain('ana@ufc.br');

    expect(result.actors).toEqual([
      { id: 'staff-2', name: 'Ana Paula' },
      { id: 'staff-1', name: 'Carlos Oliveira' },
    ]);
  });

  it('filters by userId (person), actionType, referenceType, and campus-local date range', async () => {
    const byPerson = await service.list('staff-1', 'iaud', { userId: 'staff-2', page: 1, limit: 20 });
    expect(byPerson.data.map((i) => i.id)).toEqual(['log-blk-create']);

    const byAction = await service.list('staff-1', 'iaud', { actionType: 'create_reservation', page: 1, limit: 20 });
    expect(byAction.data.map((i) => i.id)).toEqual(['log-res-create']);

    const byRefType = await service.list('staff-1', 'iaud', { referenceType: 'blocking', page: 1, limit: 20 });
    expect(byRefType.data.map((i) => i.id)).toEqual(['log-blk-create']);

    // Campus day 2026-05-10 includes 2026-05-10T14:00Z and 2026-05-11T01:30Z (22:30 Fortaleza time)
    const onMay10 = await service.list('staff-1', 'iaud', { dateFrom: '2026-05-10', dateTo: '2026-05-10', page: 1, limit: 20 });
    expect(onMay10.data.map((i) => i.id)).toEqual(['log-res-series', 'log-res-create']);
  });

  it('paginates deterministically and handles missing or unknown department', async () => {
    const page1 = await service.list('staff-1', 'iaud', { page: 1, limit: 2 });
    const page2 = await service.list('staff-1', 'iaud', { page: 2, limit: 2 });
    expect(page1.pagination).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect(page1.data.map((i) => i.id)).toEqual(['log-blk-create', 'log-res-series']);
    expect(page2.data.map((i) => i.id)).toEqual(['log-res-create']);

    const fromDb = await service.list('staff-2', undefined, { page: 1, limit: 20 });
    expect(fromDb.pagination.total).toBe(3);

    const unknown = await service.list('non-existent', 'Unknown', { page: 1, limit: 20 });
    expect(unknown).toEqual({
      data: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
      actors: [],
    });
  });
});
