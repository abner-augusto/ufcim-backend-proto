import { and, asc, eq, gte, lt } from 'drizzle-orm';
import { equipment, equipmentReports, equipmentStatusHistory } from '@/db/schema';
import type { Database } from '@/db/client';
import { AppError, NotFoundError } from '@/middleware/error-handler';
import { campusToday } from '@/lib/clock';
import { departmentName } from '@/lib/department-name';

/**
 * Equipment maintenance history report (MEL-013).
 *
 * Combines the ticket cycle in `equipment_reports` with the forward-only
 * `equipment_status_history`. Time "broken" is the sum of intervals from a
 * transition into `broken` to the next transition out of it; an interval still
 * open counts up to now. Everything is clipped to a campus-date window of at
 * most 90 days.
 */

export const MAX_MAINTENANCE_RANGE_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** Fortaleza is UTC-3 all year (no DST), so campus midnight is 03:00Z. */
const CAMPUS_UTC_OFFSET = '-03:00';

const SEVERITY_LABELS: Record<string, string> = {
  minor: 'Leve',
  major: 'Importante',
  blocking: 'Crítico',
};

const STATUS_LABELS: Record<string, string> = {
  working: 'Funcionando',
  broken: 'Com defeito',
  under_repair: 'Em manutenção',
  replacement_scheduled: 'Substituição agendada',
};

const SERIOUS_SEVERITIES = new Set(['major', 'blocking']);
const OPEN_REPORT_STATUSES = new Set(['pending', 'acknowledged']);

export type Severity = 'minor' | 'major' | 'blocking';
export type HistorySource = 'report' | 'manual' | 'system';

export interface MaintenanceRangeInput {
  from?: string;
  to?: string;
}

export interface MaintenanceListFilters extends MaintenanceRangeInput {
  spaceId?: string;
  departmentId?: string;
  equipmentId?: string;
  status?: string;
  severity?: Severity;
}

export interface ResolvedRange {
  from: string;
  to: string;
  days: number;
  /** Campus midnight of `from`, epoch ms. */
  startMs: number;
  /** Campus midnight of the day after `to` (exclusive), epoch ms. */
  endMs: number;
}

export interface Interval {
  start: number;
  end: number;
}

export interface SeriesPoint {
  date: string;
  reports: number;
  /** Broken time that day, in equipment-days (1 = one item broken all day). */
  brokenDays: number;
}

export interface MaintenanceCounts {
  reportCount: number;
  openCount: number;
  resolvedCount: number;
  dismissedCount: number;
  /** Transitions into `broken` within the window. */
  breakdownCount: number;
  /** Transitions back to `working` within the window. */
  repairCount: number;
  timeInBrokenDays: number;
  /** Resolved `major`/`blocking` reports in the window. */
  recurrences: number;
  /** Two or more resolved serious reports: the fix did not hold. */
  isRecurrent: boolean;
}

export interface EquipmentSpaceInfo {
  id: string;
  name: string;
  number: string;
  block: string;
  department: string;
}

export interface MaintenanceEquipmentRow extends MaintenanceCounts {
  id: string;
  name: string;
  assetId: string;
  type: string;
  status: string;
  space: EquipmentSpaceInfo | null;
  lastReportAt: string | null;
  lastSeverity: Severity | null;
}

export interface TimelineEvent {
  id: string;
  type: 'report' | 'status';
  at: string;
  label: string;
  severity?: Severity;
  /** Report: lifecycle step reached. Status: the status entered. */
  status?: string;
  fromStatus?: string;
  source?: HistorySource;
  author?: string;
  description?: string;
}

interface HistoryRow {
  id: string;
  equipmentId: string;
  fromStatus: string;
  toStatus: string;
  changedAt: string;
  source: string;
  changer?: { name: string } | null;
}

interface ReportRow {
  id: string;
  equipmentId: string;
  description: string;
  severity: string;
  status: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  dismissedReason: string | null;
  createdAt: string;
  reporter?: { name: string } | null;
  acknowledger?: { name: string } | null;
}

interface EquipmentRow {
  id: string;
  name: string;
  assetId: string;
  type: string;
  status: string;
  notes?: string | null;
  updatedAt?: string;
  spaceId: string;
  space?: {
    id: string;
    name: string;
    number: string;
    block: string;
    department: unknown;
  } | null;
}

// ─── Pure helpers ──────────────────────────────────────────────────────────

function campusMidnightMs(date: string): number {
  return Date.parse(`${date}T00:00:00${CAMPUS_UTC_OFFSET}`);
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Campus-date window; defaults to the 90 days ending today. Throws on bad input. */
export function resolveRange(input: MaintenanceRangeInput, now: Date): ResolvedRange {
  const to = input.to ?? campusToday(now);
  const from = input.from ?? shiftDate(to, -(MAX_MAINTENANCE_RANGE_DAYS - 1));

  const startMs = campusMidnightMs(from);
  const toMs = campusMidnightMs(to);
  if (isNaN(startMs) || isNaN(toMs)) {
    throw new AppError(400, 'Datas inválidas. Use o formato AAAA-MM-DD.', 'INVALID_DATE');
  }
  if (startMs > toMs) {
    throw new AppError(400, 'A data inicial não pode ser posterior à final', 'INVALID_DATE_RANGE');
  }

  const days = Math.round((toMs - startMs) / DAY_MS) + 1;
  if (days > MAX_MAINTENANCE_RANGE_DAYS) {
    throw new AppError(
      400,
      `O período máximo permitido é de ${MAX_MAINTENANCE_RANGE_DAYS} dias`,
      'RANGE_TOO_LARGE'
    );
  }

  return { from, to, days, startMs, endMs: toMs + DAY_MS };
}

/**
 * Broken intervals from chronologically ordered transitions. A transition into
 * `broken` opens an interval (unless one is open); any other target closes it.
 * An interval still open ends at `nowMs`.
 */
export function brokenIntervals(
  history: Array<{ toStatus: string; changedAt: string }>,
  nowMs: number
): Interval[] {
  const intervals: Interval[] = [];
  let openStart: number | null = null;

  for (const row of history) {
    const at = Date.parse(row.changedAt);
    if (row.toStatus === 'broken') {
      if (openStart === null) openStart = at;
    } else if (openStart !== null) {
      intervals.push({ start: openStart, end: at });
      openStart = null;
    }
  }
  if (openStart !== null && openStart < nowMs) {
    intervals.push({ start: openStart, end: nowMs });
  }
  return intervals;
}

/** Total length of `intervals` inside [from, to). */
export function overlapMs(intervals: Interval[], from: number, to: number): number {
  let total = 0;
  for (const { start, end } of intervals) {
    const s = Math.max(start, from);
    const e = Math.min(end, to);
    if (e > s) total += e - s;
  }
  return total;
}

function isTransition(row: HistoryRow): boolean {
  return row.fromStatus !== row.toStatus;
}

function inWindow(iso: string | null, range: ResolvedRange): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return t >= range.startMs && t < range.endMs;
}

function sortHistory(rows: HistoryRow[]): HistoryRow[] {
  return [...rows].sort((a, b) => a.changedAt.localeCompare(b.changedAt));
}

function computeCounts(
  reports: ReportRow[],
  history: HistoryRow[],
  intervals: Interval[],
  range: ResolvedRange,
  nowMs: number
): MaintenanceCounts {
  const transitions = history.filter((h) => isTransition(h) && inWindow(h.changedAt, range));
  const recurrences = reports.filter(
    (r) => r.status === 'resolved' && SERIOUS_SEVERITIES.has(r.severity)
  ).length;
  const brokenMs = overlapMs(intervals, range.startMs, Math.min(range.endMs, nowMs));

  return {
    reportCount: reports.length,
    openCount: reports.filter((r) => OPEN_REPORT_STATUSES.has(r.status)).length,
    resolvedCount: reports.filter((r) => r.status === 'resolved').length,
    dismissedCount: reports.filter((r) => r.status === 'dismissed').length,
    breakdownCount: transitions.filter((h) => h.toStatus === 'broken').length,
    repairCount: transitions.filter((h) => h.toStatus === 'working').length,
    timeInBrokenDays: round(brokenMs / DAY_MS, 1),
    recurrences,
    isRecurrent: recurrences >= 2,
  };
}

function buildSeries(
  range: ResolvedRange,
  reports: ReportRow[],
  intervalSets: Interval[][],
  nowMs: number
): SeriesPoint[] {
  const reportsByDate = new Map<string, number>();
  for (const r of reports) {
    const date = campusToday(new Date(r.createdAt));
    reportsByDate.set(date, (reportsByDate.get(date) ?? 0) + 1);
  }

  const series: SeriesPoint[] = [];
  for (let i = 0; i < range.days; i++) {
    const date = shiftDate(range.from, i);
    const dayStart = campusMidnightMs(date);
    const dayEnd = Math.min(dayStart + DAY_MS, nowMs);
    let brokenMs = 0;
    for (const intervals of intervalSets) brokenMs += overlapMs(intervals, dayStart, dayEnd);
    series.push({
      date,
      reports: reportsByDate.get(date) ?? 0,
      brokenDays: round(brokenMs / DAY_MS, 2),
    });
  }
  return series;
}

function lastReport(reports: ReportRow[]): ReportRow | null {
  let latest: ReportRow | null = null;
  for (const r of reports) {
    if (!latest || r.createdAt > latest.createdAt) latest = r;
  }
  return latest;
}

function spaceInfo(row: EquipmentRow): EquipmentSpaceInfo | null {
  if (!row.space) return null;
  return {
    id: row.space.id,
    name: row.space.name,
    number: row.space.number,
    block: row.space.block,
    department: departmentName(row.space.department),
  };
}

function departmentId(dept: unknown): string {
  if (dept && typeof dept === 'object' && 'id' in dept) {
    return typeof dept.id === 'string' ? dept.id : '';
  }
  return typeof dept === 'string' ? dept : '';
}

function buildTimeline(reports: ReportRow[], history: HistoryRow[], range: ResolvedRange): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const r of reports) {
    const severity = r.severity as Severity;
    events.push({
      id: `report:${r.id}`,
      type: 'report',
      at: r.createdAt,
      label: `Reportado (${SEVERITY_LABELS[r.severity] ?? r.severity})`,
      severity,
      status: 'pending',
      author: r.reporter?.name,
      description: r.description,
    });
    if (r.acknowledgedAt && inWindow(r.acknowledgedAt, range)) {
      events.push({
        id: `report-ack:${r.id}`,
        type: 'report',
        at: r.acknowledgedAt,
        label: 'Chamado em análise',
        severity,
        status: 'acknowledged',
        author: r.acknowledger?.name,
      });
    }
    if (r.resolvedAt && inWindow(r.resolvedAt, range)) {
      const dismissed = r.status === 'dismissed';
      events.push({
        id: `report-close:${r.id}`,
        type: 'report',
        at: r.resolvedAt,
        label: dismissed ? 'Chamado descartado' : 'Chamado resolvido',
        severity,
        status: dismissed ? 'dismissed' : 'resolved',
        description: dismissed ? r.dismissedReason ?? undefined : undefined,
      });
    }
  }

  for (const h of history) {
    if (!isTransition(h) || !inWindow(h.changedAt, range)) continue;
    events.push({
      id: `status:${h.id}`,
      type: 'status',
      at: h.changedAt,
      label: `${STATUS_LABELS[h.fromStatus] ?? h.fromStatus} → ${STATUS_LABELS[h.toStatus] ?? h.toStatus}`,
      status: h.toStatus,
      fromStatus: h.fromStatus,
      source: h.source as HistorySource,
      author: h.changer?.name,
    });
  }

  // Chronological; on a tie the report comes before the status change it caused.
  return events.sort((a, b) => a.at.localeCompare(b.at) || (a.type === b.type ? 0 : a.type === 'report' ? -1 : 1));
}

// ─── Service ───────────────────────────────────────────────────────────────

export class MaintenanceReportService {
  constructor(
    private db: Database,
    private clock: () => Date = () => new Date()
  ) {}

  /** When history collection began: the oldest history row, if any. */
  private async historySince(): Promise<string | null> {
    const first = await this.db.query.equipmentStatusHistory.findFirst({
      orderBy: (h, { asc }) => [asc(h.changedAt)],
    });
    return first?.changedAt ?? null;
  }

  private reportsInRange(range: ResolvedRange, equipmentId?: string) {
    const conditions = [
      gte(equipmentReports.createdAt, new Date(range.startMs).toISOString()),
      lt(equipmentReports.createdAt, new Date(range.endMs).toISOString()),
    ];
    if (equipmentId) conditions.push(eq(equipmentReports.equipmentId, equipmentId));
    return this.db.query.equipmentReports.findMany({
      where: and(...conditions),
      with: { reporter: true, acknowledger: true },
      orderBy: (r, { asc }) => [asc(r.createdAt)],
    });
  }

  private historyUntil(range: ResolvedRange, equipmentId?: string) {
    const conditions = [lt(equipmentStatusHistory.changedAt, new Date(range.endMs).toISOString())];
    if (equipmentId) conditions.push(eq(equipmentStatusHistory.equipmentId, equipmentId));
    return this.db.query.equipmentStatusHistory.findMany({
      where: and(...conditions),
      with: { changer: true },
      orderBy: [asc(equipmentStatusHistory.changedAt)],
    });
  }

  /** GET /reports/maintenance/equipment — one row per equipment with activity. */
  async listEquipment(filters: MaintenanceListFilters) {
    const now = this.clock();
    const nowMs = now.getTime();
    const range = resolveRange(filters, now);

    // Filters are applied in memory: the equipment set is small (one
    // department) and this avoids D1's bound-parameter limit on IN lists.
    const [allEquipment, allReports, allHistory, historySince] = await Promise.all([
      this.db.query.equipment.findMany({
        where: filters.equipmentId ? eq(equipment.id, filters.equipmentId) : undefined,
        with: { space: { with: { department: true } } },
      }) as Promise<EquipmentRow[]>,
      this.reportsInRange(range, filters.equipmentId) as Promise<ReportRow[]>,
      this.historyUntil(range, filters.equipmentId) as Promise<HistoryRow[]>,
      this.historySince(),
    ]);

    const selected = allEquipment.filter((e) => {
      if (filters.equipmentId && e.id !== filters.equipmentId) return false;
      if (filters.spaceId && e.spaceId !== filters.spaceId) return false;
      if (filters.status && e.status !== filters.status) return false;
      if (filters.departmentId && departmentId(e.space?.department) !== filters.departmentId) return false;
      return true;
    });

    const reportsByEquipment = new Map<string, ReportRow[]>();
    for (const r of allReports) {
      if (!inWindow(r.createdAt, range)) continue;
      if (filters.severity && r.severity !== filters.severity) continue;
      (reportsByEquipment.get(r.equipmentId) ?? reportsByEquipment.set(r.equipmentId, []).get(r.equipmentId)!).push(r);
    }

    const historyByEquipment = new Map<string, HistoryRow[]>();
    for (const h of sortHistory(allHistory)) {
      if (Date.parse(h.changedAt) >= range.endMs) continue;
      (historyByEquipment.get(h.equipmentId) ?? historyByEquipment.set(h.equipmentId, []).get(h.equipmentId)!).push(h);
    }

    const rows: MaintenanceEquipmentRow[] = [];
    const intervalSets: Interval[][] = [];
    const seriesReports: ReportRow[] = [];

    for (const e of selected) {
      const reports = reportsByEquipment.get(e.id) ?? [];
      const history = historyByEquipment.get(e.id) ?? [];
      const intervals = brokenIntervals(history, nowMs);
      const counts = computeCounts(reports, history, intervals, range, nowMs);

      // Idle working items add noise; an explicit equipment filter always shows it.
      const hasActivity =
        reports.length > 0 ||
        history.some((h) => isTransition(h) && inWindow(h.changedAt, range)) ||
        counts.timeInBrokenDays > 0;
      const include = filters.severity
        ? reports.length > 0
        : Boolean(filters.equipmentId) || hasActivity || e.status !== 'working';
      if (!include) continue;

      const latest = lastReport(reports);
      rows.push({
        id: e.id,
        name: e.name,
        assetId: e.assetId,
        type: e.type,
        status: e.status,
        space: spaceInfo(e),
        lastReportAt: latest?.createdAt ?? null,
        lastSeverity: (latest?.severity as Severity | undefined) ?? null,
        ...counts,
      });
      intervalSets.push(intervals);
      seriesReports.push(...reports);
    }

    rows.sort(
      (a, b) =>
        b.timeInBrokenDays - a.timeInBrokenDays ||
        b.reportCount - a.reportCount ||
        a.name.localeCompare(b.name)
    );

    return {
      range: { from: range.from, to: range.to, days: range.days },
      historySince,
      series: buildSeries(range, seriesReports, intervalSets, nowMs),
      equipment: rows,
    };
  }

  /** GET /equipment/:id/maintenance-report — metrics, series and timeline. */
  async getEquipmentReport(equipmentId: string, input: MaintenanceRangeInput) {
    const now = this.clock();
    const nowMs = now.getTime();
    const range = resolveRange(input, now);

    const item = (await this.db.query.equipment.findFirst({
      where: eq(equipment.id, equipmentId),
      with: { space: { with: { department: true } } },
    })) as EquipmentRow | undefined;
    if (!item) throw new NotFoundError('Equipment');

    const [rawReports, rawHistory, historySince] = await Promise.all([
      this.reportsInRange(range, equipmentId) as Promise<ReportRow[]>,
      this.historyUntil(range, equipmentId) as Promise<HistoryRow[]>,
      this.historySince(),
    ]);

    const reports = rawReports.filter((r) => r.equipmentId === equipmentId && inWindow(r.createdAt, range));
    const history = sortHistory(rawHistory).filter(
      (h) => h.equipmentId === equipmentId && Date.parse(h.changedAt) < range.endMs
    );
    const intervals = brokenIntervals(history, nowMs);
    const counts = computeCounts(reports, history, intervals, range, nowMs);

    const ackHours = reports
      .filter((r) => r.acknowledgedAt)
      .map((r) => (Date.parse(r.acknowledgedAt!) - Date.parse(r.createdAt)) / HOUR_MS);
    const resolveHours = reports
      .filter((r) => r.status === 'resolved' && r.resolvedAt)
      .map((r) => (Date.parse(r.resolvedAt!) - Date.parse(r.createdAt)) / HOUR_MS);
    const avgAck = average(ackHours);
    const avgResolve = average(resolveHours);

    const occurrences = [
      ...reports.map((r) => r.createdAt),
      ...history.filter((h) => isTransition(h) && h.toStatus === 'broken' && inWindow(h.changedAt, range)).map((h) => h.changedAt),
    ].sort();

    return {
      equipment: {
        id: item.id,
        name: item.name,
        assetId: item.assetId,
        type: item.type,
        status: item.status,
        notes: item.notes ?? null,
        updatedAt: item.updatedAt ?? null,
        space: spaceInfo(item),
      },
      range: { from: range.from, to: range.to, days: range.days },
      historySince,
      summary: {
        reportCount: counts.reportCount,
        openCount: counts.openCount,
        resolvedCount: counts.resolvedCount,
        dismissedCount: counts.dismissedCount,
        breakdownCount: counts.breakdownCount,
        repairCount: counts.repairCount,
        timeInBrokenDays: counts.timeInBrokenDays,
        averageTimeToAcknowledgeHours: avgAck === null ? null : round(avgAck, 1),
        averageTimeToResolveHours: avgResolve === null ? null : round(avgResolve, 1),
        lastOccurrenceAt: occurrences.at(-1) ?? null,
        recurrences: counts.recurrences,
        isRecurrent: counts.isRecurrent,
      },
      series: buildSeries(range, reports, [intervals], nowMs),
      timeline: buildTimeline(reports, history, range),
    };
  }
}
