import { eq, and, count, desc, gte, lt } from 'drizzle-orm';
import { auditLogs } from '@/db/schema';
import type { Database } from '@/db/client';
import { NotFoundError } from '@/middleware/error-handler';

interface ListAuditLogsFilters {
  userId?: string;
  actionType?: string;
  referenceType?: string;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  limit: number;
}

function nextDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
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
    const conditions = [];
    if (filters.userId) conditions.push(eq(auditLogs.userId, filters.userId));
    if (filters.actionType) conditions.push(eq(auditLogs.actionType, filters.actionType));
    if (filters.referenceType) conditions.push(eq(auditLogs.referenceType, filters.referenceType));
    if (filters.dateFrom) conditions.push(gte(auditLogs.timestamp, filters.dateFrom));
    if (filters.dateTo) conditions.push(lt(auditLogs.timestamp, nextDay(filters.dateTo)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (filters.page - 1) * filters.limit;

    const [data, [countRow]] = await Promise.all([
      this.db.query.auditLogs.findMany({
        where,
        with: { user: true },
        orderBy: (l, { desc }) => [desc(l.timestamp)],
        limit: filters.limit,
        offset,
      }),
      this.db.select({ total: count() }).from(auditLogs).where(where),
    ]);

    const total = countRow?.total ?? 0;
    return {
      data,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / filters.limit)),
      },
    };
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
