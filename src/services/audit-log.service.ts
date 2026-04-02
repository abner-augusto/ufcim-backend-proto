import { eq, and, desc } from 'drizzle-orm';
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
    const allLogs = await this.db.query.auditLogs.findMany({
      with: { user: true },
      orderBy: (l, { desc: d }) => [d(l.timestamp)],
    });

    const filtered = allLogs.filter((log) => {
      if (filters.userId && log.userId !== filters.userId) return false;
      if (filters.actionType && log.actionType !== filters.actionType) return false;
      if (filters.referenceType && log.referenceType !== filters.referenceType) return false;
      if (filters.dateFrom && log.timestamp.slice(0, 10) < filters.dateFrom) return false;
      if (filters.dateTo && log.timestamp.slice(0, 10) > filters.dateTo) return false;
      return true;
    });

    const start = (filters.page - 1) * filters.limit;
    return {
      data: filtered.slice(start, start + filters.limit),
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total: filtered.length,
        totalPages: Math.max(1, Math.ceil(filtered.length / filters.limit)),
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
