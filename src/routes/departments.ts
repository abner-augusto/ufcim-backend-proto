import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '@/types/env';
import { createDb } from '@/db/client';
import { DepartmentService } from '@/services/department.service';
import { validate } from '@/middleware/validation';
import { rbac } from '@/middleware/rbac';

const createDepartmentSchema = z.object({
  id: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/, 'ID deve conter apenas letras minúsculas, números, hífens e underscores'),
  name: z.string().min(2).max(100),
  campus: z.string().min(1).max(100),
});

const updateDepartmentSchema = createDepartmentSchema.omit({ id: true }).partial();

export const departmentRoutes = new Hono<AppEnv>();

// GET /departments — list all (any authenticated user, used by frontend selects)
departmentRoutes.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const service = new DepartmentService(db);
  return c.json(await service.list());
});

// POST /departments — create (staff/master-admin only)
departmentRoutes.post(
  '/',
  rbac(['staff']),
  validate(createDepartmentSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new DepartmentService(db);
    const body = c.get('validatedBody') as z.infer<typeof createDepartmentSchema>;
    const dept = await service.create(body);
    return c.json(dept, 201);
  }
);

// PATCH /departments/:id — update name/campus (staff/master-admin only)
departmentRoutes.patch(
  '/:id',
  rbac(['staff']),
  validate(updateDepartmentSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new DepartmentService(db);
    const body = c.get('validatedBody') as z.infer<typeof updateDepartmentSchema>;
    const dept = await service.update(c.req.param('id'), body);
    return c.json(dept);
  }
);
