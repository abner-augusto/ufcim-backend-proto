import { eq, and, count } from 'drizzle-orm';
import { spaces, reservations, blockings, equipment, spaceManagers } from '@/db/schema';
import type { Database } from '@/db/client';
import { AppError, NotFoundError } from '@/middleware/error-handler';
import { AuditLogService } from './audit-log.service';
import { DepartmentService } from './department.service';
import { SpaceManagerService } from './space-manager.service';
import { buildHourlyAvailability, intervalsOverlap, DEFAULT_CLOSED_FROM, DEFAULT_CLOSED_TO } from '@/lib/schedule';
import { formatReservationAuthor } from '@/lib/reservation-privacy';
import type { UserRole } from '@/types/auth';

interface CreateSpaceInput {
  name: string;
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
    if (!(await new DepartmentService(this.db).validateId(input.department))) {
      throw new AppError(422, `Departamento "${input.department}" não existe`, 'INVALID_DEPARTMENT');
    }

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

    await this.auditLog.log(userId, 'create_space', id, 'space', `Criou o espaço ${input.name} (${input.number})`);

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
    await this.db.delete(reservations).where(eq(reservations.spaceId, id));
    await this.db.delete(blockings).where(eq(blockings.spaceId, id));
    await this.db.delete(spaces).where(eq(spaces.id, id));

    await this.auditLog.log(userId, 'delete_space', id, 'space', `Removeu o espaço ${existing.number}`);
  }

  async update(id: string, userId: string, input: Partial<CreateSpaceInput>) {
    const existing = await this.db.query.spaces.findFirst({ where: eq(spaces.id, id) });
    if (!existing) throw new NotFoundError('Space');

    if (input.department && !(await new DepartmentService(this.db).validateId(input.department))) {
      throw new AppError(422, `Departamento "${input.department}" não existe`, 'INVALID_DEPARTMENT');
    }

    const [updated] = await this.db
      .update(spaces)
      .set({ ...input, updatedAt: new Date().toISOString() })
      .where(eq(spaces.id, id))
      .returning();

    await this.auditLog.log(userId, 'update_space', id, 'space', `Atualizou o espaço ${existing.number}`);

    return updated;
  }

  async getById(id: string) {
    const space = await this.db.query.spaces.findFirst({
      where: eq(spaces.id, id),
      with: { equipment: true, managers: { with: { user: true } }, department: true },
    });
    if (!space) throw new NotFoundError('Space');
    return { ...space, department: space.department?.name ?? space.department as unknown as string };
  }

  async list(filters: ListSpacesFilters) {
    const rows = await this.db.query.spaces.findMany({
      where: and(
        filters.campus ? eq(spaces.campus, filters.campus) : undefined,
        filters.block ? eq(spaces.block, filters.block) : undefined,
        filters.department ? eq(spaces.department, filters.department) : undefined,
        filters.type ? eq(spaces.type, filters.type) : undefined,
        filters.modelId ? eq(spaces.modelId, filters.modelId) : undefined
      ),
      with: { department: true },
      limit: filters.limit,
      offset: (filters.page - 1) * filters.limit,
    });
    return rows.map((s) => ({ ...s, department: s.department?.name ?? s.department as unknown as string }));
  }

  /**
   * Computes slot availability for a given space and date.
   * When a viewer is provided, enriches reserved/blocked slots with
   * author details (privacy-filtered by role) and recurrence info.
   */
  async getAvailability(
    spaceId: string,
    date: string,
    viewer?: { userId: string; role: UserRole }
  ) {
    const space = await this.db.query.spaces.findFirst({ where: eq(spaces.id, spaceId) });
    if (!space) throw new NotFoundError('Space');

    // Check if viewer is a manager of this space
    let isManager = false;
    if (viewer) {
      isManager = await new SpaceManagerService(this.db).isManager(viewer.userId, spaceId);
    }

    // Load reservations and blockings (with relations only when viewer present)
    const [confirmedReservations, activeBlockings] = await Promise.all([
      this.db.query.reservations.findMany({
        where: and(
          eq(reservations.spaceId, spaceId),
          eq(reservations.date, date),
          eq(reservations.status, 'confirmed')
        ),
        ...(viewer ? { with: { user: true, recurrence: true } as const } : {}),
      }),
      this.db.query.blockings.findMany({
        where: and(
          eq(blockings.spaceId, spaceId),
          eq(blockings.date, date),
          eq(blockings.status, 'active')
        ),
        ...(viewer ? { with: { creator: true } as const } : {}),
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

    // If space is not reservable, mark all open slots
    if (!space.reservable) {
      const filtered = slots.map((slot) =>
        slot.status === 'closed' ? slot : { ...slot, status: 'not_reservable' as const }
      );
      return this.enrichSlots(filtered, confirmedReservations, activeBlockings, viewer, isManager);
    }

    return this.enrichSlots(slots, confirmedReservations, activeBlockings, viewer, isManager);
  }

  /**
   * Second pass: attach reservation/blocking detail to occupied slots.
   */
  private enrichSlots<T extends { startTime: string; endTime: string; status: string }>(
    slots: T[],
    confirmedReservations: Array<{
      id: string;
      userId: string;
      startTime: string;
      endTime: string;
      purpose: string | null;
      description: string | null;
      recurrenceId: string | null;
      user?: { id: string; name: string; role: string } | null;
      recurrence?: { description: string } | null;
    }>,
    activeBlockings: Array<{
      id: string;
      startTime: string;
      endTime: string;
      blockType: string;
      reason: string | null;
      date: string;
      creator?: { id: string; name: string; role: string } | null;
    }>,
    viewer?: { userId: string; role: UserRole },
    isManager?: boolean
  ) {
    return slots.map((slot) => {
      if (slot.status === 'reserved') {
        const reservation = confirmedReservations.find(
          (r) => intervalsOverlap(slot.startTime, slot.endTime, r.startTime, r.endTime)
        );
        if (reservation && viewer && reservation.user) {
          const author = formatReservationAuthor(
            { ownerId: reservation.userId, ownerName: reservation.user.name, ownerRole: reservation.user.role },
            viewer,
            { isManager }
          );
          const description = reservation.description ?? reservation.recurrence?.description ?? null;
          return {
            ...slot,
            reservation: {
              id: reservation.id,
              purpose: reservation.purpose ?? 'other',
              description,
              isRecurring: !!reservation.recurrenceId,
              isSelf: author.isSelf,
              author: { displayName: author.displayName, role: author.role },
            },
          };
        }
      }

      if (slot.status === 'blocked') {
        const blocking = activeBlockings.find(
          (b) => intervalsOverlap(slot.startTime, slot.endTime, b.startTime, b.endTime)
        );
        if (blocking && viewer && blocking.creator) {
          const author = formatReservationAuthor(
            { ownerId: blocking.creator.id, ownerName: blocking.creator.name, ownerRole: blocking.creator.role },
            viewer,
            { isManager }
          );
          return {
            ...slot,
            blocking: {
              id: blocking.id,
              blockType: blocking.blockType,
              reason: blocking.reason,
              rangeStartDate: blocking.date,
              rangeEndDate: blocking.date,
              author: { displayName: author.displayName, role: author.role },
            },
          };
        }
      }

      return slot;
    });
  }
}
