import { eq, and } from 'drizzle-orm';
import { blockings, reservations, spaces } from '@/db/schema';
import type { Database } from '@/db/client';
import { ConflictError, NotFoundError } from '@/middleware/error-handler';
import { AuditLogService } from './audit-log.service';
import { NotificationService } from './notification.service';
import { deriveLegacyTimeSlot, intervalsOverlap, overlapsClosedHours } from '@/lib/schedule';

interface CreateBlockingInput {
  spaceId: string;
  date: string;
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

  async create(userId: string, input: CreateBlockingInput) {
    const space = await this.db.query.spaces.findFirst({ where: eq(spaces.id, input.spaceId) });
    if (!space) throw new NotFoundError('Space');

    if (overlapsClosedHours(input.startTime, input.endTime, space.closedFrom, space.closedTo)) {
      throw new ConflictError('This blocking falls within the room closed hours');
    }

    const existingBlockings = await this.db.query.blockings.findMany({
      where: and(
        eq(blockings.spaceId, input.spaceId),
        eq(blockings.date, input.date),
        eq(blockings.status, 'active')
      ),
    });
    if (existingBlockings.some((blocking) => intervalsOverlap(input.startTime, input.endTime, blocking.startTime, blocking.endTime))) {
      throw new ConflictError('An active blocking already exists for this time range');
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const [blocking] = await this.db
      .insert(blockings)
      .values({
        id,
        spaceId: input.spaceId,
        createdBy: userId,
        date: input.date,
        timeSlot: deriveLegacyTimeSlot(input.startTime),
        startTime: input.startTime,
        endTime: input.endTime,
        reason: input.reason,
        blockType: input.blockType,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const conflictingReservations = await this.db.query.reservations.findMany({
      where: and(
        eq(reservations.spaceId, input.spaceId),
        eq(reservations.date, input.date),
        eq(reservations.status, 'confirmed')
      ),
    });

    const overlappingReservations = conflictingReservations.filter((reservation) =>
      intervalsOverlap(input.startTime, input.endTime, reservation.startTime, reservation.endTime)
    );

    for (const conflicting of overlappingReservations) {
      await this.db
        .update(reservations)
        .set({ status: 'overridden', changeOrigin: 'blocking', updatedAt: now })
        .where(eq(reservations.id, conflicting.id));

      await this.notification.create(
        conflicting.userId,
        'Reservation overridden',
        `Your reservation for space ${space.number} on ${input.date} (${conflicting.startTime}-${conflicting.endTime}) was overridden due to a ${input.blockType} blocking: ${input.reason}`,
        'overridden'
      );

      await this.auditLog.log(
        userId,
        'override_reservation',
        conflicting.id,
        'reservation',
        `Reservation overridden by blocking ${id} on space ${space.number}`
      );
    }

    await this.auditLog.log(
      userId,
      'create_blocking',
      id,
      'blocking',
      `Blocked space ${space.number} on ${input.date} (${input.startTime}-${input.endTime}): ${input.reason}`
    );

    return blocking;
  }

  async remove(blockingId: string, userId: string) {
    const blocking = await this.db.query.blockings.findFirst({
      where: eq(blockings.id, blockingId),
    });
    if (!blocking) throw new NotFoundError('Blocking');

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
      `Removed blocking for space ${blocking.spaceId} on ${blocking.date} (${blocking.startTime}-${blocking.endTime})`
    );

    return updated;
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
    const allBlockings = await this.db.query.blockings.findMany({
      with: { creator: true, space: true },
      orderBy: (b, { asc }) => [asc(b.date)],
    });

    const filtered = allBlockings.filter((blocking) => {
      if (blocking.status !== 'active') return false;
      if (filters.spaceId && blocking.spaceId !== filters.spaceId) return false;
      if (filters.dateFrom && blocking.date < filters.dateFrom) return false;
      if (filters.dateTo && blocking.date > filters.dateTo) return false;
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
}
