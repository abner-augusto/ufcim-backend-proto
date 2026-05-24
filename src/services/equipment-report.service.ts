import { eq, and, gte, desc, lte } from 'drizzle-orm';
import { equipmentReports, equipment, users } from '@/db/schema';
import type { Database } from '@/db/client';
import { AppError, NotFoundError, ConflictError, ForbiddenError } from '@/middleware/error-handler';
import { AuditLogService } from './audit-log.service';
import { NotificationService } from './notification.service';

const RECENT_REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

const SEVERITY_LABELS: Record<string, string> = {
  minor: 'Leve',
  major: 'Importante',
  blocking: 'Crítico',
};

export interface CreateEquipmentReportInput {
  equipmentId: string;
  description: string;
  severity: 'minor' | 'major' | 'blocking';
}

interface ListPendingFilters {
  status?: string;
  spaceId?: string;
  page: number;
  limit: number;
}

export class EquipmentReportService {
  private auditLog: AuditLogService;
  private notification: NotificationService;

  constructor(private db: Database) {
    this.auditLog = new AuditLogService(db);
    this.notification = new NotificationService(db);
  }

  async create(userId: string, userRole: string, input: CreateEquipmentReportInput) {
    const equip = await this.db.query.equipment.findFirst({
      where: eq(equipment.id, input.equipmentId),
      with: { space: true },
    });
    if (!equip) throw new NotFoundError('Equipment');

    // Anti-spam: same user, same equipment, within 24h
    const cutoff = new Date(Date.now() - RECENT_REPORT_WINDOW_MS).toISOString();
    const recent = await this.db.query.equipmentReports.findFirst({
      where: and(
        eq(equipmentReports.reportedBy, userId),
        eq(equipmentReports.equipmentId, input.equipmentId),
        gte(equipmentReports.createdAt, cutoff)
      ),
    });
    if (recent) {
      throw new ConflictError('Você já reportou este equipamento nas últimas 24h');
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const [report] = await this.db
      .insert(equipmentReports)
      .values({
        id,
        equipmentId: input.equipmentId,
        reportedBy: userId,
        description: input.description,
        severity: input.severity,
        status: 'pending',
        createdAt: now,
      })
      .returning();

    // Auto-move equipment to broken if severity >= major and currently working
    if ((input.severity === 'major' || input.severity === 'blocking') && equip.status === 'working') {
      await this.db
        .update(equipment)
        .set({ status: 'broken', updatedBy: userId, updatedAt: now })
        .where(eq(equipment.id, input.equipmentId));
    }

    // Notify staff and maintenance
    const severityLabel = SEVERITY_LABELS[input.severity] ?? input.severity;
    const spaceLabel = equip.space?.number ?? '?';
    const message = `${severityLabel} · Sala ${spaceLabel} — ${input.description.slice(0, 80)}`;

    const staffAndMaintenance = await this.db.query.users.findMany({
      where: and(
        eq(users.disabledAt, null as unknown as string),
        eq(users.deletedAt, null as unknown as string)
      ),
    });

    const targetUsers = staffAndMaintenance.filter(
      (u) => u.role === 'staff' || u.role === 'maintenance'
    );

    for (const target of targetUsers) {
      await this.notification.create(
        target.id,
        'Novo reporte de equipamento',
        message,
        'equipment_report' as any
      );
    }

    // Audit log
    await this.auditLog.log(
      userId,
      'create_equipment_report',
      id,
      'equipment_report',
      `Reportou equipamento \"${equip.name}\" (${equip.assetId}) como ${input.severity}`
    );

    return report;
  }

  async acknowledge(reportId: string, userId: string) {
    const report = await this.db.query.equipmentReports.findFirst({
      where: eq(equipmentReports.id, reportId),
    });
    if (!report) throw new NotFoundError('Equipment');

    const now = new Date().toISOString();
    const [updated] = await this.db
      .update(equipmentReports)
      .set({ status: 'acknowledged', acknowledgedBy: userId, acknowledgedAt: now })
      .where(eq(equipmentReports.id, reportId))
      .returning();

    await this.auditLog.log(
      userId,
      'acknowledge_equipment_report',
      reportId,
      'equipment_report',
      'Marcou reporte como em análise'
    );

    return updated;
  }

  async resolve(reportId: string, userId: string) {
    const report = await this.db.query.equipmentReports.findFirst({
      where: eq(equipmentReports.id, reportId),
      with: { equipment: true, reporter: true },
    });
    if (!report) throw new NotFoundError('Equipment');

    const now = new Date().toISOString();
    const [updated] = await this.db
      .update(equipmentReports)
      .set({ status: 'resolved', resolvedAt: now })
      .where(eq(equipmentReports.id, reportId))
      .returning();

    // Notify reporter
    if (report.reporter) {
      const equipName = report.equipment?.name ?? 'Equipamento';
      await this.notification.create(
        report.reportedBy,
        'Reporte resolvido',
        `O reporte sobre \"${equipName}\" foi marcado como resolvido.`,
        'equipment_report' as any
      );
    }

    await this.auditLog.log(
      userId,
      'resolve_equipment_report',
      reportId,
      'equipment_report',
      'Marcou reporte como resolvido'
    );

    return updated;
  }

  async dismiss(reportId: string, userId: string, reason: string) {
    const report = await this.db.query.equipmentReports.findFirst({
      where: eq(equipmentReports.id, reportId),
    });
    if (!report) throw new NotFoundError('Equipment');

    const now = new Date().toISOString();
    const [updated] = await this.db
      .update(equipmentReports)
      .set({ status: 'dismissed', dismissedReason: reason, resolvedAt: now })
      .where(eq(equipmentReports.id, reportId))
      .returning();

    await this.auditLog.log(
      userId,
      'dismiss_equipment_report',
      reportId,
      'equipment_report',
      `Descartou reporte: ${reason}`
    );

    return updated;
  }

  async listByEquipment(equipmentId: string) {
    const equip = await this.db.query.equipment.findFirst({ where: eq(equipment.id, equipmentId) });
    if (!equip) throw new NotFoundError('Equipment');

    return this.db.query.equipmentReports.findMany({
      where: eq(equipmentReports.equipmentId, equipmentId),
      orderBy: (r, { desc }) => [desc(r.createdAt)],
      with: {
        reporter: true,
        acknowledger: true,
      },
    });
  }

  async listPending(filters: ListPendingFilters) {
    const conditions: any[] = [];

    if (filters.status) {
      conditions.push(eq(equipmentReports.status, filters.status));
    }

    const results = await this.db.query.equipmentReports.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: (r, { desc }) => [desc(r.createdAt)],
      with: {
        equipment: filters.spaceId
          ? { with: { space: true } }
          : true,
        reporter: true,
        acknowledger: true,
      },
      limit: filters.limit,
      offset: (filters.page - 1) * filters.limit,
    });

    // Filter by spaceId if provided
    if (filters.spaceId) {
      return results.filter((r: any) => r.equipment?.spaceId === filters.spaceId);
    }

    return results;
  }

  async listByUser(userId: string, page: number = 1, limit: number = 20) {
    return this.db.query.equipmentReports.findMany({
      where: eq(equipmentReports.reportedBy, userId),
      orderBy: (r, { desc }) => [desc(r.createdAt)],
      with: {
        equipment: { with: { space: true } },
        acknowledger: true,
      },
      limit,
      offset: (page - 1) * limit,
    });
  }
}
