import { Hono } from 'hono';
import type { AppEnv } from '@/types/env';
import { createDb } from '@/db/client';
import { SpaceManagerService } from '@/services/space-manager.service';
import { validate } from '@/middleware/validation';
import { rbac } from '@/middleware/rbac';
import { assignManagerSchema } from '@/validators/space-manager.schema';
import type { z } from 'zod';

const assignManagerBodySchema = assignManagerSchema.omit({ spaceId: true });

export const spaceManagerRoutes = new Hono<AppEnv>();

// POST /spaces/:spaceId/managers — assign a manager (staff only)
spaceManagerRoutes.post(
  '/:spaceId/managers',
  rbac(['staff']),
  validate(assignManagerBodySchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new SpaceManagerService(db);
    const body = c.get('validatedBody') as z.infer<typeof assignManagerBodySchema>;

    const manager = await service.assign(c.get('user').sub, {
      spaceId: c.req.param('spaceId'),
      userId: body.userId,
      role: body.role,
    });
    return c.json(manager, 201);
  }
);

// DELETE /spaces/:spaceId/managers/:userId — remove a manager (staff only)
spaceManagerRoutes.delete(
  '/:spaceId/managers/:userId',
  rbac(['staff']),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new SpaceManagerService(db);
    await service.remove(c.get('user').sub, c.req.param('spaceId'), c.req.param('userId'));
    return c.json({ success: true });
  }
);

// GET /spaces/:spaceId/managers — list managers for a space (any role)
spaceManagerRoutes.get('/:spaceId/managers', async (c) => {
  const db = createDb(c.env.DB);
  const service = new SpaceManagerService(db);
  const managers = await service.listBySpace(c.req.param('spaceId'));
  return c.json(managers);
});

export const userManagedSpacesRoutes = new Hono<AppEnv>();

// GET /users/:userId/managed-spaces — list spaces managed by a user (any role)
userManagedSpacesRoutes.get('/:userId/managed-spaces', async (c) => {
  const db = createDb(c.env.DB);
  const service = new SpaceManagerService(db);
  const spaces = await service.listByUser(c.req.param('userId'));
  return c.json(spaces);
});
