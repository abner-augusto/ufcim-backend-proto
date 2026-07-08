import { eq, and, gte, lte, inArray } from 'drizzle-orm';
import { spaces, reservations, blockings } from '@/db/schema';
import type { Database } from '@/db/client';
import { NotFoundError, AppError } from '@/middleware/error-handler';
import { formatReservationAuthor } from '@/lib/reservation-privacy';
import { departmentName } from '@/lib/department-name';
import { buildHourlyAvailability, DEFAULT_CLOSED_FROM, DEFAULT_CLOSED_TO, timeToMinutes } from '@/lib/schedule';
import type { UserRole } from '@/types/auth';

/** Maximum span (inclusive, in days) accepted by the report endpoints. */
const MAX_REPORT_RANGE_DAYS = 90;

interface SpaceReportInput {
  spaceId: string;
  startDate: string;
  endDate: string;
  viewer: { userId: string; role: UserRole };
  /** Space object pre-loaded by the caller — eliminates a DB query */
  space?: {
    id: string;
    name: string;
    number: string;
    block: string;
    type: string;
    capacity: number | null;
    department: unknown;
    closedFrom?: string;
    closedTo?: string;
  };
}

interface SpaceReport {
  space: {
    id: string;
    name: string;
    number: string;
    block: string;
    type: string;
    capacity: number | null;
    department: string;
  };
  range: { startDate: string; endDate: string; days: number };
  summary: {
    totalReservations: number;
    totalCanceledReservations: number;
    totalBlockings: number;
    occupancyRate: number;
    averageDailyOccupancy: number;
    peakDay: { date: string; occupancyRate: number } | null;
    peakHour: { hour: string; occupancyRate: number } | null;
    distinctUsersWhoReserved: number;
  };
  dailySeries: Array<{
    date: string;
    occupancyRate: number;
    reservations: number;
    blockings: number;
  }>;
  hourlyAverage: Array<{
    hour: string;
    occupancyRate: number;
  }>;
  reservations: Array<{
    id: string;
    date: string;
    startTime: string;
    endTime: string;
    status: string;
    purpose: string | null;
    description: string | null;
    isRecurring: boolean;
    author: { displayName: string; role: string };
  }>;
  blockings: Array<{
    id: string;
    date: string;
    startTime: string;
    endTime: string;
    blockType: string;
    reason: string | null;
    author: { displayName: string; role: string };
  }>;
}

function dateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');

  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

function calculateOccupancyRate(
  totalMinutesReserved: number,
  totalMinutesBlocked: number,
  operationalMinutes: number
): number {
  if (operationalMinutes === 0) return 0;
  const used = totalMinutesReserved + totalMinutesBlocked;
  return Math.min(100, Math.round((used / operationalMinutes) * 100));
}

export class ReportService {
  constructor(private db: Database) {}

  async getSpaceReport(input: SpaceReportInput): Promise<SpaceReport> {
    const { spaceId, startDate, endDate, viewer } = input;

    // Validate date range
    const startMs = new Date(startDate + 'T00:00:00').getTime();
    const endMs = new Date(endDate + 'T00:00:00').getTime();

    if (isNaN(startMs) || isNaN(endMs)) {
      throw new AppError(400, 'Datas inválidas. Use o formato AAAA-MM-DD.', 'INVALID_DATE');
    }

    if (startMs > endMs) {
      throw new AppError(400, 'startDate não pode ser posterior a endDate', 'INVALID_DATE_RANGE');
    }

    const diffDays = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1;
    if (diffDays > MAX_REPORT_RANGE_DAYS) {
      throw new AppError(400, `O período máximo permitido é de ${MAX_REPORT_RANGE_DAYS} dias`, 'RANGE_TOO_LARGE');
    }

    // Load space: use pre-loaded from input, or query DB
    let space = input.space;
    if (!space) {
      space = await this.db.query.spaces.findFirst({
        where: eq(spaces.id, spaceId),
        with: { department: true },
      });
      if (!space) {
        throw new NotFoundError(`Space não encontrado: ${spaceId}`);
      }
    }

    // Single query for all reservations in range
    const allReservations = await this.db.query.reservations.findMany({
      where: and(
        eq(reservations.spaceId, spaceId),
        gte(reservations.date, startDate),
        lte(reservations.date, endDate)
      ),
      with: { user: true, recurrence: true },
    });

    // Single query for all blockings in range
    const allBlockings = await this.db.query.blockings.findMany({
      where: and(
        eq(blockings.spaceId, spaceId),
        gte(blockings.date, startDate),
        lte(blockings.date, endDate),
        eq(blockings.status, 'active')
      ),
      with: { creator: true },
    });

    const confirmedReservations = allReservations.filter((r) => r.status === 'confirmed');
    const canceledReservations = allReservations.filter((r) => r.status === 'canceled');

    // Build a map of date -> reservations and blockings
    const dates = dateRange(startDate, endDate);
    const closedFrom = space.closedFrom ?? DEFAULT_CLOSED_FROM;
    const closedTo = space.closedTo ?? DEFAULT_CLOSED_TO;

    let totalOccupiedMinutes = 0;
    let totalOperationalMinutes = 0;
    let daysWithData = 0;

    const dailySeries: Array<{
      date: string;
      occupancyRate: number;
      reservations: number;
      blockings: number;
    }> = [];

    const hourlyTotals: Record<string, { occupied: number; total: number }> = {};

    const closedFromMinutes = timeToMinutes(closedFrom);
    const closedToMinutes = timeToMinutes(closedTo);

    // Determine operational hours for occupancy calculation
    // Operational hours = hours that are NOT closed
    const operationalHours: number[] = [];
    for (let h = 0; h < 24; h++) {
      const hourMinutes = h * 60;
      const nextHourMinutes = (h + 1) * 60;
      // Check if this hour overlaps with closed period
      const isClosed = (() => {
        if (closedFromMinutes === closedToMinutes) return true; // closed all day
        if (closedFromMinutes < closedToMinutes) {
          // closed wraps within same day
          return hourMinutes >= closedFromMinutes && nextHourMinutes <= closedToMinutes;
        }
        // closed wraps past midnight
        return (hourMinutes >= closedFromMinutes && hourMinutes < 1440) ||
               (nextHourMinutes <= closedToMinutes);
      })();
      if (!isClosed) {
        operationalHours.push(h);
      }
    }

    const operationalHourCount = operationalHours.length;

    for (const date of dates) {
      const dateReservations = confirmedReservations.filter((r) => r.date === date);
      const dateBlockings = allBlockings.filter((b) => b.date === date);
      const dateCanceled = canceledReservations.filter((r) => r.date === date);

      // Check if the day has ANY closed hours (all closed = skip)
      const slots = buildHourlyAvailability(
        closedFrom,
        closedTo,
        dateReservations.map((r) => ({ startTime: r.startTime, endTime: r.endTime })),
        dateBlockings.map((b) => ({ startTime: b.startTime, endTime: b.endTime }))
      );

      const nonClosedSlots = slots.filter((s) => s.status !== 'closed');
      const reservedSlots = slots.filter((s) => s.status === 'reserved');
      const blockedSlots = slots.filter((s) => s.status === 'blocked');

      // If all slots are closed, skip this day
      if (nonClosedSlots.length === 0) {
        dailySeries.push({ date, occupancyRate: 0, reservations: 0, blockings: 0 });
        continue;
      }

      const occupancyRate = calculateOccupancyRate(
        reservedSlots.length * 60,
        blockedSlots.length * 60,
        nonClosedSlots.length * 60
      );

      totalOccupiedMinutes += (reservedSlots.length + blockedSlots.length) * 60;
      totalOperationalMinutes += nonClosedSlots.length * 60;
      daysWithData++;

      dailySeries.push({
        date,
        occupancyRate,
        reservations: dateReservations.length,
        blockings: dateBlockings.length,
      });

      // Update hourly averages
      for (let h = 0; h < 24; h++) {
        const hourStr = `${String(h).padStart(2, '0')}:00`;
        if (!hourlyTotals[hourStr]) {
          hourlyTotals[hourStr] = { occupied: 0, total: 0 };
        }
        hourlyTotals[hourStr].total++;

        const slot = slots[h];
        if (slot && (slot.status === 'reserved' || slot.status === 'blocked')) {
          hourlyTotals[hourStr].occupied++;
        }
      }
    }

    // Calculate hourly average
    const hourlyAverage = operationalHours.map((h) => {
      const hourStr = `${String(h).padStart(2, '0')}:00`;
      const data = hourlyTotals[hourStr] ?? { occupied: 0, total: 1 };
      const rate = Math.round((data.occupied / data.total) * 100);
      return { hour: hourStr, occupancyRate: rate };
    });

    // Find peak day
    let peakDay: { date: string; occupancyRate: number } | null = null;
    for (const day of dailySeries) {
      if (!peakDay || day.occupancyRate > peakDay.occupancyRate) {
        peakDay = { date: day.date, occupancyRate: day.occupancyRate };
      }
    }

    // Find peak hour
    let peakHour: { hour: string; occupancyRate: number } | null = null;
    for (const h of hourlyAverage) {
      if (!peakHour || h.occupancyRate > peakHour.occupancyRate) {
        peakHour = h;
      }
    }

    // Overall occupancy rate
    const overallOccupancyRate = totalOperationalMinutes > 0
      ? Math.min(100, Math.round((totalOccupiedMinutes / totalOperationalMinutes) * 100))
      : 0;

    // Average daily occupancy
    const averageDailyOccupancy = daysWithData > 0
      ? Math.round(dailySeries.reduce((sum, d) => sum + d.occupancyRate, 0) / dailySeries.length)
      : 0;

    // Distinct users
    const distinctUsers = new Set(confirmedReservations.map((r) => r.userId));

    // Build reservation details with privacy
    const reservationDetails = confirmedReservations.map((r) => {
      const author = r.user
        ? formatReservationAuthor(
            { ownerId: r.userId, ownerName: r.user.name, ownerRole: r.user.role },
            viewer
          )
        : { displayName: 'desconhecido', role: 'student' };

      return {
        id: r.id,
        date: r.date,
        startTime: r.startTime,
        endTime: r.endTime,
        status: r.status,
        purpose: r.purpose ?? null,
        description: r.description ?? null,
        isRecurring: !!r.recurrenceId,
        author: { displayName: author.displayName, role: author.role },
      };
    });

    const blockingDetails = allBlockings.map((b) => {
      const author = b.creator
        ? formatReservationAuthor(
            { ownerId: b.createdBy, ownerName: b.creator.name, ownerRole: b.creator.role },
            viewer
          )
        : { displayName: 'desconhecido', role: 'staff' };

      return {
        id: b.id,
        date: b.date,
        startTime: b.startTime,
        endTime: b.endTime,
        blockType: b.blockType,
        reason: b.reason ?? null,
        author: { displayName: author.displayName, role: author.role },
      };
    });

    return {
      space: {
        id: space.id,
        name: space.name,
        number: space.number,
        block: space.block,
        type: space.type,
        capacity: space.capacity,
        department: departmentName(space.department),
      },
      range: { startDate, endDate, days: diffDays },
      summary: {
        totalReservations: confirmedReservations.length,
        totalCanceledReservations: canceledReservations.length,
        totalBlockings: allBlockings.length,
        occupancyRate: overallOccupancyRate,
        averageDailyOccupancy,
        peakDay,
        peakHour,
        distinctUsersWhoReserved: distinctUsers.size,
      },
      dailySeries,
      hourlyAverage,
      reservations: reservationDetails,
      blockings: blockingDetails,
    };
  }

  async getOccupancyReport(filters: {
    startDate: string;
    endDate: string;
    campus?: string;
    department?: string;
    spaceId?: string;
    groupBy?: 'day' | 'week' | 'month';
  }) {
    const { startDate, endDate, campus, department, spaceId } = filters;

    const startMs = new Date(startDate + 'T00:00:00').getTime();
    const endMs = new Date(endDate + 'T00:00:00').getTime();
    if (isNaN(startMs) || isNaN(endMs)) {
      throw new AppError(400, 'Datas inválidas. Use o formato AAAA-MM-DD.', 'INVALID_DATE');
    }
    if (startMs > endMs) {
      throw new AppError(400, 'startDate não pode ser posterior a endDate', 'INVALID_DATE_RANGE');
    }
    const diffDays = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1;
    if (diffDays > MAX_REPORT_RANGE_DAYS) {
      throw new AppError(400, `O período máximo permitido é de ${MAX_REPORT_RANGE_DAYS} dias`, 'RANGE_TOO_LARGE');
    }

    const spaceConditions: any[] = [];
    if (campus) spaceConditions.push(eq(spaces.campus, campus));
    if (department) spaceConditions.push(eq(spaces.department, department));
    if (spaceId) spaceConditions.push(eq(spaces.id, spaceId));

    const spaceList = await this.db.query.spaces.findMany({
      where: spaceConditions.length > 0 ? and(...spaceConditions) : undefined,
      with: { department: true },
    });

    const spaceIds = spaceList.map((s) => s.id);

    // Two bulk queries cover every space; we aggregate in memory below.
    const allReservations = spaceIds.length
      ? await this.db.query.reservations.findMany({
          where: and(
            inArray(reservations.spaceId, spaceIds),
            eq(reservations.status, 'confirmed'),
            gte(reservations.date, startDate),
            lte(reservations.date, endDate)
          ),
        })
      : [];
    const allBlockings = spaceIds.length
      ? await this.db.query.blockings.findMany({
          where: and(
            inArray(blockings.spaceId, spaceIds),
            eq(blockings.status, 'active'),
            gte(blockings.date, startDate),
            lte(blockings.date, endDate)
          ),
        })
      : [];

    const slotKey = (sid: string, date: string) => `${sid}|${date}`;
    const resBySpaceDate = new Map<string, Array<{ startTime: string; endTime: string }>>();
    const blkBySpaceDate = new Map<string, Array<{ startTime: string; endTime: string }>>();
    const resCountBySpace = new Map<string, number>();
    const blkCountBySpace = new Map<string, number>();
    const turnoCounts = { morning: 0, afternoon: 0, evening: 0 };

    for (const r of allReservations) {
      resCountBySpace.set(r.spaceId, (resCountBySpace.get(r.spaceId) ?? 0) + 1);
      const k = slotKey(r.spaceId, r.date);
      (resBySpaceDate.get(k) ?? resBySpaceDate.set(k, []).get(k)!).push({ startTime: r.startTime, endTime: r.endTime });
      const hour = parseInt(r.startTime.split(':')[0], 10);
      if (hour < 13) turnoCounts.morning++;
      else if (hour < 19) turnoCounts.afternoon++;
      else turnoCounts.evening++;
    }
    for (const b of allBlockings) {
      blkCountBySpace.set(b.spaceId, (blkCountBySpace.get(b.spaceId) ?? 0) + 1);
      const k = slotKey(b.spaceId, b.date);
      (blkBySpaceDate.get(k) ?? blkBySpaceDate.set(k, []).get(k)!).push({ startTime: b.startTime, endTime: b.endTime });
    }

    const dates = dateRange(startDate, endDate);
    const spaceOccupied = new Map<string, number>();
    const spaceOperational = new Map<string, number>();
    const dailyOccupied: Record<string, number> = {};
    const dailyOperational: Record<string, number> = {};
    const dailyReservations: Record<string, number> = {};

    for (const s of spaceList) {
      const closedFrom = s.closedFrom ?? DEFAULT_CLOSED_FROM;
      const closedTo = s.closedTo ?? DEFAULT_CLOSED_TO;
      for (const date of dates) {
        const dayRes = resBySpaceDate.get(slotKey(s.id, date)) ?? [];
        const dayBlk = blkBySpaceDate.get(slotKey(s.id, date)) ?? [];
        const slots = buildHourlyAvailability(closedFrom, closedTo, dayRes, dayBlk);
        const operational = slots.filter((slot) => slot.status !== 'closed').length;
        if (operational === 0) continue;
        const occupied = slots.filter((slot) => slot.status === 'reserved' || slot.status === 'blocked').length;

        spaceOperational.set(s.id, (spaceOperational.get(s.id) ?? 0) + operational);
        spaceOccupied.set(s.id, (spaceOccupied.get(s.id) ?? 0) + occupied);
        dailyOperational[date] = (dailyOperational[date] ?? 0) + operational;
        dailyOccupied[date] = (dailyOccupied[date] ?? 0) + occupied;
        dailyReservations[date] = (dailyReservations[date] ?? 0) + dayRes.length;
      }
    }

    const rate = (occupied: number, operational: number) =>
      operational > 0 ? Math.min(100, Math.round((occupied / operational) * 100)) : 0;

    const spacesData = spaceList.map((s) => {
      return {
        id: s.id,
        name: s.name,
        number: s.number,
        block: s.block,
        type: s.type,
        capacity: s.capacity,
        department: departmentName(s.department),
        totalReservations: resCountBySpace.get(s.id) ?? 0,
        totalBlockings: blkCountBySpace.get(s.id) ?? 0,
        occupancyRate: rate(spaceOccupied.get(s.id) ?? 0, spaceOperational.get(s.id) ?? 0),
      };
    });

    const daily = dates.map((date) => ({
      date,
      occupancyRate: rate(dailyOccupied[date] ?? 0, dailyOperational[date] ?? 0),
      reservations: dailyReservations[date] ?? 0,
    }));

    const byTurno = [
      { turno: 'Manhã', reservations: turnoCounts.morning },
      { turno: 'Tarde', reservations: turnoCounts.afternoon },
      { turno: 'Noite', reservations: turnoCounts.evening },
    ];

    const totalOccupied = [...spaceOccupied.values()].reduce((sum, v) => sum + v, 0);
    const totalOperational = [...spaceOperational.values()].reduce((sum, v) => sum + v, 0);

    return {
      spaces: spacesData,
      totalOccupancyRate: rate(totalOccupied, totalOperational),
      daily,
      byTurno,
      period: { startDate, endDate },
    };
  }
}
