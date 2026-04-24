import { Hono } from 'hono';
import type { AppEnv } from '@/types/env';
import { createDb } from '@/db/client';
import { NotificationService } from '@/services/notification.service';

export const notificationRoutes = new Hono<AppEnv>();

// GET /notifications?unread=true (any role)
notificationRoutes.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const service = new NotificationService(db);
  const unreadOnly = c.req.query('unread') === 'true';

  const data = await service.listForUser(c.get('user').sub, unreadOnly);
  return c.json(data);
});

// PATCH /notifications/read-all (any role) — must be registered before /:id/read
notificationRoutes.patch('/read-all', async (c) => {
  const db = createDb(c.env.DB);
  const service = new NotificationService(db);
  const updated = await service.markAllRead(c.get('user').sub);
  return c.json({ updated });
});

// PATCH /notifications/:id/read (any role)
notificationRoutes.patch('/:id/read', async (c) => {
  const db = createDb(c.env.DB);
  const service = new NotificationService(db);

  const notification = await service.markAsRead(c.req.param('id'), c.get('user').sub);
  return c.json(notification);
});
