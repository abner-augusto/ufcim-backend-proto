import { Hono } from 'hono';
import type { AppEnv } from '@/types/env';
import { createDb } from '@/db/client';
import { rbac } from '@/middleware/rbac';
import { validateQuery } from '@/middleware/validation';
import { occupancyQuerySchema, maintenanceEquipmentQuerySchema } from '@/validators/report.schema';
import { ReportService } from '@/services/report.service';
import { MaintenanceReportService } from '@/services/maintenance-report.service';
import type { z } from 'zod';

export const reportRoutes = new Hono<AppEnv>();

// GET /reports/maintenance/equipment — per-equipment maintenance history (MEL-013)
reportRoutes.get(
  '/maintenance/equipment',
  rbac(['staff', 'maintenance']),
  validateQuery(maintenanceEquipmentQuerySchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new MaintenanceReportService(db);
    const filters = c.get('validatedQuery') as z.infer<typeof maintenanceEquipmentQuerySchema>;
    return c.json(await service.listEquipment(filters));
  }
);

reportRoutes.get('/occupancy', rbac(['professor', 'staff', 'maintenance']), async (c) => {
  const query = c.req.query();

  const parsed = occupancyQuerySchema.safeParse(query);
  if (!parsed.success) {
    return c.json(
      { error: 'Parâmetros inválidos', details: parsed.error.flatten().fieldErrors },
      400,
    );
  }

  const db = createDb(c.env.DB);
  const service = new ReportService(db);
  const report = await service.getOccupancyReport(parsed.data);

  return c.json(report);
});
