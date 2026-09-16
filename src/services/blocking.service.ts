import { eq, and, gte, lte, count, inArray } from 'drizzle-orm';
import { blockings, reservations, spaces } from '@/db/schema';
import type { Database } from '@/db/client';
import { ConflictError, ForbiddenError, NotFoundError } from '@/middleware/error-handler';
import { AuditLogService } from './audit-log.service';
import { NotificationService } from './notification.service';
import { datesBetween, deriveLegacyTimeSlot, intervalsOverlap } from '@/lib/schedule';

interface CreateBlockingInput {
  spaceId: string;
  /** Single-day form (compat). Mutually exclusive with `dateFrom`/`dateTo`. */
  date?: string;
  /** Inclusive multi-day range (MEL-017). */
  dateFrom?: string;
  dateTo?: string;
  startTime: string;
  endTime: string;
  reason: string;
  blockType: string;
}

interface ListBlockingsFilters {
  spaceId?: string;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  limit: number;
}

export class BlockingService {
  private auditLog: AuditLogService;
  private notification: NotificationService;

  constructor(private db: Database) {
    this.auditLog = new AuditLogService(db);
    this.notification = new NotificationService(db);
  }

  async create(userId: string, userRole: string, input: CreateBlockingInput) {
    const space = await this.db.query.spaces.findFirst({ where: eq(spaces.id, input.spaceId) });
    if (!space) throw new NotFoundError('Space');

    // The maintenance team only creates maintenance blockings. The server owns the
    // rule, so the payload's type is normalized instead of rejected.
    const blockType = userRole === 'maintenance' ? 'maintenance' : input.blockType;

    const dates = input.date ? [input.date] : datesBetween(input.dateFrom!, input.dateTo!);
    const isMultiDay = dates.length > 1;

    // All-or-nothing pre-check: if any day is already blocked on an overlapping
    // range, the whole operation fails so the caller can adjust the interval.
    const existingBlockings = await this.db.query.blockings.findMany({
      where: and(
        eq(blockings.spaceId, input.spaceId),
        inArray(blockings.date, dates),
        eq(blockings.status, 'active')
      ),
    });
    const conflictingDates = [
      ...new Set(
        existingBlockings
          .filter((blocking) =>
            intervalsOverlap(input.startTime, input.endTime, blocking.startTime, blocking.endTime)
          )
          .map((blocking) => blocking.date)
      ),
    ].sort();
    if (conflictingDates.length > 0) {
      throw new ConflictError(
        isMultiDay
          ? `Já existe bloqueio ativo nestes dias: ${conflictingDates.join(', ')}`
          : 'Já existe um bloqueio ativo para esta faixa de horário'
      );
    }

    const batchId = crypto.randomUUID();
    const now = new Date().toISOString();

    const conflictingReservations = await this.db.query.reservations.findMany({
      where: and(
        eq(reservations.spaceId, input.spaceId),
        inArray(reservations.date, dates),
        eq(reservations.status, 'confirmed')
      ),
    });

    const createdRows: Array<typeof blockings.$inferSelect> = [];
    let overriddenReservations = 0;

    for (const date of dates) {
      const id = crypto.randomUUID();

      const [blocking] = await this.db
        .insert(blockings)
        .values({
          id,
          spaceId: input.spaceId,
          createdBy: userId,
          date,
          timeSlot: deriveLegacyTimeSlot(input.startTime),
          startTime: input.startTime,
          endTime: input.endTime,
          reason: input.reason,
          blockType,
          status: 'active',
          batchId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      createdRows.push(blocking);

      const overlappingReservations = conflictingReservations.filter(
        (reservation) =>
          reservation.date === date &&
          intervalsOverlap(input.startTime, input.endTime, reservation.startTime, reservation.endTime)
      );

      for (const conflicting of overlappingReservations) {
        await this.db
          .update(reservations)
          .set({ status: 'overridden', changeOrigin: 'blocking', updatedAt: now })
          .where(eq(reservations.id, conflicting.id));

        await this.notification.create(
          conflicting.userId,
          'Reserva sobreposta por bloqueio',
          `Sua reserva para o espaço ${space.number} em ${date} (${conflicting.startTime}-${conflicting.endTime}) foi cancelada devido a um bloqueio ${blockType === 'administrative' ? 'administrativo' : 'de manutenção'}: ${input.reason}`,
          'overridden'
        );

        await this.auditLog.log(
          userId,
          'override_reservation',
          conflicting.id,
          'reservation',
          `Reserva sobrescrita pelo bloqueio ${id} no espaço ${space.number}`
        );
        overriddenReservations++;
      }

      await this.auditLog.log(
        userId,
        'create_blocking',
        id,
        'blocking',
        `Bloqueou o espaço ${space.number} em ${date} (${input.startTime}-${input.endTime}): ${input.reason}`
      );
    }

    return { blockings: createdRows, created: createdRows.length, overriddenReservations };
  }

  async remove(blockingId: string, userId: string, userRole: string) {
    const blocking = await this.db.query.blockings.findFirst({
      where: eq(blockings.id, blockingId),
    });
    if (!blocking) throw new NotFoundError('Blocking');

    if (userRole !== 'staff' && blocking.createdBy !== userId) {
      throw new ForbiddenError('Você só pode remover bloqueios criados por você');
    }

    const now = new Date().toISOString();
    const [updated] = await this.db
      .update(blockings)
      .set({ status: 'removed', updatedAt: now })
      .where(eq(blockings.id, blockingId))
      .returning();

    await this.auditLog.log(
      userId,
      'remove_blocking',
      blockingId,
      'blocking',
      `Removeu o bloqueio do espaço ${blocking.spaceId} em ${blocking.date} (${blocking.startTime}-${blocking.endTime})`
    );

    return updated;
  }

  async listByUser(userId: string) {
    return this.db.query.blockings.findMany({
      where: and(
        eq(blockings.createdBy, userId),
        eq(blockings.status, 'active')
      ),
      with: { space: true },
      orderBy: (b, { desc: d }) => [d(b.date)],
    });
  }

  async listBySpace(spaceId: string, date?: string) {
    return this.db.query.blockings.findMany({
      where: and(
        eq(blockings.spaceId, spaceId),
        eq(blockings.status, 'active'),
        date ? eq(blockings.date, date) : undefined
      ),
      with: { creator: true },
      orderBy: (b, { asc }) => [asc(b.date)],
    });
  }

  async listActive(filters: ListBlockingsFilters) {
    const conditions = [eq(blockings.status, 'active')];
    if (filters.spaceId) conditions.push(eq(blockings.spaceId, filters.spaceId));
    if (filters.dateFrom) conditions.push(gte(blockings.date, filters.dateFrom));
    if (filters.dateTo) conditions.push(lte(blockings.date, filters.dateTo));

    const where = and(...conditions);
    const offset = (filters.page - 1) * filters.limit;

    const [data, [countRow]] = await Promise.all([
      this.db.query.blockings.findMany({
        where,
        with: { creator: true, space: true },
        orderBy: (b, { asc }) => [asc(b.date)],
        limit: filters.limit,
        offset,
      }),
      this.db.select({ total: count() }).from(blockings).where(where),
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
}
