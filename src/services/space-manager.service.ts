import { eq, and } from 'drizzle-orm';
import { spaceManagers, spaces, users } from '@/db/schema';
import type { Database } from '@/db/client';
import { ConflictError, NotFoundError } from '@/middleware/error-handler';
import { AuditLogService } from './audit-log.service';

interface AssignManagerInput {
  spaceId: string;
  userId: string;
  role: string;
}

export class SpaceManagerService {
  private auditLog: AuditLogService;

  constructor(private db: Database) {
    this.auditLog = new AuditLogService(db);
  }

  async assign(assignedBy: string, input: AssignManagerInput) {
    const space = await this.db.query.spaces.findFirst({ where: eq(spaces.id, input.spaceId) });
    if (!space) throw new NotFoundError('Space');

    const user = await this.db.query.users.findFirst({ where: eq(users.id, input.userId) });
    if (!user) throw new NotFoundError('User');

    const existing = await this.db.query.spaceManagers.findFirst({
      where: and(
        eq(spaceManagers.spaceId, input.spaceId),
        eq(spaceManagers.userId, input.userId)
      ),
    });
    if (existing) throw new ConflictError('User is already a manager of this space');

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const [manager] = await this.db
      .insert(spaceManagers)
      .values({ id, spaceId: input.spaceId, userId: input.userId, role: input.role, assignedBy, createdAt: now })
      .returning();

    await this.auditLog.log(
      assignedBy,
      'assign_space_manager',
      id,
      'space_manager',
      `Assigned ${user.name} as ${input.role} for space ${space.number}`
    );

    return manager;
  }

  async remove(removedBy: string, spaceId: string, userId: string) {
    const existing = await this.db.query.spaceManagers.findFirst({
      where: and(
        eq(spaceManagers.spaceId, spaceId),
        eq(spaceManagers.userId, userId)
      ),
    });
    if (!existing) throw new NotFoundError('Space manager assignment');

    await this.db.delete(spaceManagers).where(eq(spaceManagers.id, existing.id));

    await this.auditLog.log(
      removedBy,
      'remove_space_manager',
      existing.id,
      'space_manager',
      `Removed manager ${userId} from space ${spaceId}`
    );
  }

  async listBySpace(spaceId: string) {
    return this.db.query.spaceManagers.findMany({
      where: eq(spaceManagers.spaceId, spaceId),
      with: { user: true },
    });
  }

  async listByUser(userId: string) {
    return this.db.query.spaceManagers.findMany({
      where: eq(spaceManagers.userId, userId),
      with: { space: true },
    });
  }

  async isManager(userId: string, spaceId: string): Promise<boolean> {
    const result = await this.db.query.spaceManagers.findFirst({
      where: and(
        eq(spaceManagers.userId, userId),
        eq(spaceManagers.spaceId, spaceId)
      ),
    });
    return result !== undefined;
  }

  async isManagerWithRole(userId: string, spaceId: string, role: string): Promise<boolean> {
    const result = await this.db.query.spaceManagers.findFirst({
      where: and(
        eq(spaceManagers.userId, userId),
        eq(spaceManagers.spaceId, spaceId),
        eq(spaceManagers.role, role)
      ),
    });
    return result !== undefined;
  }
}
