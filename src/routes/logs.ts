import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '@/types/env';
import { createDb } from '@/db/client';
import { AuditLogService } from '@/services/audit-log.service';
import { validateQuery } from '@/middleware/validation';
import { rbac } from '@/middleware/rbac';

const logQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  actionType: z.string().optional(),
  referenceType: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const logRoutes = new Hono<AppEnv>();

// GET /logs — audit logs (staff only)
logRoutes.get(
  '/',
  rbac(['staff']),
  validateQuery(logQuerySchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new AuditLogService(db);
    const filters = c.get('validatedQuery') as z.infer<typeof logQuerySchema>;

    const data = await service.list(filters);
    return c.json(data);
  }
);
