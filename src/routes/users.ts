import { Hono } from 'hono';
import type { AppEnv } from '@/types/env';
import { createDb } from '@/db/client';
import { UserService } from '@/services/user.service';
import { validateQuery } from '@/middleware/validation';
import { rbac } from '@/middleware/rbac';
import { paginationSchema } from '@/validators/common.schema';
import { z } from 'zod';

export const userRoutes = new Hono<AppEnv>();

const requesterSearchSchema = z.object({
  q: z.string().trim().min(2, 'Digite ao menos 2 caracteres').max(100),
});

// GET /users/search?q= — requester lookup for reserving on someone's behalf
// (MEL-025, staff only): active users matching name or e-mail, max 10.
userRoutes.get(
  '/search',
  rbac(['staff']),
  validateQuery(requesterSearchSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new UserService(db);
    const { q } = c.get('validatedQuery') as z.infer<typeof requesterSearchSchema>;

    return c.json(await service.searchRequesters(q, c.get('user').sub));
  }
);

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

// GET /users/me — current user profile with unread notification count
userRoutes.get('/me', async (c) => {
  const db = createDb(c.env.DB);
  const service = new UserService(db);
  const profile = await service.getMeProfile(c.get('user').sub);
  return c.json(profile);
});
