import { eq, and, gte, lte, inArray } from 'drizzle-orm';
import { reservations, blockings, spaces } from '@/db/schema';
import type { Database } from '@/db/client';

interface OccupancyParams {
  startDate: string;
  endDate: string;
  campus?: string;
  department?: string;
  spaceId?: string;
  groupBy: 'day' | 'week' | 'month';
}

interface DailyPoint {
  date: string;
  reservations: number;
  occupancyRate: number;
}

interface TurnoRow {
  turno: string;
  count: number;
  percentage: number;
}

interface SpaceRow {
  spaceId: string;
  name: string;
  number: string;
  block: string;
  type: string;
  capacity: number;
  reservations: number;
  occupancyRate: number;
}

interface Summary {
  occupancyRate: number;
  totalReservations: number;
  uniqueSpacesUsed: number;
  peakTurno: string;
}

const TURNOS = ['morning', 'afternoon', 'evening'] as const;
const SLOTS_PER_DAY = 3;

export class ReportService {
  constructor(private db: Database) {}

  async getOccupancyReport(params: OccupancyParams) {
    const { startDate, endDate, campus, department, spaceId, groupBy } = params;

    // ── Build filter conditions ──────────────────────────────────────────
    const spaceFilters = [];
    if (campus) spaceFilters.push(eq(spaces.campus, campus));
    if (department) spaceFilters.push(eq(spaces.department, department));
    if (spaceId) spaceFilters.push(eq(spaces.id, spaceId));

    const whereSpaces = spaceFilters.length > 0 ? and(...spaceFilters) : undefined;

    // ── Fetch base data ──────────────────────────────────────────────────
    const allSpaces = await this.db.query.spaces.findMany({
      where: whereSpaces,
    });

    const spaceIds = allSpaces.map((s) => s.id);

    // If no spaces match, return zeroed report
    if (spaceIds.length === 0) {
      return this.emptyReport(startDate, endDate, groupBy);
    }

    const allReservations = await this.db.query.reservations.findMany({
      where: and(
        inArray(reservations.spaceId, spaceIds),
        eq(reservations.status, 'confirmed'),
        gte(reservations.date, startDate),
        lte(reservations.date, endDate),
      ),
    });

    const activeBlockings = await this.db.query.blockings.findMany({
      where: and(
        inArray(blockings.spaceId, spaceIds),
        eq(blockings.status, 'active'),
        gte(blockings.date, startDate),
        lte(blockings.date, endDate),
      ),
    });

    // ── Index data for fast lookups ──────────────────────────────────────
    const bookingsBySpaceDate = new Map<string, number>();
    for (const r of allReservations) {
      const key = `${r.spaceId}::${r.date}`;
      bookingsBySpaceDate.set(key, (bookingsBySpaceDate.get(key) ?? 0) + 1);
    }

    const blockingsBySpaceDate = new Map<string, number>();
    for (const b of activeBlockings) {
      const key = `${b.spaceId}::${b.date}`;
      blockingsBySpaceDate.set(key, (blockingsBySpaceDate.get(key) ?? 0) + 1);
    }

    // ── Generate date range ──────────────────────────────────────────────
    const dateRange = this.generateDateRange(startDate, endDate);

    // ── dailySeries ──────────────────────────────────────────────────────
    const dailyPoints: DailyPoint[] = [];

    for (const date of dateRange) {
      let totalBookings = 0;
      let totalAvailableSlots = 0;

      for (const space of allSpaces) {
        const sKey = `${space.id}::${date}`;
        const blocked = blockingsBySpaceDate.get(sKey) ?? 0;
        const available = Math.max(0, SLOTS_PER_DAY - blocked);
        totalAvailableSlots += available;
        totalBookings += bookingsBySpaceDate.get(sKey) ?? 0;
      }

      dailyPoints.push({
        date,
        reservations: totalBookings,
        occupancyRate: totalAvailableSlots > 0
          ? Math.round((totalBookings / totalAvailableSlots) * 1000) / 10
          : 0,
      });
    }

    const dailySeries = this.groupDailySeries(dailyPoints, groupBy);

    // ── Summary ──────────────────────────────────────────────────────────
    const totalReservations = allReservations.length;
    let totalSlotsAvailable = 0;
    for (const space of allSpaces) {
      for (const date of dateRange) {
        const sKey = `${space.id}::${date}`;
        const blocked = blockingsBySpaceDate.get(sKey) ?? 0;
        totalSlotsAvailable += Math.max(0, SLOTS_PER_DAY - blocked);
      }
    }

    const occupancyRate = totalSlotsAvailable > 0
      ? Math.round((totalReservations / totalSlotsAvailable) * 1000) / 10
      : 0;

    const usedSpaceIds = new Set(allReservations.map((r) => r.spaceId));
    const uniqueSpacesUsed = usedSpaceIds.size;

    // peakTurno — count by timeSlot
    const turnoCounts: Record<string, number> = { morning: 0, afternoon: 0, evening: 0 };
    for (const r of allReservations) {
      if (turnoCounts[r.timeSlot] !== undefined) {
        turnoCounts[r.timeSlot]++;
      }
    }
    const peakTurno = Object.entries(turnoCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'morning';

    const summary: Summary = {
      occupancyRate,
      totalReservations,
      uniqueSpacesUsed,
      peakTurno,
    };

    // ── byTurno ──────────────────────────────────────────────────────────
    const byTurno: TurnoRow[] = TURNOS.map((turno) => ({
      turno,
      count: turnoCounts[turno],
      percentage: totalReservations > 0
        ? Math.round((turnoCounts[turno] / totalReservations) * 1000) / 10
        : 0,
    }));

    // ── Per-space metrics ───────────────────────────────────────────────
    const spaceMetrics = allSpaces.map((space) => {
      let totalBookings = 0;
      let totalAvailableSlots = 0;

      for (const date of dateRange) {
        const sKey = `${space.id}::${date}`;
        const blocked = blockingsBySpaceDate.get(sKey) ?? 0;
        totalAvailableSlots += Math.max(0, SLOTS_PER_DAY - blocked);
        totalBookings += bookingsBySpaceDate.get(sKey) ?? 0;
      }

      return {
        spaceId: space.id,
        name: space.name,
        number: space.number,
        block: space.block,
        type: space.type,
        capacity: space.capacity,
        reservations: totalBookings,
        occupancyRate: totalAvailableSlots > 0
          ? Math.round((totalBookings / totalAvailableSlots) * 1000) / 10
          : 0,
      };
    });

    // ── topSpaces (top 10 por reservas) ──────────────────────────────────
    const topSpaces = [...spaceMetrics]
      .sort((a, b) => b.reservations - a.reservations)
      .slice(0, 10);

    // ── idleSpaces (<20% occupancy) ──────────────────────────────────────
    const idleSpaces = spaceMetrics.filter((s) => s.occupancyRate < 20);

    // ── tabela (full, sorted by name) ────────────────────────────────────
    const tabela = [...spaceMetrics].sort((a, b) => a.name.localeCompare(b.name));

    return {
      summary,
      dailySeries,
      byTurno,
      topSpaces,
      idleSpaces,
      tabela,
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────

  private generateDateRange(start: string, end: string): string[] {
    const dates: string[] = [];
    const current = new Date(start);
    const endDate = new Date(end);
    while (current <= endDate) {
      dates.push(current.toISOString().slice(0, 10));
      current.setDate(current.getDate() + 1);
    }
    return dates;
  }

  private groupDailySeries(
    dailyPoints: DailyPoint[],
    groupBy: 'day' | 'week' | 'month',
  ): DailyPoint[] {
    if (groupBy === 'day') return dailyPoints;

    const grouped = new Map<string, { reservations: number; points: number }>();

    for (const point of dailyPoints) {
      const key = this.groupKey(point.date, groupBy);
      const existing = grouped.get(key) ?? { reservations: 0, points: 0 };
      existing.reservations += point.reservations;
      existing.points++;
      grouped.set(key, existing);
    }

    return Array.from(grouped.entries()).map(([date, data]) => ({
      date,
      reservations: data.reservations,
      occupancyRate:
        data.points > 0
          ? Math.round((data.reservations / data.points) * 1000) / 10
          : 0,
    }));
  }

  private groupKey(date: string, groupBy: 'week' | 'month'): string {
    const d = new Date(date);
    if (groupBy === 'week') {
      // ISO week number
      const startOfYear = new Date(d.getFullYear(), 0, 1);
      const diff = d.getTime() - startOfYear.getTime();
      const dayOfYear = Math.floor(diff / 86400000);
      const week = Math.ceil((dayOfYear + startOfYear.getDay() + 1) / 7);
      return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
    }
    // month
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  private emptyReport(
    startDate: string,
    endDate: string,
    groupBy: 'day' | 'week' | 'month',
  ) {
    const dateRange = this.generateDateRange(startDate, endDate);
    const dailySeries = this.groupDailySeries(
      dateRange.map((date) => ({ date, reservations: 0, occupancyRate: 0 })),
      groupBy,
    );

    return {
      summary: {
        occupancyRate: 0,
        totalReservations: 0,
        uniqueSpacesUsed: 0,
        peakTurno: 'morning',
      },
      dailySeries,
      byTurno: [
        { turno: 'morning', count: 0, percentage: 0 },
        { turno: 'afternoon', count: 0, percentage: 0 },
        { turno: 'evening', count: 0, percentage: 0 },
      ],
      topSpaces: [],
      idleSpaces: [],
      tabela: [],
    };
  }
}
