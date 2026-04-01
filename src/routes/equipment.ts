import { Hono } from 'hono';
import type { AppEnv } from '@/types/env';
import { createDb } from '@/db/client';
import { EquipmentService } from '@/services/equipment.service';
import { validate } from '@/middleware/validation';
import { rbac } from '@/middleware/rbac';
import { createEquipmentSchema, updateEquipmentStatusSchema } from '@/validators/equipment.schema';
import type { z } from 'zod';

export const equipmentRoutes = new Hono<AppEnv>();

// POST /equipment — create equipment (staff, maintenance)
equipmentRoutes.post(
  '/',
  rbac(['staff', 'maintenance']),
  validate(createEquipmentSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new EquipmentService(db);
    const body = c.get('validatedBody') as z.infer<typeof createEquipmentSchema>;

    const item = await service.create(c.get('user').sub, body);
    return c.json(item, 201);
  }
);

// PATCH /equipment/:id/status — update status (staff, maintenance)
equipmentRoutes.patch(
  '/:id/status',
  rbac(['staff', 'maintenance']),
  validate(updateEquipmentStatusSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new EquipmentService(db);
    const body = c.get('validatedBody') as z.infer<typeof updateEquipmentStatusSchema>;

    const item = await service.updateStatus(c.req.param('id'), c.get('user').sub, body);
    return c.json(item);
  }
);

// GET /equipment/space/:spaceId — list equipment for a space (any role)
equipmentRoutes.get('/space/:spaceId', async (c) => {
  const db = createDb(c.env.DB);
  const service = new EquipmentService(db);
  const data = await service.listBySpace(c.req.param('spaceId'));
  return c.json(data);
});
