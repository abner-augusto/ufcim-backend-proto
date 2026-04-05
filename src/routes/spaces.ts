import { Hono } from 'hono';
import type { AppEnv } from '@/types/env';
import { createDb } from '@/db/client';
import { SpaceService } from '@/services/space.service';
import { validate, validateQuery } from '@/middleware/validation';
import { rbac } from '@/middleware/rbac';
import { createSpaceSchema, updateSpaceSchema, spaceQuerySchema } from '@/validators/space.schema';
import type { z } from 'zod';

export const spaceRoutes = new Hono<AppEnv>();

// POST /spaces — create space (staff only)
spaceRoutes.post(
  '/',
  rbac(['staff']),
  validate(createSpaceSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new SpaceService(db);
    const body = c.get('validatedBody') as z.infer<typeof createSpaceSchema>;

    const space = await service.create(c.get('user').sub, body);
    return c.json(space, 201);
  }
);

// GET /spaces — list spaces with optional filters (any role)
spaceRoutes.get(
  '/',
  validateQuery(spaceQuerySchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new SpaceService(db);
    const filters = c.get('validatedQuery') as z.infer<typeof spaceQuerySchema>;

    const data = await service.list(filters);
    return c.json(data);
  }
);

// GET /spaces/:id — space details with equipment (any role)
spaceRoutes.get('/:id', async (c) => {
  const db = createDb(c.env.DB);
  const service = new SpaceService(db);
  const space = await service.getById(c.req.param('id'));
  return c.json(space);
});

// GET /spaces/:id/availability?date=YYYY-MM-DD (any role)
spaceRoutes.get('/:id/availability', async (c) => {
  const date = c.req.query('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'O parâmetro de consulta "date" é obrigatório (YYYY-MM-DD)', code: 'VALIDATION_ERROR' }, 400);
  }

  const db = createDb(c.env.DB);
  const service = new SpaceService(db);
  const availability = await service.getAvailability(c.req.param('id'), date);
  return c.json(availability);
});

// PUT /spaces/:id — update space (staff only)
spaceRoutes.put(
  '/:id',
  rbac(['staff']),
  validate(updateSpaceSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new SpaceService(db);
    const body = c.get('validatedBody') as z.infer<typeof updateSpaceSchema>;

    const space = await service.update(c.req.param('id'), c.get('user').sub, body);
    return c.json(space);
  }
);
