import { Hono } from 'hono';
import type { AppEnv } from '@/types/env';
import { createDb } from '@/db/client';
import { rbac } from '@/middleware/rbac';
import { StatsService } from '@/services/stats.service';

export const statsRoutes = new Hono<AppEnv>();

statsRoutes.get('/', rbac(['staff']), async (c) => {
  const db = createDb(c.env.DB);
  const service = new StatsService(db);
  const stats = await service.getDashboardStats();
  return c.json(stats);
});
