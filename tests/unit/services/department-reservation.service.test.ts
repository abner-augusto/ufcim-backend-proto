import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, type Database } from '@/db/client';
import { departments, spaces, users, reservations } from '@/db/schema';
import { DepartmentReservationService } from '@/services/department-reservation.service';
import { createSqliteD1, sqlite } from '../helpers/d1-sqlite';

const NOW = '2026-01-01T00:00:00.000Z';

function withD1Raw(
  d1: D1Database,
  raw: ReturnType<typeof createSqliteD1>['raw']
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

describe.skipIf(!sqlite)('DepartmentReservationService.list (MEL-031)', () => {
  let db: Database;
  let service: DepartmentReservationService;

  beforeEach(async () => {
    const { d1, raw } = createSqliteD1();
    db = createDb(withD1Raw(d1, raw));
    service = new DepartmentReservationService(db);

    await db.insert(departments).values([
      { id: 'iaud', name: 'IAUD', campus: 'Benfica', createdAt: NOW, updatedAt: NOW },
      { id: 'dc', name: 'DC', campus: 'Pici', createdAt: NOW, updatedAt: NOW },
    ]);

    await db.insert(users).values([
      { id: 'staff-1', name: 'Carlos Oliveira', role: 'staff', department: 'iaud', email: 'carlos@ufc.br', createdAt: NOW, updatedAt: NOW },
      { id: 'staff-2', name: 'Ana Paula', role: 'staff', department: 'iaud', email: 'ana@ufc.br', createdAt: NOW, updatedAt: NOW },
      { id: 'prof-1', name: 'Dra. Maria Costa', role: 'professor', department: 'iaud', email: 'maria@ufc.br', createdAt: NOW, updatedAt: NOW },
      { id: 'stud-1', name: 'João Silva', role: 'student', department: 'iaud', email: 'joao@alu.ufc.br', createdAt: NOW, updatedAt: NOW },
      { id: 'dc-prof', name: 'Prof. DC', role: 'professor', department: 'dc', email: 'dc@ufc.br', createdAt: NOW, updatedAt: NOW },
    ]);

    await db.insert(spaces).values([
      { id: 'sp-iaud-1', name: 'Sala de Leitura', number: 'B1-01', type: 'study_room', block: 'Bloco 1', campus: 'Benfica', department: 'iaud', capacity: 40, createdAt: NOW, updatedAt: NOW },
      { id: 'sp-iaud-2', name: 'LEAU', number: 'B1-02', type: 'study_room', block: 'Bloco 1', campus: 'Benfica', department: 'iaud', capacity: 20, createdAt: NOW, updatedAt: NOW },
      { id: 'sp-dc-1', name: 'Lab DC', number: 'D1-01', type: 'classroom', block: 'Bloco 910', campus: 'Pici', department: 'dc', capacity: 30, createdAt: NOW, updatedAt: NOW },
    ]);

    await db.insert(reservations).values([
      {
        id: 'res-1',
        spaceId: 'sp-iaud-1',
        userId: 'staff-1',
        createdBy: 'staff-1',
        requesterUserId: 'prof-1',
        requesterName: null,
        requesterContact: '85 99999-0001',
        date: '2026-06-10',
        timeSlot: 'morning',
        startTime: '08:00',
        endTime: '10:00',
        status: 'confirmed',
        description: 'Aula aberta',
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: 'res-2',
        spaceId: 'sp-iaud-2',
        userId: 'prof-1',
        createdBy: 'prof-1',
        requesterUserId: null,
        requesterName: null,
        requesterContact: null,
        date: '2026-06-12',
        timeSlot: 'afternoon',
        startTime: '14:00',
        endTime: '16:00',
        status: 'confirmed',
        description: 'Orientação',
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: 'res-3',
        spaceId: 'sp-iaud-1',
        userId: 'staff-2',
        createdBy: 'staff-2',
        requesterUserId: null,
        requesterName: 'Centro Acadêmico',
        requesterContact: 'ca@iaud.ufc.br',
        date: '2026-06-15',
        timeSlot: 'evening',
        startTime: '19:00',
        endTime: '21:00',
        status: 'canceled',
        cancelReason: 'Evento adiado',
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: 'res-4',
        spaceId: 'sp-iaud-2',
        userId: 'stud-1',
        createdBy: 'stud-1',
        requesterUserId: null,
        requesterName: null,
        requesterContact: null,
        date: '2026-06-20',
        timeSlot: 'morning',
        startTime: '09:00',
        endTime: '11:00',
        status: 'modified',
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: 'res-dc',
        spaceId: 'sp-dc-1',
        userId: 'dc-prof',
        createdBy: 'dc-prof',
        requesterUserId: null,
        requesterName: null,
        requesterContact: null,
        date: '2026-06-18',
        timeSlot: 'morning',
        startTime: '08:00',
        endTime: '10:00',
        status: 'confirmed',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
  });

  it('lists only reservations of the staff member department with registeredBy, requester, contact, and facets', async () => {
    const result = await service.list('staff-1', 'iaud', { page: 1, limit: 20 });

    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 4, totalPages: 1 });
    expect(result.data.map((r) => r.id)).toEqual(['res-4', 'res-3', 'res-2', 'res-1']);

    const byId = Object.fromEntries(result.data.map((r) => [r.id, r]));
    expect(byId['res-1'].registeredBy).toEqual({ id: 'staff-1', name: 'Carlos Oliveira' });
    expect(byId['res-1'].requester).toEqual({ userId: 'prof-1', name: 'Dra. Maria Costa' });
    expect(byId['res-1'].requesterContact).toBe('85 99999-0001');

    expect(byId['res-3'].registeredBy).toEqual({ id: 'staff-2', name: 'Ana Paula' });
    expect(byId['res-3'].requester).toEqual({ userId: null, name: 'Centro Acadêmico' });
    expect(byId['res-3'].requesterContact).toBe('ca@iaud.ufc.br');

    expect(byId['res-2'].registeredBy).toEqual({ id: 'prof-1', name: 'Dra. Maria Costa' });
    expect(byId['res-2'].requester).toBeNull();

    expect(JSON.stringify(result.data)).not.toContain('maria@ufc.br');
    expect(JSON.stringify(result.data)).not.toContain('carlos@ufc.br');

    expect(result.spaces.map((s) => s.id)).toEqual(['sp-iaud-2', 'sp-iaud-1']);
    expect(result.creators).toEqual([
      { id: 'staff-2', name: 'Ana Paula' },
      { id: 'staff-1', name: 'Carlos Oliveira' },
      { id: 'prof-1', name: 'Dra. Maria Costa' },
      { id: 'stud-1', name: 'João Silva' },
    ]);
  });

  it('paginates deterministically in SQL', async () => {
    const page1 = await service.list('staff-1', 'iaud', { page: 1, limit: 2 });
    const page2 = await service.list('staff-1', 'iaud', { page: 2, limit: 2 });

    expect(page1.pagination).toEqual({ page: 1, limit: 2, total: 4, totalPages: 2 });
    expect(page1.data.map((r) => r.id)).toEqual(['res-4', 'res-3']);
    expect(page2.pagination).toEqual({ page: 2, limit: 2, total: 4, totalPages: 2 });
    expect(page2.data.map((r) => r.id)).toEqual(['res-2', 'res-1']);
  });

  it('filters by createdBy, spaceId, date range, and status', async () => {
    const byCreator = await service.list('staff-1', 'iaud', { createdBy: 'staff-1', page: 1, limit: 20 });
    expect(byCreator.data.map((r) => r.id)).toEqual(['res-1']);

    const bySpace = await service.list('staff-1', 'iaud', { spaceId: 'sp-iaud-2', page: 1, limit: 20 });
    expect(bySpace.data.map((r) => r.id)).toEqual(['res-4', 'res-2']);

    const byPeriod = await service.list('staff-1', 'iaud', { dateFrom: '2026-06-11', dateTo: '2026-06-16', page: 1, limit: 20 });
    expect(byPeriod.data.map((r) => r.id)).toEqual(['res-3', 'res-2']);

    const activeOnly = await service.list('staff-1', 'iaud', { status: 'active', page: 1, limit: 20 });
    expect(activeOnly.data.map((r) => r.id)).toEqual(['res-4', 'res-2', 'res-1']);

    const canceledOnly = await service.list('staff-1', 'iaud', { status: 'canceled', page: 1, limit: 20 });
    expect(canceledOnly.data.map((r) => r.id)).toEqual(['res-3']);

    const modifiedOnly = await service.list('staff-1', 'iaud', { status: 'modified', page: 1, limit: 20 });
    expect(modifiedOnly.data.map((r) => r.id)).toEqual(['res-4']);
  });

  it('falls back to the user row when token department is omitted and handles unknown department', async () => {
    const fromDb = await service.list('staff-2', undefined, { page: 1, limit: 20 });
    expect(fromDb.pagination.total).toBe(4);

    const unknown = await service.list('non-existent', 'Unknown', { page: 1, limit: 20 });
    expect(unknown).toEqual({
      data: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
      spaces: [],
      creators: [],
    });
  });
});
