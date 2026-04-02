import { eq, and } from 'drizzle-orm';
import { reservations, blockings, recurrences, spaces } from '@/db/schema';
import type { Database } from '@/db/client';
import { ConflictError, ForbiddenError, NotFoundError, AppError } from '@/middleware/error-handler';
import { AuditLogService } from './audit-log.service';
import { NotificationService } from './notification.service';
import { deriveLegacyTimeSlot, intervalsOverlap, overlapsClosedHours } from '@/lib/schedule';

interface CreateReservationInput {
  spaceId: string;
  date: string;
  startTime: string;
  endTime: string;
}

interface CreateRecurringInput {
  spaceId: string;
  startDate: string;
  endDate: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  description: string;
}

interface ListReservationsFilters {
  spaceId?: string;
  userId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  limit: number;
}

export class ReservationService {
  private auditLog: AuditLogService;
  private notification: NotificationService;

  constructor(private db: Database) {
    this.auditLog = new AuditLogService(db);
    this.notification = new NotificationService(db);
  }

  async create(userId: string, userRole: string, userDept: string, input: CreateReservationInput) {
    const space = await this.db.query.spaces.findFirst({ where: eq(spaces.id, input.spaceId) });
    if (!space) throw new NotFoundError('Space');

    if (userRole === 'student' && space.department !== userDept) {
      throw new ForbiddenError('Students can only reserve spaces in their own department');
    }

    await this.checkSlotAvailability(
      space,
      input.spaceId,
      input.date,
      input.startTime,
      input.endTime
    );

    if (userRole === 'student') {
      await this.enforceStudentLimit(userId);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const [reservation] = await this.db
      .insert(reservations)
      .values({
        id,
        spaceId: input.spaceId,
        userId,
        date: input.date,
        timeSlot: deriveLegacyTimeSlot(input.startTime),
        startTime: input.startTime,
        endTime: input.endTime,
        status: 'confirmed',
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await this.auditLog.log(
      userId,
      'create_reservation',
      id,
      'reservation',
      `Reserved space ${space.number} on ${input.date} (${input.startTime}-${input.endTime})`
    );

    await this.notification.create(
      userId,
      'Reservation confirmed',
      `Your reservation for space ${space.number} on ${input.date} (${input.startTime}-${input.endTime}) is confirmed.`,
      'confirmed'
    );

    return reservation;
  }

  async createRecurring(userId: string, userRole: string, input: CreateRecurringInput) {
    if (!['professor', 'staff'].includes(userRole)) {
      throw new ForbiddenError('Only professors and staff can create recurring reservations');
    }

    const space = await this.db.query.spaces.findFirst({ where: eq(spaces.id, input.spaceId) });
    if (!space) throw new NotFoundError('Space');

    const dates = this.generateRecurringDates(input.startDate, input.endDate, input.dayOfWeek);

    const recurrenceId = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.db.insert(recurrences).values({
      id: recurrenceId,
      description: input.description,
      createdBy: userId,
      createdAt: now,
    });

    const created = [];
    const skipped = [];

    for (const date of dates) {
      try {
        await this.checkSlotAvailability(space, input.spaceId, date, input.startTime, input.endTime);
        const id = crypto.randomUUID();
        const [reservation] = await this.db
          .insert(reservations)
          .values({
            id,
            spaceId: input.spaceId,
            userId,
            date,
            timeSlot: deriveLegacyTimeSlot(input.startTime),
            startTime: input.startTime,
            endTime: input.endTime,
            status: 'confirmed',
            recurrenceId,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        created.push(reservation);
      } catch {
        skipped.push({ date, startTime: input.startTime, endTime: input.endTime, reason: 'Time range unavailable' });
      }
    }

    await this.auditLog.log(
      userId,
      'create_recurring_reservation',
      recurrenceId,
      'reservation',
      `Created ${created.length} reservations for space ${space.number} (${input.startTime}-${input.endTime}, ${skipped.length} skipped)`
    );

    return { recurrenceId, created, skipped };
  }

  async cancel(reservationId: string, userId: string, userRole: string) {
    const reservation = await this.findOrThrow(reservationId);

    if (reservation.status === 'canceled') {
      throw new AppError(400, 'Reservation is already canceled', 'ALREADY_CANCELED');
    }

    if (userRole === 'student' && reservation.userId !== userId) {
      throw new ForbiddenError('Students can only cancel their own reservations');
    }

    if (userRole === 'maintenance') {
      throw new ForbiddenError('Maintenance personnel cannot manage reservations');
    }

    const now = new Date().toISOString();
    const [updated] = await this.db
      .update(reservations)
      .set({ status: 'canceled', updatedAt: now })
      .where(eq(reservations.id, reservationId))
      .returning();

    await this.auditLog.log(
      userId,
      'cancel_reservation',
      reservationId,
      'reservation',
      `Canceled reservation for space ${reservation.spaceId} on ${reservation.date} (${reservation.startTime}-${reservation.endTime})`
    );

    if (reservation.userId !== userId) {
      await this.notification.create(
        reservation.userId,
        'Reservation canceled',
        `Your reservation on ${reservation.date} (${reservation.startTime}-${reservation.endTime}) was canceled.`,
        'canceled'
      );
    }

    return updated;
  }

  async listBySpace(spaceId: string, date?: string) {
    return this.db.query.reservations.findMany({
      where: and(
        eq(reservations.spaceId, spaceId),
        eq(reservations.status, 'confirmed'),
        date ? eq(reservations.date, date) : undefined
      ),
      with: { user: true },
      orderBy: (r, { asc }) => [asc(r.date)],
    });
  }

  async listByUser(userId: string, page: number, limit: number) {
    return this.db.query.reservations.findMany({
      where: eq(reservations.userId, userId),
      with: { space: true },
      orderBy: (r, { desc }) => [desc(r.date)],
      limit,
      offset: (page - 1) * limit,
    });
  }

  async listForAdmin(filters: ListReservationsFilters) {
    const allReservations = await this.db.query.reservations.findMany({
      with: { user: true, space: true, recurrence: true },
      orderBy: (r, { desc }) => [desc(r.date)],
    });

    const filtered = allReservations.filter((reservation) => {
      if (filters.spaceId && reservation.spaceId !== filters.spaceId) return false;
      if (filters.userId && reservation.userId !== filters.userId) return false;
      if (filters.status && reservation.status !== filters.status) return false;
      if (filters.dateFrom && reservation.date < filters.dateFrom) return false;
      if (filters.dateTo && reservation.date > filters.dateTo) return false;
      return true;
    });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / filters.limit));
    const start = (filters.page - 1) * filters.limit;

    return {
      data: filtered.slice(start, start + filters.limit),
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages,
      },
    };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async checkSlotAvailability(
    space: { closedFrom: string; closedTo: string },
    spaceId: string,
    date: string,
    startTime: string,
    endTime: string
  ) {
    if (overlapsClosedHours(startTime, endTime, space.closedFrom, space.closedTo)) {
      throw new ConflictError('This time range falls within the room closed hours');
    }

    const existingReservations = await this.db.query.reservations.findMany({
      where: and(
        eq(reservations.spaceId, spaceId),
        eq(reservations.date, date),
        eq(reservations.status, 'confirmed')
      ),
    });
    if (existingReservations.some((existing) => intervalsOverlap(startTime, endTime, existing.startTime, existing.endTime))) {
      throw new ConflictError('This time range overlaps an existing reservation');
    }

    const activeBlockings = await this.db.query.blockings.findMany({
      where: and(
        eq(blockings.spaceId, spaceId),
        eq(blockings.date, date),
        eq(blockings.status, 'active')
      ),
    });
    if (activeBlockings.some((blocking) => intervalsOverlap(startTime, endTime, blocking.startTime, blocking.endTime))) {
      throw new ConflictError('This space is blocked for the requested time range');
    }
  }

  private async enforceStudentLimit(userId: string) {
    const active = await this.db.query.reservations.findFirst({
      where: and(eq(reservations.userId, userId), eq(reservations.status, 'confirmed')),
    });
    if (active) {
      throw new AppError(400, 'Students can only have one active reservation at a time', 'STUDENT_LIMIT');
    }
  }

  private async findOrThrow(id: string) {
    const reservation = await this.db.query.reservations.findFirst({
      where: eq(reservations.id, id),
    });
    if (!reservation) throw new NotFoundError('Reservation');
    return reservation;
  }

  private generateRecurringDates(start: string, end: string, dayOfWeek: number): string[] {
    const dates: string[] = [];
    const current = new Date(start);
    const endDate = new Date(end);

    while (current.getDay() !== dayOfWeek) {
      current.setDate(current.getDate() + 1);
    }

    while (current <= endDate) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 7);
    }

    return dates;
  }
}
