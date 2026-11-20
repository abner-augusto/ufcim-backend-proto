import { Hono } from 'hono';
import type { z } from 'zod';
import type { AppEnv } from '@/types/env';
import { createDb } from '@/db/client';
import { DepartmentAuditLogService } from '@/services/department-audit-log.service';
import { validateQuery } from '@/middleware/validation';
import { rbac } from '@/middleware/rbac';
import { departmentAuditLogQuerySchema } from '@/validators/department-audit-log.schema';

export const logRoutes = new Hono<AppEnv>();

// GET /logs — reservation and blocking audit logs for the staff member's department
logRoutes.get(
  '/',
  rbac(['staff']),
  validateQuery(departmentAuditLogQuerySchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new DepartmentAuditLogService(db);
    const filters = c.get('validatedQuery') as z.infer<typeof departmentAuditLogQuerySchema>;
    const user = c.get('user');

    const data = await service.list(user.sub, user.department, filters);
    return c.json(data);
  }
);
