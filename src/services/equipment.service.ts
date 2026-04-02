import { eq } from 'drizzle-orm';
import { equipment, spaces } from '@/db/schema';
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
    if (existingAsset) throw new ConflictError('Equipment asset ID already exists');

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
      `Added equipment "${input.name}" (${input.assetId}) to space ${space.number}`
    );

    return item;
  }

  async updateStatus(id: string, userId: string, input: UpdateEquipmentStatusInput) {
    const item = await this.db.query.equipment.findFirst({ where: eq(equipment.id, id) });
    if (!item) throw new NotFoundError('Equipment');

    const [updated] = await this.db
      .update(equipment)
      .set({
        status: input.status,
        notes: input.notes ?? item.notes,
        updatedBy: userId,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(equipment.id, id))
      .returning();

    await this.auditLog.log(
      userId,
      'update_equipment_status',
      id,
      'equipment',
      `Updated equipment "${item.name}" status to ${input.status}`
    );

    return updated;
  }

  async listBySpace(spaceId: string) {
    const space = await this.db.query.spaces.findFirst({ where: eq(spaces.id, spaceId) });
    if (!space) throw new NotFoundError('Space');

    return this.db.query.equipment.findMany({
      where: eq(equipment.spaceId, spaceId),
      orderBy: (e, { asc }) => [asc(e.assetId)],
    });
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
