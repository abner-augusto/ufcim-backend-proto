import { eq, and, desc } from 'drizzle-orm';
import { auditLogs } from '@/db/schema';
import type { Database } from '@/db/client';
import { NotFoundError } from '@/middleware/error-handler';

interface ListAuditLogsFilters {
  userId?: string;
  actionType?: string;
  referenceType?: string;
  page: number;
  limit: number;
}

export class AuditLogService {
  constructor(private db: Database) {}

  async log(
    userId: string,
    actionType: string,
    referenceId: string | null,
    referenceType: string | null,
    details?: string
  ) {
    const id = crypto.randomUUID();
    await this.db.insert(auditLogs).values({
      id,
      userId,
      actionType,
      referenceId,
      referenceType,
      timestamp: new Date().toISOString(),
      details: details ?? null,
    });
  }

  async list(filters: ListAuditLogsFilters) {
    const data = await this.db.query.auditLogs.findMany({
      where: and(
        filters.userId ? eq(auditLogs.userId, filters.userId) : undefined,
        filters.actionType ? eq(auditLogs.actionType, filters.actionType) : undefined,
        filters.referenceType ? eq(auditLogs.referenceType, filters.referenceType) : undefined
      ),
      with: { user: true },
      orderBy: (l, { desc: d }) => [d(l.timestamp)],
      limit: filters.limit,
      offset: (filters.page - 1) * filters.limit,
    });

    return data;
  }

  async getById(id: string) {
    const log = await this.db.query.auditLogs.findFirst({
      where: eq(auditLogs.id, id),
      with: { user: true },
    });
    if (!log) throw new NotFoundError('Audit log entry');
    return log;
  }
}
