import { Hono } from 'hono';
import type { AppEnv } from '@/types/env';
import { createDb } from '@/db/client';
import { BlockingService } from '@/services/blocking.service';
import { validate } from '@/middleware/validation';
import { rbac, extractRole } from '@/middleware/rbac';
import { createBlockingSchema } from '@/validators/blocking.schema';
import type { z } from 'zod';

export const blockingRoutes = new Hono<AppEnv>();

// POST /blockings — create blocking (professor, staff, maintenance)
blockingRoutes.post(
  '/',
  rbac(['professor', 'staff', 'maintenance']),
  validate(createBlockingSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new BlockingService(db);
    const body = c.get('validatedBody') as z.infer<typeof createBlockingSchema>;

    const blocking = await service.create(c.get('user').sub, body);
    return c.json(blocking, 201);
  }
);

// PATCH /blockings/:id/remove (professor, staff, maintenance)
blockingRoutes.patch(
  '/:id/remove',
  rbac(['professor', 'staff', 'maintenance']),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new BlockingService(db);

    const result = await service.remove(c.req.param('id'), c.get('user').sub);
    return c.json(result);
  }
);

// GET /blockings/space/:spaceId?date=YYYY-MM-DD (any role)
blockingRoutes.get('/space/:spaceId', async (c) => {
  const db = createDb(c.env.DB);
  const service = new BlockingService(db);
  const date = c.req.query('date');

  const data = await service.listBySpace(c.req.param('spaceId'), date);
  return c.json(data);
});
