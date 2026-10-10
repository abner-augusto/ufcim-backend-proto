import { eq, and, or, gte, lte, count, inArray } from 'drizzle-orm';
import { reservations, blockings, recurrences, spaces, users } from '@/db/schema';
import type { Database } from '@/db/client';
import { ConflictError, ForbiddenError, NotFoundError, AppError } from '@/middleware/error-handler';
import { AuditLogService } from './audit-log.service';
import { NotificationService } from './notification.service';
import {
  deriveLegacyTimeSlot,
  timeToMinutes,
  intervalsOverlap,
  overlapsClosedHours,
  meetsMinimumDuration,
  SLOT_MINUTES,
} from '@/lib/schedule';
import { campusToday, campusNowMinutes } from '@/lib/clock';
import { canManageReservation, type ReservationAction } from '@/lib/reservation-permissions';
import { presentReservationForViewer } from '@/lib/reservation-privacy';

const ACTIVE_RESERVATION_LIMITS: Record<string, number | null> = {
  student: 5,
  professor: 10,
  staff: null,
  maintenance: 0,
};

/** Only staff may reserve on someone else's behalf (MEL-025). */
const CAN_RESERVE_ON_BEHALF = ['staff'];

/** Optional requester sent by staff (MEL-025); the validator allows one of id or name. */
interface RequesterInput {
  requesterUserId?: string;
  requesterName?: string;
  requesterContact?: string;
}

/** Requester columns to store, plus who registered it and how to name the requester. */
interface ResolvedRequester {
  columns: { requesterUserId: string | null; requesterName: string | null; requesterContact: string | null };
  actorName: string;
  requesterLabel: string;
}

interface CreateReservationInput extends RequesterInput {
  spaceId: string;
  date: string;
  startTime: string;
  endTime: string;
  purpose?: string;
  description?: string; // optional free-text, max 100 chars
}

interface CreateRecurringInput extends RequesterInput {
  spaceId: string;
  startDate: string;
  endDate: string;
  /** 0 = Sunday; up to 3 days, validated by the schema. */
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  description?: string;
  purpose?: string;
}

interface UpdateReservationInput {
  date?: string;
  startTime?: string;
  endTime?: string;
  description?: string;
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
    const requester = await this.resolveRequester(userId, userRole, input);

    const space = await this.db.query.spaces.findFirst({ where: eq(spaces.id, input.spaceId) });
    if (!space) throw new NotFoundError('Space');

    if (!space.reservable) {
      throw new ConflictError('Este espaço não está disponível para reservas');
    }

    this.assertDepartmentAccess(userRole, userDept, space.department);

    await this.checkSlotAvailability(
      space,
      input.spaceId,
      input.date,
      input.startTime,
      input.endTime
    );

    await this.enforceActiveLimit(userId, userRole);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    let reservation: typeof reservations.$inferSelect;
    try {
      [reservation] = await this.db
        .insert(reservations)
        .values({
          id,
          spaceId: input.spaceId,
          userId,
          createdBy: userId,
          ...this.requesterColumns(requester),
          date: input.date,
          timeSlot: deriveLegacyTimeSlot(input.startTime),
          startTime: input.startTime,
          endTime: input.endTime,
          status: 'confirmed',
          purpose: input.purpose ?? null,
          description: input.description?.trim() || null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
        throw new ConflictError('Esta faixa de horário conflita com uma reserva existente');
      }

      throw error;
    }

    const when = `em ${input.date} (${input.startTime}-${input.endTime})`;
    await this.auditLog.log(
      userId,
      'create_reservation',
      id,
      'reservation',
      requester
        ? `${requester.actorName} reservou o espaço ${space.number} ${when} para ${requester.requesterLabel}`
        : `Reservou o espaço ${space.number} ${when}`
    );

    await this.notification.create(
      userId,
      'Reserva confirmada',
      `Sua reserva para o espaço ${space.number} ${when} foi confirmada.`,
      'confirmed'
    );

    if (requester?.columns.requesterUserId) {
      await this.notification.create(
        requester.columns.requesterUserId,
        'Reserva feita para você',
        `${requester.actorName} reservou o espaço ${space.number} para você ${when}.`,
        'confirmed'
      );
    }

    return reservation;
  }

  async createRecurring(userId: string, userRole: string, userDept: string, input: CreateRecurringInput) {
    if (!['professor', 'staff'].includes(userRole)) {
      throw new ForbiddenError('Apenas professores e funcionários podem criar reservas recorrentes');
    }

    const requester = await this.resolveRequester(userId, userRole, input);

    const space = await this.db.query.spaces.findFirst({ where: eq(spaces.id, input.spaceId) });
    if (!space) throw new NotFoundError('Space');

    this.assertDepartmentAccess(userRole, userDept, space.department);

    const dates = this.generateRecurringDates(input.startDate, input.endDate, input.daysOfWeek);

    const recurrenceId = crypto.randomUUID();
    const now = new Date().toISOString();
    const requesterColumns = this.requesterColumns(requester);

    await this.db.insert(recurrences).values({
      id: recurrenceId,
      description: input.description ?? '',
      createdBy: userId,
      ...requesterColumns,
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
            createdBy: userId,
            ...requesterColumns,
            date,
            timeSlot: deriveLegacyTimeSlot(input.startTime),
            startTime: input.startTime,
            endTime: input.endTime,
            status: 'confirmed',
            recurrenceId,
            purpose: input.purpose ?? null,
            description: input.description ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        created.push(reservation);
      } catch {
        skipped.push({ date, startTime: input.startTime, endTime: input.endTime, reason: 'Faixa de horário indisponível' });
      }
    }

    const range = `(${input.startTime}-${input.endTime}, ${skipped.length} ignoradas)`;
    await this.auditLog.log(
      userId,
      'create_recurring_reservation',
      recurrenceId,
      'reservation',
      requester
        ? `${requester.actorName} reservou ${created.length} datas do espaço ${space.number} ${range} para ${requester.requesterLabel}`
        : `Criou ${created.length} reservas para o espaço ${space.number} ${range}`
    );

    if (requester?.columns.requesterUserId && created.length > 0) {
      const first = created[0].date;
      const last = created[created.length - 1].date;
      await this.notification.create(
        requester.columns.requesterUserId,
        'Reservas recorrentes feitas para você',
        `${requester.actorName} reservou o espaço ${space.number} para você em ${created.length} datas, de ${first} a ${last} (${input.startTime}-${input.endTime}).`,
        'confirmed'
      );
    }

    return { recurrenceId, created, skipped };
  }

  /**
   * Edits one reservation's date, time range or description (MEL-023). The space
   * is fixed. Revalidates exactly like creation, with the reservation itself
   * excluded from the conflict check. Only a confirmed reservation that has not
   * started yet is editable; it stays confirmed and, if recurring, in its series.
   */
  async update(
    reservationId: string,
    userId: string,
    userRole: string,
    userDept: string,
    input: UpdateReservationInput
  ) {
    const reservation = await this.findOrThrow(reservationId);
    this.assertCanManage(userId, userRole, reservation, 'edit', 'Você só pode editar as próprias reservas');

    if (reservation.status !== 'confirmed') {
      throw new ConflictError('Só é possível editar reservas confirmadas');
    }

    if (this.hasStarted(reservation.date, reservation.startTime)) {
      throw new ConflictError('Esta reserva já começou ou já terminou e não pode mais ser editada');
    }

    const space = await this.db.query.spaces.findFirst({ where: eq(spaces.id, reservation.spaceId) });
    if (!space) throw new NotFoundError('Space');

    this.assertDepartmentAccess(userRole, userDept, space.department);

    const next = {
      date: input.date ?? reservation.date,
      startTime: input.startTime ?? reservation.startTime,
      endTime: input.endTime ?? reservation.endTime,
    };

    if (timeToMinutes(next.startTime) >= timeToMinutes(next.endTime)) {
      throw new AppError(400, 'O horário de término deve ser posterior ao horário de início', 'VALIDATION_ERROR');
    }

    if (!meetsMinimumDuration(next.startTime, next.endTime)) {
      throw new AppError(400, 'A reserva deve durar pelo menos 1 hora', 'VALIDATION_ERROR');
    }

    const scheduleChanged =
      next.date !== reservation.date ||
      next.startTime !== reservation.startTime ||
      next.endTime !== reservation.endTime;

    if (scheduleChanged) {
      await this.checkSlotAvailability(
        space,
        reservation.spaceId,
        next.date,
        next.startTime,
        next.endTime,
        reservation.id
      );
    }

    const description =
      input.description === undefined ? reservation.description : input.description.trim() || null;

    let updated: typeof reservations.$inferSelect;
    try {
      [updated] = await this.db
        .update(reservations)
        .set({
          date: next.date,
          timeSlot: deriveLegacyTimeSlot(next.startTime),
          startTime: next.startTime,
          endTime: next.endTime,
          description,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(reservations.id, reservationId))
        .returning();
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
        throw new ConflictError('Esta faixa de horário conflita com uma reserva existente');
      }

      throw error;
    }

    const from = `${reservation.date} ${reservation.startTime}-${reservation.endTime}`;
    const to = `${next.date} ${next.startTime}-${next.endTime}`;
    const changes = [`${from} → ${to}`];
    if (description !== reservation.description) {
      changes.push(`descrição: "${reservation.description ?? ''}" → "${description ?? ''}"`);
    }

    await this.auditLog.log(
      userId,
      'update_reservation',
      reservationId,
      'reservation',
      `Editou a reserva do espaço ${space.number}: ${changes.join('; ')}`
    );

    if (reservation.userId !== userId) {
      await this.notification.create(
        reservation.userId,
        'Reserva alterada',
        `Sua reserva para o espaço ${space.number} foi alterada: agora em ${next.date} (${next.startTime}-${next.endTime}).`,
        'modified'
      );
    }

    if (this.shouldNotifyRequester(reservation, userId)) {
      await this.notification.create(
        reservation.requesterUserId!,
        'Reserva alterada',
        `A reserva do espaço ${space.number} feita para você foi alterada: agora em ${next.date} (${next.startTime}-${next.endTime}).`,
        'modified'
      );
    }

    return updated;
  }

  async cancel(reservationId: string, userId: string, userRole: string, cancelReason?: string) {
    const reservation = await this.findOrThrow(reservationId);
    this.assertCanManage(userId, userRole, reservation, 'cancel', 'Você só pode cancelar as próprias reservas');

    if (reservation.status === 'canceled') {
      throw new AppError(400, 'A reserva já está cancelada', 'ALREADY_CANCELED');
    }

    const now = new Date().toISOString();
    const [updated] = await this.db
      .update(reservations)
      .set({ status: 'canceled', cancelReason: cancelReason ?? null, updatedAt: now })
      .where(eq(reservations.id, reservationId))
      .returning();

    const reasonSuffix = cancelReason ? ` Motivo: ${cancelReason}` : '';
    await this.auditLog.log(
      userId,
      'cancel_reservation',
      reservationId,
      'reservation',
      `Cancelou a reserva do espaço ${reservation.spaceId} em ${reservation.date} (${reservation.startTime}-${reservation.endTime})${reasonSuffix}`
    );

    if (reservation.userId !== userId) {
      await this.notification.create(
        reservation.userId,
        'Reserva cancelada',
        `Sua reserva em ${reservation.date} (${reservation.startTime}-${reservation.endTime}) foi cancelada.${reasonSuffix}`,
        'canceled'
      );
    }

    if (this.shouldNotifyRequester(reservation, userId)) {
      const space = await this.db.query.spaces.findFirst({ where: eq(spaces.id, reservation.spaceId) });
      await this.notification.create(
        reservation.requesterUserId!,
        'Reserva cancelada',
        `A reserva do espaço ${space?.number ?? reservation.spaceId} feita para você em ${reservation.date} (${reservation.startTime}-${reservation.endTime}) foi cancelada.${reasonSuffix}`,
        'canceled'
      );
    }

    return updated;
  }

  /**
   * Cancels the upcoming occurrences of a series: its creator, staff, or
   * (MEL-025) its registered requester, whatever their role.
   */
  async cancelSeries(recurrenceId: string, userId: string, userRole: string, cancelReason?: string) {
    if (userRole === 'maintenance') {
      throw new ForbiddenError('A equipe de manutenção não pode gerenciar reservas');
    }

    const seriesReservations = await this.db.query.reservations.findMany({
      where: eq(reservations.recurrenceId, recurrenceId),
      with: { space: true, recurrence: true },
    });

    if (seriesReservations.length === 0) {
      throw new NotFoundError('Recurring reservation series');
    }

    const first = seriesReservations[0];
    const series = {
      userId: first.recurrence?.createdBy ?? first.userId,
      requesterUserId: first.recurrence?.requesterUserId ?? first.requesterUserId ?? null,
    };
    this.assertCanManage(userId, userRole, series, 'cancel', 'Você só pode cancelar as próprias séries de reservas');

    const today = campusToday();
    const upcoming = seriesReservations.filter((r) => r.status === 'confirmed' && r.date >= today);
    if (upcoming.length === 0) {
      throw new AppError(400, 'A série de reservas recorrentes já está cancelada ou todas as ocorrências já passaram', 'ALREADY_CANCELED');
    }

    const now = new Date().toISOString();
    const updatedReservations = await this.db
      .update(reservations)
      .set({ status: 'canceled', cancelReason: cancelReason ?? null, updatedAt: now })
      .where(and(eq(reservations.recurrenceId, recurrenceId), gte(reservations.date, today)))
      .returning();

    const reasonSuffix = cancelReason ? ` Motivo: ${cancelReason}` : '';
    await this.auditLog.log(
      userId,
      'cancel_recurring_reservation',
      recurrenceId,
      'reservation',
      `Cancelou a série recorrente ${seriesReservations[0]?.recurrence?.description ?? recurrenceId} (${upcoming.length} reservas)${reasonSuffix}`
    );

    for (const reservation of upcoming) {
      if (reservation.userId === userId) continue;

      await this.notification.create(
        reservation.userId,
        'Série de reservas recorrentes cancelada',
        `Sua reserva recorrente em ${reservation.date} (${reservation.startTime}-${reservation.endTime}) foi cancelada.${reasonSuffix}`,
        'canceled'
      );
    }

    // One summary for the requester rather than one notice per occurrence.
    if (this.shouldNotifyRequester(series, userId)) {
      await this.notification.create(
        series.requesterUserId!,
        'Série de reservas recorrentes cancelada',
        `As ${upcoming.length} reservas recorrentes do espaço ${first.space?.number ?? first.spaceId} feitas para você foram canceladas.${reasonSuffix}`,
        'canceled'
      );
    }

    return updatedReservations;
  }

  async getSeriesImpact(recurrenceId: string): Promise<{ futureCount: number; firstDate: string | null }> {
    const seriesReservations = await this.db.query.reservations.findMany({
      where: eq(reservations.recurrenceId, recurrenceId),
    });

    if (seriesReservations.length === 0) {
      throw new NotFoundError('Recurring reservation series');
    }

    const today = campusToday();
    const upcoming = seriesReservations
      .filter((r) => r.status === 'confirmed' && r.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date));

    return { futureCount: upcoming.length, firstDate: upcoming[0]?.date ?? null };
  }

  /**
   * "Minhas Reservas": the reservations I own plus (MEL-025) the ones staff
   * registered for me, flagged `onBehalfOfMe`. The requester contact is only
   * kept for staff viewers.
   */
  async listByUser(userId: string, userRole: string, page: number, limit: number) {
    const rows = await this.db.query.reservations.findMany({
      where: or(eq(reservations.userId, userId), eq(reservations.requesterUserId, userId)),
      with: {
        space: true,
        creator: { columns: { id: true, name: true } },
        requester: { columns: { id: true, name: true } },
      },
      // id tiebreak keeps page boundaries stable when many rows share a date.
      orderBy: (r, { desc }) => [desc(r.date), desc(r.startTime), desc(r.id)],
      limit,
      offset: (page - 1) * limit,
    });
    return rows.map((row) => presentReservationForViewer(row, { userId, role: userRole }));
  }

  async listForAdmin(filters: ListReservationsFilters) {
    const conditions = [];
    if (filters.spaceId) conditions.push(eq(reservations.spaceId, filters.spaceId));
    if (filters.userId) conditions.push(eq(reservations.userId, filters.userId));
    if (filters.status) conditions.push(eq(reservations.status, filters.status));
    if (filters.dateFrom) conditions.push(gte(reservations.date, filters.dateFrom));
    if (filters.dateTo) conditions.push(lte(reservations.date, filters.dateTo));

    const where = conditions.length ? and(...conditions) : undefined;
    const offset = (filters.page - 1) * filters.limit;

    const [data, [countRow]] = await Promise.all([
      this.db.query.reservations.findMany({
        where,
        with: { user: true, space: true, recurrence: true },
        orderBy: (r, { desc }) => [desc(r.date)],
        limit: filters.limit,
        offset,
      }),
      this.db.select({ total: count() }).from(reservations).where(where),
    ]);

    const total = countRow?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / filters.limit));

    return {
      data,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages,
      },
    };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Students and professors may only reserve spaces of their own department.
   * Staff (funcionário) are exempt; maintenance cannot reserve at all.
   */
  private assertDepartmentAccess(userRole: string, userDept: string, spaceDept: string) {
    if ((userRole === 'student' || userRole === 'professor') && spaceDept !== userDept) {
      throw new ForbiddenError('Você só pode reservar espaços do próprio departamento');
    }
  }

  /**
   * Owner or staff (MEL-023); the registered requester may only cancel
   * (MEL-025); maintenance never. See {@link canManageReservation}.
   */
  private assertCanManage(
    userId: string,
    userRole: string,
    reservation: { userId: string; requesterUserId?: string | null },
    action: ReservationAction,
    notOwnerMessage: string
  ) {
    if (userRole === 'maintenance') {
      throw new ForbiddenError('A equipe de manutenção não pode gerenciar reservas');
    }
    if (!canManageReservation({ userId, role: userRole }, reservation, action)) {
      throw new ForbiddenError(notOwnerMessage);
    }
  }

  /**
   * Validates the optional requester (MEL-025). Returns null when none was
   * sent. Throws 403 when a non-staff role sends any requester field, and 400
   * when the registered user is unknown, inactive, maintenance (which never
   * holds reservations) or the acting staff member.
   */
  private async resolveRequester(
    actorId: string,
    actorRole: string,
    input: RequesterInput
  ): Promise<ResolvedRequester | null> {
    const { requesterUserId, requesterName, requesterContact } = input;
    if (!requesterUserId && !requesterName && !requesterContact) return null;

    if (!CAN_RESERVE_ON_BEHALF.includes(actorRole)) {
      throw new ForbiddenError('Apenas funcionários podem reservar em nome de outra pessoa');
    }
    if (!requesterUserId && !requesterName) {
      throw new AppError(400, 'Informe o solicitante para registrar o contato', 'INVALID_REQUESTER');
    }
    if (requesterUserId === actorId) {
      throw new AppError(400, 'Você não pode reservar em nome de si mesmo', 'INVALID_REQUESTER');
    }

    const ids = requesterUserId ? [actorId, requesterUserId] : [actorId];
    const people = await this.db.query.users.findMany({
      where: inArray(users.id, ids),
      columns: { id: true, name: true, role: true, disabledAt: true, deletedAt: true },
    });
    const actorName = people.find((p) => p.id === actorId)?.name ?? 'Um funcionário';

    if (requesterUserId) {
      const person = people.find((p) => p.id === requesterUserId);
      if (!person || person.disabledAt || person.deletedAt || person.role === 'maintenance') {
        throw new AppError(400, 'Solicitante não encontrado ou inativo', 'INVALID_REQUESTER');
      }
      return {
        columns: { requesterUserId, requesterName: null, requesterContact: requesterContact ?? null },
        actorName,
        requesterLabel: person.name,
      };
    }

    return {
      columns: { requesterUserId: null, requesterName: requesterName!, requesterContact: requesterContact ?? null },
      actorName,
      requesterLabel: requesterName!,
    };
  }

  private requesterColumns(requester: ResolvedRequester | null) {
    return requester?.columns ?? { requesterUserId: null, requesterName: null, requesterContact: null };
  }

  /** The registered requester hears about changes made by someone else. */
  private shouldNotifyRequester(reservation: { requesterUserId?: string | null }, actorId: string) {
    return !!reservation.requesterUserId && reservation.requesterUserId !== actorId;
  }

  /** True once the reservation's start is at or before campus "now". */
  private hasStarted(date: string, startTime: string) {
    const today = campusToday();
    if (date !== today) return date < today;
    return timeToMinutes(startTime) <= campusNowMinutes();
  }

  /**
   * @param excludeReservationId the reservation being edited (MEL-023): its own
   *   interval counts as free, so it never conflicts with itself.
   */
  private async checkSlotAvailability(
    space: { closedFrom: string; closedTo: string },
    spaceId: string,
    date: string,
    startTime: string,
    endTime: string,
    excludeReservationId?: string
  ) {
    // Reject starts whose 30-minute slot already ended today (campus time). The
    // in-progress slot stays bookable (MEL-024) — the frontend only treats a slot
    // as "past" once it ENDS, and the backend must not be stricter than the UI.
    if (date === campusToday() && timeToMinutes(startTime) + SLOT_MINUTES <= campusNowMinutes()) {
      throw new ConflictError('Esta faixa de horário já passou');
    }

    if (overlapsClosedHours(startTime, endTime, space.closedFrom, space.closedTo)) {
      throw new ConflictError('Esta faixa de horário está dentro do período em que o espaço permanece fechado');
    }

    const existingReservations = await this.db.query.reservations.findMany({
      where: and(
        eq(reservations.spaceId, spaceId),
        eq(reservations.date, date),
        eq(reservations.status, 'confirmed')
      ),
    });
    if (existingReservations.some((existing) =>
      existing.id !== excludeReservationId &&
      intervalsOverlap(startTime, endTime, existing.startTime, existing.endTime))) {
      throw new ConflictError('Esta faixa de horário conflita com uma reserva existente');
    }

    const activeBlockings = await this.db.query.blockings.findMany({
      where: and(
        eq(blockings.spaceId, spaceId),
        eq(blockings.date, date),
        eq(blockings.status, 'active')
      ),
    });
    if (activeBlockings.some((blocking) => intervalsOverlap(startTime, endTime, blocking.startTime, blocking.endTime))) {
      throw new ConflictError('Este espaço está bloqueado para a faixa de horário solicitada');
    }
  }

  private async enforceActiveLimit(userId: string, userRole: string) {
    const limit = ACTIVE_RESERVATION_LIMITS[userRole] ?? null;
    if (limit === null) return;

    if (limit === 0) {
      throw new ForbiddenError('Sua função não permite criar reservas');
    }

    const today = campusToday();
    const [row] = await this.db
      .select({ total: count() })
      .from(reservations)
      .where(and(eq(reservations.userId, userId), eq(reservations.status, 'confirmed'), gte(reservations.date, today)));

    if ((row?.total ?? 0) >= limit) {
      throw new AppError(
        400,
        `Limite de ${limit} reserva${limit === 1 ? '' : 's'} ativa${limit === 1 ? '' : 's'} atingido para o seu perfil`,
        'RESERVATION_LIMIT'
      );
    }
  }

  private async findOrThrow(id: string) {
    const reservation = await this.db.query.reservations.findFirst({
      where: eq(reservations.id, id),
    });
    if (!reservation) throw new NotFoundError('Reservation');
    return reservation;
  }

  /** Every date in [start, end] falling on one of `daysOfWeek`, in calendar order. */
  private generateRecurringDates(start: string, end: string, daysOfWeek: number[]): string[] {
    const days = new Set(daysOfWeek);
    const dates: string[] = [];
    // ISO dates parse as UTC midnight, so stay in UTC to avoid local-offset drift.
    const current = new Date(start);
    const endDate = new Date(end);

    while (current <= endDate) {
      if (days.has(current.getUTCDay())) dates.push(current.toISOString().split('T')[0]);
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return dates;
  }
}
