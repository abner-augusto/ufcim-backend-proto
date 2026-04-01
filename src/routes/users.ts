import { Hono } from 'hono';
import type { AppEnv } from '@/types/env';
import { createDb } from '@/db/client';
import { UserService } from '@/services/user.service';
import { validateQuery } from '@/middleware/validation';
import { rbac } from '@/middleware/rbac';
import { paginationSchema } from '@/validators/common.schema';
import type { z } from 'zod';

export const userRoutes = new Hono<AppEnv>();

// GET /users — list all users (staff only)
userRoutes.get(
  '/',
  rbac(['staff']),
  validateQuery(paginationSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new UserService(db);
    const { page, limit } = c.get('validatedQuery') as z.infer<typeof paginationSchema>;

    const data = await service.list(page, limit);
    return c.json(data);
  }
);

// GET /users/me — current user profile (any authenticated role)
userRoutes.get('/me', async (c) => {
  const db = createDb(c.env.DB);
  const service = new UserService(db);
  const user = await service.getById(c.get('user').sub);
  return c.json(user);
});
