import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env, AppVariables } from '@/types/env';
import { globalErrorHandler } from '@/middleware/error-handler';
import { createDb } from '@/db/client';
import { UserService } from '@/services/user.service';
import { userRoutes } from '@/routes/users';
import { spaceRoutes } from '@/routes/spaces';
import { spaceManagerRoutes, userManagedSpacesRoutes } from '@/routes/space-managers';
import { equipmentRoutes } from '@/routes/equipment';
import { reservationRoutes } from '@/routes/reservations';
import { blockingRoutes } from '@/routes/blockings';
import { notificationRoutes } from '@/routes/notifications';
import { logRoutes } from '@/routes/logs';
import { statsRoutes } from '@/routes/stats';
import { adminRoutes } from '@/routes/admin';
import { authRoutes } from '@/routes/auth';
import { bootstrapRoutes } from '@/routes/bootstrap';
import { rbac, requireMasterAdmin } from '@/middleware/rbac';
import { renderAdminLogin } from '@/admin/admin-login';

type AppEnv = { Bindings: Env; Variables: AppVariables };

const syncUserMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const db = createDb(c.env.DB);
  const userService = new UserService(db);
  await userService.syncFromToken(c.get('user'));
  await next();
});

interface CreateAppOptions {
  authMiddleware: MiddlewareHandler<AppEnv>;
  devRoutes?: Hono<AppEnv>;
}

export function createApp({ authMiddleware, devRoutes }: CreateAppOptions) {
  const app = new Hono<AppEnv>();
  const api = new Hono<AppEnv>();
  const admin = new Hono<AppEnv>();

  app.use('*', cors());
  app.use('*', logger());
  app.onError(globalErrorHandler);

  app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));
  app.route('/bootstrap', bootstrapRoutes);

  if (devRoutes) {
    app.route('/', devRoutes);
  }

  app.route('/auth', authRoutes);

  api.use('*', authMiddleware);
  api.use('*', syncUserMiddleware);

  api.route('/users', userRoutes);
  api.route('/users', userManagedSpacesRoutes);
  api.route('/spaces', spaceRoutes);
  api.route('/spaces', spaceManagerRoutes);
  api.route('/equipment', equipmentRoutes);
  api.route('/reservations', reservationRoutes);
  api.route('/blockings', blockingRoutes);
  api.route('/notifications', notificationRoutes);
  api.route('/logs', logRoutes);
  api.route('/stats', statsRoutes);

  app.route('/api/v1', api);

  app.get('/admin/login', (c) => c.html(renderAdminLogin()));

  admin.use('*', authMiddleware);
  admin.use('*', syncUserMiddleware);
  admin.use('*', requireMasterAdmin());
  admin.route('/', adminRoutes);

  app.route('/admin', admin);

  return app;
}
