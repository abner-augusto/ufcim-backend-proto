import { eq, and, gte, isNull, inArray } from 'drizzle-orm';
import { equipmentReports, equipment, equipmentStatusHistory, spaces, users } from '@/db/schema';
import type { Database } from '@/db/client';
import { AppError, NotFoundError, ConflictError } from '@/middleware/error-handler';
import {
  MAINTENANCE_CATEGORY_LABELS,
  type MaintenanceCategory,
} from '@/validators/equipment-report.schema';
import { AuditLogService } from './audit-log.service';
import { NotificationService } from './notification.service';

const RECENT_REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;
const OPEN_STATUSES = ['pending', 'acknowledged'] as const;
type OpenStatus = (typeof OPEN_STATUSES)[number];

const SEVERITY_LABELS: Record<string, string> = {
  minor: 'Leve',
  major: 'Importante',
  blocking: 'Crítico',
};

type Severity = 'minor' | 'major' | 'blocking';

export interface CreateEquipmentReportInput {
  equipmentId: string;
  description: string;
  severity: Severity;
}

/** A ticket about the room itself, by service category (MEL-026). */
export interface CreateRoomReportInput {
  spaceId: string;
  category: MaintenanceCategory;
  description: string;
  severity: Severity;
}

export type CreateReportInput = CreateEquipmentReportInput | CreateRoomReportInput;

interface ListPendingFilters {
  status?: string;
  spaceId?: string;
  page: number;
  limit: number;
}

export function categoryLabel(category: string | null | undefined): string {
  return MAINTENANCE_CATEGORY_LABELS[category as MaintenanceCategory] ?? category ?? 'Outro';
}

/** Keeps `acknowledged` over `pending` when a key has both (MEL-015). */
function mergeOpenStatus<K>(map: Map<K, OpenStatus>, key: K, status: string) {
  if (status !== 'pending' && status !== 'acknowledged') return;
  if (status === 'acknowledged' || !map.has(key)) map.set(key, status);
}

export class EquipmentReportService {
  private auditLog: AuditLogService;
  private notification: NotificationService;

  constructor(private db: Database) {
    this.auditLog = new AuditLogService(db);
    this.notification = new NotificationService(db);
  }

  async create(userId: string, userRole: string, input: CreateReportInput) {
    const hasEquipment = 'equipmentId' in input && Boolean(input.equipmentId);
    const hasRoom = 'spaceId' in input || 'category' in input;
    if (hasEquipment === hasRoom) {
      throw new AppError(400, 'Informe um equipamento ou uma sala com categoria, não os dois.', 'VALIDATION_ERROR');
    }
    return hasEquipment
      ? this.createEquipmentReport(userId, input as CreateEquipmentReportInput)
      : this.createRoomReport(userId, input as CreateRoomReportInput);
  }

  private async createEquipmentReport(userId: string, input: CreateEquipmentReportInput) {
    const equip = await this.db.query.equipment.findFirst({
      where: eq(equipment.id, input.equipmentId),
      with: { space: true },
    });
    if (!equip) throw new NotFoundError('Equipment');

    // Any open report blocks new ones, from any user — prevents duplicated
    // tickets while maintenance still handles the case (MEL-015).
    const openStatuses = await this.getOpenStatusByEquipmentIds([input.equipmentId]);
    if (openStatuses.has(input.equipmentId)) {
      throw new ConflictError('Este equipamento já possui um chamado em aberto.');
    }

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
        // The ticket keeps the room the equipment was in when reported (MEL-026).
        spaceId: equip.spaceId,
        category: null,
        reportedBy: userId,
        description: input.description,
        severity: input.severity,
        status: 'pending',
        createdAt: now,
      })
      .returning();

    // Auto-move equipment to broken if severity >= major and currently working,
    // recording the transition in the status history (MEL-013).
    if ((input.severity === 'major' || input.severity === 'blocking') && equip.status === 'working') {
      await this.db.batch([
        this.db
          .update(equipment)
          .set({ status: 'broken', updatedBy: userId, updatedAt: now })
          .where(eq(equipment.id, input.equipmentId)),
        this.db.insert(equipmentStatusHistory).values({
          id: crypto.randomUUID(),
          equipmentId: input.equipmentId,
          fromStatus: 'working',
          toStatus: 'broken',
          changedBy: userId,
          changedAt: now,
          source: 'report',
        }),
      ]);
    }

    const severityLabel = SEVERITY_LABELS[input.severity] ?? input.severity;
    const spaceLabel = equip.space?.number ?? '?';
    await this.notifyStaff(
      'Novo reporte de equipamento',
      `${severityLabel} · Sala ${spaceLabel} — ${input.description.slice(0, 80)}`
    );

    await this.auditLog.log(
      userId,
      'create_equipment_report',
      id,
      'equipment_report',
      `Reportou equipamento \"${equip.name}\" (${equip.assetId}) como ${input.severity}`
    );

    return report;
  }

  /**
   * Room ticket (MEL-026): no equipment involved, so no equipment status
   * change and no status history row, whatever the severity.
   */
  private async createRoomReport(userId: string, input: CreateRoomReportInput) {
    const space = await this.db.query.spaces.findFirst({ where: eq(spaces.id, input.spaceId) });
    if (!space) throw new NotFoundError('Space');

    // Same rule as per equipment (MEL-015), keyed by (room, category).
    const openByCategory = await this.getOpenRoomStatusByCategory(input.spaceId);
    if (openByCategory.has(input.category)) {
      throw new ConflictError('Esta sala já possui um chamado em aberto para esta categoria.');
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const [report] = await this.db
      .insert(equipmentReports)
      .values({
        id,
        equipmentId: null,
        spaceId: input.spaceId,
        category: input.category,
        reportedBy: userId,
        description: input.description,
        severity: input.severity,
        status: 'pending',
        createdAt: now,
      })
      .returning();

    const severityLabel = SEVERITY_LABELS[input.severity] ?? input.severity;
    const label = categoryLabel(input.category);
    const detail = input.description ? `: ${input.description.slice(0, 80)}` : '';
    await this.notifyStaff('Novo chamado de manutenção', `${severityLabel} · Sala ${space.number} — ${label}${detail}`);

    await this.auditLog.log(
      userId,
      'create_equipment_report',
      id,
      'equipment_report',
      `Abriu chamado de ${label} na sala ${space.number} como ${input.severity}`
    );

    return report;
  }

  private async notifyStaff(title: string, message: string) {
    const activeUsers = await this.db.query.users.findMany({
      where: and(isNull(users.disabledAt), isNull(users.deletedAt)),
    });
    const targets = activeUsers.filter((u) => u.role === 'staff' || u.role === 'maintenance');
    for (const target of targets) {
      await this.notification.create(target.id, title, message, 'equipment_report');
    }
  }

  async acknowledge(reportId: string, userId: string) {
    const report = await this.db.query.equipmentReports.findFirst({
      where: eq(equipmentReports.id, reportId),
    });
    if (!report) throw new NotFoundError('Equipment Report');

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
      with: { equipment: true, space: true, reporter: true },
    });
    if (!report) throw new NotFoundError('Equipment Report');

    const now = new Date().toISOString();
    const [updated] = await this.db
      .update(equipmentReports)
      .set({ status: 'resolved', resolvedAt: now })
      .where(eq(equipmentReports.id, reportId))
      .returning();

    // Notify reporter
    if (report.reporter) {
      const subject = report.equipment
        ? report.equipment.name
        : `${categoryLabel(report.category)} na sala ${report.space?.number ?? '?'}`;
      await this.notification.create(
        report.reportedBy,
        'Reporte resolvido',
        `O reporte sobre \"${subject}\" foi marcado como resolvido.`,
        'equipment_report'
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
    if (!report) throw new NotFoundError('Equipment Report');

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

  /**
   * Open report status per equipment id, when present (`acknowledged` wins over
   * `pending`). Shared by the create guard and by the space endpoints that
   * surface "em análise" to end users (MEL-015).
   */
  async getOpenStatusByEquipmentIds(equipmentIds: string[]): Promise<Map<string, OpenStatus>> {
    const unique = [...new Set(equipmentIds)];
    if (unique.length === 0) return new Map();

    const rows = await this.db.query.equipmentReports.findMany({
      where: and(
        inArray(equipmentReports.equipmentId, unique),
        inArray(equipmentReports.status, [...OPEN_STATUSES])
      ),
    });

    const map = new Map<string, OpenStatus>();
    for (const row of rows) {
      if (row.equipmentId) mergeOpenStatus(map, row.equipmentId, row.status);
    }
    return map;
  }

  /**
   * Open room-ticket status per category for one space (MEL-026). Feeds the
   * (room, category) re-report guard and the room popup.
   */
  async getOpenRoomStatusByCategory(spaceId: string): Promise<Map<MaintenanceCategory, OpenStatus>> {
    const rows = await this.db.query.equipmentReports.findMany({
      where: and(
        eq(equipmentReports.spaceId, spaceId),
        isNull(equipmentReports.equipmentId),
        inArray(equipmentReports.status, [...OPEN_STATUSES])
      ),
    });

    const map = new Map<MaintenanceCategory, OpenStatus>();
    for (const row of rows) {
      if (row.equipmentId || !row.category) continue;
      mergeOpenStatus(map, row.category as MaintenanceCategory, row.status);
    }
    return map;
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
    const conditions = [];

    if (filters.status) {
      conditions.push(eq(equipmentReports.status, filters.status));
    }

    // Every ticket carries its room, so room tickets match too (MEL-026).
    if (filters.spaceId) {
      conditions.push(eq(equipmentReports.spaceId, filters.spaceId));
    }

    return this.db.query.equipmentReports.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: (r, { desc }) => [desc(r.createdAt)],
      with: {
        equipment: { with: { space: { with: { department: true } } } },
        space: { with: { department: true } },
        reporter: true,
        acknowledger: true,
      },
      limit: filters.limit,
      offset: (filters.page - 1) * filters.limit,
    });
  }

  async listByUser(userId: string, page: number = 1, limit: number = 20) {
    return this.db.query.equipmentReports.findMany({
      where: eq(equipmentReports.reportedBy, userId),
      orderBy: (r, { desc }) => [desc(r.createdAt)],
      with: {
        equipment: { with: { space: true } },
        space: true,
        acknowledger: true,
      },
      limit,
      offset: (page - 1) * limit,
    });
  }
}
