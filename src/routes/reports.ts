import { Hono } from 'hono';
import type { AppEnv } from '@/types/env';
import { createDb } from '@/db/client';
import { rbac } from '@/middleware/rbac';
import { occupancyQuerySchema } from '@/validators/report.schema';
import { ReportService } from '@/services/report.service';

export const reportRoutes = new Hono<AppEnv>();

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
