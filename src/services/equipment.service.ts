import { eq } from 'drizzle-orm';
import { equipment, equipmentStatusHistory, spaces } from '@/db/schema';
import type { Database } from '@/db/client';
import { ConflictError, NotFoundError } from '@/middleware/error-handler';
import { AuditLogService } from './audit-log.service';

interface CreateEquipmentInput {
  assetId: string;
  spaceId: string;
  name: string;
  type: string;
  status: string;
  notes?: string;
}

interface UpdateEquipmentStatusInput {
  status: string;
  notes?: string;
  assetId?: string;
}

export class EquipmentService {
  private auditLog: AuditLogService;

  constructor(private db: Database) {
    this.auditLog = new AuditLogService(db);
  }

  async create(userId: string, input: CreateEquipmentInput) {
    const space = await this.db.query.spaces.findFirst({ where: eq(spaces.id, input.spaceId) });
    if (!space) throw new NotFoundError('Space');

    const existingAsset = await this.db.query.equipment.findFirst({
      where: eq(equipment.assetId, input.assetId),
    });
    if (existingAsset) throw new ConflictError('O ID patrimonial do equipamento já existe');

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const [item] = await this.db
      .insert(equipment)
      .values({ id, ...input, notes: input.notes ?? null, updatedBy: userId, updatedAt: now })
      .returning();

    await this.auditLog.log(
      userId,
      'create_equipment',
      id,
      'equipment',
      `Adicionou o equipamento "${input.name}" (${input.assetId}) ao espaço ${space.number}`
    );

    return item;
  }

  async updateStatus(id: string, userId: string, input: UpdateEquipmentStatusInput) {
    const item = await this.db.query.equipment.findFirst({ where: eq(equipment.id, id) });
    if (!item) throw new NotFoundError('Equipment');

    const now = new Date().toISOString();
    const updateQuery = this.db
      .update(equipment)
      .set({
        assetId: input.assetId ?? item.assetId,
        status: input.status,
        notes: input.notes ?? item.notes,
        updatedBy: userId,
        updatedAt: now,
      })
      .where(eq(equipment.id, id))
      .returning();

    let updated: typeof equipment.$inferSelect | undefined;
    if (item.status !== input.status) {
      // Status change and its history row land atomically (MEL-013).
      const [rows] = await this.db.batch([
        updateQuery,
        this.db.insert(equipmentStatusHistory).values({
          id: crypto.randomUUID(),
          equipmentId: id,
          fromStatus: item.status,
          toStatus: input.status,
          changedBy: userId,
          changedAt: now,
          source: 'manual',
        }),
      ]);
      [updated] = rows;
    } else {
      [updated] = await updateQuery;
    }

    await this.auditLog.log(
      userId,
      'update_equipment_status',
      id,
      'equipment',
      `Atualizou o status do equipamento "${item.name}" para ${input.status}`
    );

    return updated;
  }

  async listGroupedBySpace() {
    const allSpaces = await this.db.query.spaces.findMany({
      with: { equipment: true },
      orderBy: (s, { asc }) => [asc(s.number)],
    });

    return allSpaces.map((space) => ({
      ...space,
      equipment: [...space.equipment].sort((a, b) => a.assetId.localeCompare(b.assetId)),
    }));
  }
}
