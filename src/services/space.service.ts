import { eq, and, count } from 'drizzle-orm';
import { spaces, reservations, blockings, equipment, spaceManagers } from '@/db/schema';
import type { Database } from '@/db/client';
import { NotFoundError } from '@/middleware/error-handler';
import { AuditLogService } from './audit-log.service';
import { buildHourlyAvailability, DEFAULT_CLOSED_FROM, DEFAULT_CLOSED_TO } from '@/lib/schedule';

interface CreateSpaceInput {
  number: string;
  type: string;
  block: string;
  campus: string;
  department: string;
  capacity: number;
  furniture?: string;
  lighting?: string;
  hvac?: string;
  multimedia?: string;
  modelId?: string;
  closedFrom: string;
  closedTo: string;
}

interface ListSpacesFilters {
  campus?: string;
  block?: string;
  department?: string;
  type?: string;
  modelId?: string;
  page: number;
  limit: number;
}

export class SpaceService {
  private auditLog: AuditLogService;

  constructor(private db: Database) {
    this.auditLog = new AuditLogService(db);
  }

  async create(userId: string, input: CreateSpaceInput) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const [space] = await this.db
      .insert(spaces)
      .values({
        id,
        ...input,
        closedFrom: input.closedFrom ?? DEFAULT_CLOSED_FROM,
        closedTo: input.closedTo ?? DEFAULT_CLOSED_TO,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await this.auditLog.log(userId, 'create_space', id, 'space', `Created space ${input.number}`);

    return space;
  }

  async delete(id: string, userId: string) {
    const existing = await this.db.query.spaces.findFirst({ where: eq(spaces.id, id) });
    if (!existing) throw new NotFoundError('Space');

    const [{ reservationCount }] = await this.db
      .select({ reservationCount: count() })
      .from(reservations)
      .where(and(eq(reservations.spaceId, id), eq(reservations.status, 'confirmed')));

    if (reservationCount > 0) {
      throw new Error(`Não é possível remover: o espaço possui ${reservationCount} reserva(s) confirmada(s).`);
    }

    const [{ blockingCount }] = await this.db
      .select({ blockingCount: count() })
      .from(blockings)
      .where(and(eq(blockings.spaceId, id), eq(blockings.status, 'active')));

    if (blockingCount > 0) {
      throw new Error(`Não é possível remover: o espaço possui ${blockingCount} bloqueio(s) ativo(s).`);
    }

    await this.db.delete(equipment).where(eq(equipment.spaceId, id));
    await this.db.delete(spaceManagers).where(eq(spaceManagers.spaceId, id));
    await this.db.delete(spaces).where(eq(spaces.id, id));

    await this.auditLog.log(userId, 'delete_space', id, 'space', `Deleted space ${existing.number}`);
  }

  async update(id: string, userId: string, input: Partial<CreateSpaceInput>) {
    const existing = await this.db.query.spaces.findFirst({ where: eq(spaces.id, id) });
    if (!existing) throw new NotFoundError('Space');

    const [updated] = await this.db
      .update(spaces)
      .set({ ...input, updatedAt: new Date().toISOString() })
      .where(eq(spaces.id, id))
      .returning();

    await this.auditLog.log(userId, 'update_space', id, 'space', `Updated space ${existing.number}`);

    return updated;
  }

  async getById(id: string) {
    const space = await this.db.query.spaces.findFirst({
      where: eq(spaces.id, id),
      with: { equipment: true, managers: { with: { user: true } } },
    });
    if (!space) throw new NotFoundError('Space');
    return space;
  }

  async list(filters: ListSpacesFilters) {
    return this.db.query.spaces.findMany({
      where: and(
        filters.campus ? eq(spaces.campus, filters.campus) : undefined,
        filters.block ? eq(spaces.block, filters.block) : undefined,
        filters.department ? eq(spaces.department, filters.department) : undefined,
        filters.type ? eq(spaces.type, filters.type) : undefined,
        filters.modelId ? eq(spaces.modelId, filters.modelId) : undefined
      ),
      limit: filters.limit,
      offset: (filters.page - 1) * filters.limit,
    });
  }

  /**
   * Computes slot availability for a given space and date.
   * Queries both reservations and blockings tables — no stored status column.
   */
  async getAvailability(spaceId: string, date: string) {
    const space = await this.db.query.spaces.findFirst({ where: eq(spaces.id, spaceId) });
    if (!space) throw new NotFoundError('Space');

    const [confirmedReservations, activeBlockings] = await Promise.all([
      this.db.query.reservations.findMany({
        where: and(
          eq(reservations.spaceId, spaceId),
          eq(reservations.date, date),
          eq(reservations.status, 'confirmed')
        ),
      }),
      this.db.query.blockings.findMany({
        where: and(
          eq(blockings.spaceId, spaceId),
          eq(blockings.date, date),
          eq(blockings.status, 'active')
        ),
      }),
    ]);

    const slots = buildHourlyAvailability(
      space.closedFrom ?? DEFAULT_CLOSED_FROM,
      space.closedTo ?? DEFAULT_CLOSED_TO,
      confirmedReservations.map((reservation) => ({
        startTime: reservation.startTime,
        endTime: reservation.endTime,
      })),
      activeBlockings.map((blocking) => ({
        startTime: blocking.startTime,
        endTime: blocking.endTime,
      }))
    );

    if (!space.reservable) {
      return slots.map((slot) =>
        slot.status === 'closed' ? slot : { ...slot, status: 'not_reservable' as const }
      );
    }

    return slots;
  }
}
