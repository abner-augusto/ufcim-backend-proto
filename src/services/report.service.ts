import { eq, and, gte, lte, inArray, count } from 'drizzle-orm';
import { spaces, reservations, blockings } from '@/db/schema';
import type { Database } from '@/db/client';
import { NotFoundError, AppError } from '@/middleware/error-handler';
import { formatReservationAuthor } from '@/lib/reservation-privacy';
import { buildHourlyAvailability, DEFAULT_CLOSED_FROM, DEFAULT_CLOSED_TO, timeToMinutes } from '@/lib/schedule';
import type { UserRole } from '@/types/auth';

interface SpaceReportInput {
  spaceId: string;
  startDate: string;
  endDate: string;
  viewer: { userId: string; role: UserRole };
  /** Pre-loaded space object — skips DB lookup when provided */
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
    if (diffDays > 90) {
      throw new AppError(400, 'O período máximo permitido é de 90 dias', 'RANGE_TOO_LARGE');
    }

    // Get space (use pre-loaded or fetch from DB)
    let space: any = input.space ?? null;
    if (!space) {
      space = await this.db.query.spaces.findFirst({
        where: eq(spaces.id, spaceId),
        with: { department: true },
      });
      if (!space) throw new NotFoundError('Space');
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

    const department = space.department && typeof space.department === 'object'
      ? (space.department as any).name ?? space.department
      : space.department as unknown as string;

    return {
      space: {
        id: space.id,
        name: space.name,
        number: space.number,
        block: space.block,
        type: space.type,
        capacity: space.capacity,
        department,
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
    const { startDate, endDate, campus, department, spaceId, groupBy } = filters;

    const spaceConditions: any[] = [];
    if (campus) spaceConditions.push(eq(spaces.campus, campus));
    if (department) spaceConditions.push(eq(spaces.department, department));
    if (spaceId) spaceConditions.push(eq(spaces.id, spaceId));

    const spaceList = await this.db.query.spaces.findMany({
      where: spaceConditions.length > 0 ? and(...spaceConditions) : undefined,
      with: { department: true },
    });

    // For each space, count reservations in range
    const spacesData = await Promise.all(
      spaceList.map(async (s) => {
        const resCount = await this.db
          .select({ total: count() })
          .from(reservations)
          .where(
            and(
              eq(reservations.spaceId, s.id),
              eq(reservations.status, 'confirmed'),
              gte(reservations.date, startDate),
              lte(reservations.date, endDate)
            )
          );

        const blkCount = await this.db
          .select({ total: count() })
          .from(blockings)
          .where(
            and(
              eq(blockings.spaceId, s.id),
              eq(blockings.status, 'active'),
              gte(blockings.date, startDate),
              lte(blockings.date, endDate)
            )
          );

        const deptName = typeof s.department === 'object' && s.department
          ? (s.department as any).name ?? s.department
          : s.department as unknown as string;

        return {
          id: s.id,
          name: s.name,
          number: s.number,
          block: s.block,
          type: s.type,
          capacity: s.capacity,
          department: deptName,
          totalReservations: resCount[0]?.total ?? 0,
          totalBlockings: blkCount[0]?.total ?? 0,
        };
      })
    );

    const totalReservations = spacesData.reduce((sum, s) => sum + s.totalReservations, 0);
    const totalSpaces = spacesData.length;

    return {
      spaces: spacesData,
      totalOccupancyRate: totalSpaces > 0
        ? Math.round((totalReservations / (totalSpaces * 1)) * 100)
        : 0,
      period: { startDate, endDate },
    };
  }
}
