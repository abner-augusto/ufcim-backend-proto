import { eq, and, asc, count, desc, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { auditLogs, blockings, reservations, spaces, users } from '@/db/schema';
import type { Database } from '@/db/client';
import type { DepartmentAuditLogQuery } from '@/validators/department-audit-log.schema';

export interface DepartmentAuditSpaceSummary {
  id: string;
  name: string;
  number: string;
}

export interface DepartmentAuditLogItem {
  id: string;
  userId: string;
  actor: { id: string; name: string } | null;
  actionType: string;
  referenceId: string | null;
  referenceType: 'reservation' | 'blocking';
  timestamp: string;
  details: string | null;
  space: DepartmentAuditSpaceSummary | null;
  targetDate: string | null;
  targetEndDate: string | null;
  startTime: string | null;
  endTime: string | null;
  reservationId: string | null;
  recurrenceId: string | null;
}

interface RawLogRow {
  id: string;
  userId: string;
  actorName: string | null;
  actionType: string;
  referenceId: string | null;
  referenceType: string | null;
  timestamp: string;
  details: string | null;
}

interface RefReservation {
  id: string;
  recurrenceId: string | null;
  date: string;
  startTime: string;
  endTime: string;
  space: DepartmentAuditSpaceSummary | null;
}

interface RefBlocking {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  space: DepartmentAuditSpaceSummary | null;
}

function nextIsoDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function fortalezaMidnightUtcIso(isoDate: string): string {
  return `${isoDate}T03:00:00.000Z`;
}

function departmentScopeCondition(departmentId: string): SQL {
  return sql`(
    (${auditLogs.referenceType} = 'reservation' AND (
      EXISTS (
        SELECT 1 FROM ${reservations}
        INNER JOIN ${spaces} ON ${spaces.id} = ${reservations.spaceId}
        WHERE ${reservations.id} = ${auditLogs.referenceId}
          AND ${spaces.department} = ${departmentId}
      )
      OR EXISTS (
        SELECT 1 FROM ${reservations}
        INNER JOIN ${spaces} ON ${spaces.id} = ${reservations.spaceId}
        WHERE ${reservations.recurrenceId} = ${auditLogs.referenceId}
          AND ${spaces.department} = ${departmentId}
      )
    ))
    OR
    (${auditLogs.referenceType} = 'blocking' AND EXISTS (
      SELECT 1 FROM ${blockings}
      INNER JOIN ${spaces} ON ${spaces.id} = ${blockings.spaceId}
      WHERE ${blockings.id} = ${auditLogs.referenceId}
        AND ${spaces.department} = ${departmentId}
    ))
  )`;
}

function baseDepartmentScope(departmentId: string): SQL {
  return and(
    inArray(auditLogs.referenceType, ['reservation', 'blocking']),
    departmentScopeCondition(departmentId),
  )!;
}

function buildWhereClause(departmentId: string, filters: DepartmentAuditLogQuery): SQL {
  const conditions: SQL[] = [baseDepartmentScope(departmentId)];

  if (filters.userId) conditions.push(eq(auditLogs.userId, filters.userId));
  if (filters.actionType) conditions.push(eq(auditLogs.actionType, filters.actionType));
  if (filters.referenceType) conditions.push(eq(auditLogs.referenceType, filters.referenceType));
  if (filters.dateFrom) conditions.push(gte(auditLogs.timestamp, fortalezaMidnightUtcIso(filters.dateFrom)));
  if (filters.dateTo) conditions.push(lt(auditLogs.timestamp, fortalezaMidnightUtcIso(nextIsoDate(filters.dateTo))));

  return and(...conditions)!;
}

function emptyResponse(page: number, limit: number) {
  return {
    data: [] as DepartmentAuditLogItem[],
    pagination: { page, limit, total: 0, totalPages: 1 },
    actors: [] as { id: string; name: string }[],
  };
}

function collectRefIds(rows: RawLogRow[], type: 'reservation' | 'blocking'): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.referenceType === type && row.referenceId) ids.add(row.referenceId);
  }
  return [...ids];
}

function emptyTargetFields() {
  return {
    space: null,
    targetDate: null,
    targetEndDate: null,
    startTime: null,
    endTime: null,
    reservationId: null,
    recurrenceId: null,
  };
}

function blockingTargetFields(blk: RefBlocking | undefined) {
  if (!blk) return emptyTargetFields();
  return {
    space: blk.space,
    targetDate: blk.date,
    targetEndDate: null,
    startTime: blk.startTime,
    endTime: blk.endTime,
    reservationId: null,
    recurrenceId: null,
  };
}

function reservationTargetFields(
  refId: string | null,
  reservationById: Map<string, RefReservation>,
  seriesByRecurrenceId: Map<string, RefReservation[]>,
) {
  if (!refId) return emptyTargetFields();
  const single = reservationById.get(refId);
  if (single) {
    return {
      space: single.space,
      targetDate: single.date,
      targetEndDate: null,
      startTime: single.startTime,
      endTime: single.endTime,
      reservationId: single.id,
      recurrenceId: single.recurrenceId,
    };
  }
  const series = seriesByRecurrenceId.get(refId);
  if (!series?.length) return emptyTargetFields();
  const first = series[0];
  const last = series[series.length - 1];
  return {
    space: first.space,
    targetDate: first.date,
    targetEndDate: last.date !== first.date ? last.date : null,
    startTime: first.startTime,
    endTime: first.endTime,
    reservationId: first.id,
    recurrenceId: refId,
  };
}

function mapAuditRow(
  row: RawLogRow,
  reservationById: Map<string, RefReservation>,
  seriesByRecurrenceId: Map<string, RefReservation[]>,
  blockingById: Map<string, RefBlocking>,
): DepartmentAuditLogItem {
  const referenceType = row.referenceType === 'blocking' ? 'blocking' : 'reservation';
  const target = referenceType === 'blocking'
    ? blockingTargetFields(row.referenceId ? blockingById.get(row.referenceId) : undefined)
    : reservationTargetFields(row.referenceId, reservationById, seriesByRecurrenceId);

  return {
    id: row.id,
    userId: row.userId,
    actor: row.actorName ? { id: row.userId, name: row.actorName } : null,
    actionType: row.actionType,
    referenceId: row.referenceId,
    referenceType,
    timestamp: row.timestamp,
    details: row.details,
    ...target,
  };
}

export class DepartmentAuditLogService {
  constructor(private db: Database) {}

  private async resolveDepartment(viewerId: string, tokenDepartment?: string): Promise<string | null> {
    if (tokenDepartment && tokenDepartment !== 'Unknown') return tokenDepartment;
    const row = await this.db.query.users.findFirst({
      where: eq(users.id, viewerId),
      columns: { department: true },
    });
    return row?.department && row.department !== 'Unknown' ? row.department : null;
  }

  private async loadSeriesByRecurrenceId(recurrenceIds: string[]): Promise<Map<string, RefReservation[]>> {
    const map = new Map<string, RefReservation[]>();
    if (recurrenceIds.length === 0) return map;

    const seriesRows = await this.db.query.reservations.findMany({
      where: inArray(reservations.recurrenceId, recurrenceIds),
      columns: { id: true, recurrenceId: true, date: true, startTime: true, endTime: true },
      with: { space: { columns: { id: true, name: true, number: true } } },
      orderBy: (r, { asc: ascOrder }) => [ascOrder(r.date), ascOrder(r.startTime)],
    });
    for (const row of seriesRows) {
      if (!row.recurrenceId) continue;
      const list = map.get(row.recurrenceId) ?? [];
      list.push(row);
      map.set(row.recurrenceId, list);
    }
    return map;
  }

  private async loadReferences(rows: RawLogRow[]) {
    const resIds = collectRefIds(rows, 'reservation');
    const blkIds = collectRefIds(rows, 'blocking');

    const [directReservations, loadedBlockings] = await Promise.all([
      resIds.length > 0
        ? this.db.query.reservations.findMany({
            where: inArray(reservations.id, resIds),
            columns: { id: true, recurrenceId: true, date: true, startTime: true, endTime: true },
            with: { space: { columns: { id: true, name: true, number: true } } },
          })
        : Promise.resolve([] as RefReservation[]),
      blkIds.length > 0
        ? this.db.query.blockings.findMany({
            where: inArray(blockings.id, blkIds),
            columns: { id: true, date: true, startTime: true, endTime: true },
            with: { space: { columns: { id: true, name: true, number: true } } },
          })
        : Promise.resolve([] as RefBlocking[]),
    ]);

    const reservationById = new Map(directReservations.map((r) => [r.id, r]));
    const unresolvedResIds = resIds.filter((id) => !reservationById.has(id));
    const seriesByRecurrenceId = await this.loadSeriesByRecurrenceId(unresolvedResIds);

    return {
      reservationById,
      seriesByRecurrenceId,
      blockingById: new Map(loadedBlockings.map((b) => [b.id, b])),
    };
  }

  async list(viewerId: string, tokenDepartment: string | undefined, filters: DepartmentAuditLogQuery) {
    const departmentId = await this.resolveDepartment(viewerId, tokenDepartment);
    if (!departmentId) return emptyResponse(filters.page, filters.limit);

    const where = buildWhereClause(departmentId, filters);
    const offset = (filters.page - 1) * filters.limit;

    const [rows, [countRow], actors] = await Promise.all([
      this.db
        .select({
          id: auditLogs.id,
          userId: auditLogs.userId,
          actorName: users.name,
          actionType: auditLogs.actionType,
          referenceId: auditLogs.referenceId,
          referenceType: auditLogs.referenceType,
          timestamp: auditLogs.timestamp,
          details: auditLogs.details,
        })
        .from(auditLogs)
        .leftJoin(users, eq(auditLogs.userId, users.id))
        .where(where)
        .orderBy(desc(auditLogs.timestamp), desc(auditLogs.id))
        .limit(filters.limit)
        .offset(offset),
      this.db.select({ total: count() }).from(auditLogs).where(where),
      this.db
        .selectDistinct({ id: users.id, name: users.name })
        .from(auditLogs)
        .innerJoin(users, eq(auditLogs.userId, users.id))
        .where(baseDepartmentScope(departmentId))
        .orderBy(asc(users.name)),
    ]);

    const refs = await this.loadReferences(rows);
    const total = countRow?.total ?? 0;

    return {
      data: rows.map((row) =>
        mapAuditRow(row, refs.reservationById, refs.seriesByRecurrenceId, refs.blockingById),
      ),
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / filters.limit)),
      },
      actors,
    };
  }
}
