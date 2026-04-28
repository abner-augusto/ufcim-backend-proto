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
import { departmentRoutes } from '@/routes/departments';
import { adminRoutes } from '@/routes/admin';
import { authRoutes } from '@/routes/auth';
import { bootstrapRoutes } from '@/routes/bootstrap';
import { rbac, requireMasterAdmin } from '@/middleware/rbac';
import { renderAdminLogin } from '@/admin/admin-login';
import { renderAdminShell } from '@/admin/admin-shell';

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

function ensureProductionVarsSet(env: Env) {
  if (env.ENVIRONMENT !== 'production') return;
  const required = ['JWT_ISSUER', 'JWT_SIGNING_SECRET', 'INVITE_BASE_URL'];
  const missing = required.filter((k) => !env[k as keyof Env]);
  if (missing.length > 0) {
    throw new Error(
      `Variáveis de ambiente obrigatórias ausentes em produção: ${missing.join(', ')}`
    );
  }
}

export function createApp({ authMiddleware, devRoutes }: CreateAppOptions) {
  const app = new Hono<AppEnv>();
  const api = new Hono<AppEnv>();
  const admin = new Hono<AppEnv>();

  let configChecked = false;
  app.use('*', async (c, next) => {
    if (!configChecked) {
      ensureProductionVarsSet(c.env);
      configChecked = true;
    }
    return next();
  });

  // TODO: replace PROD_ORIGINS with the real Pages URL once deployed.
  const PROD_ORIGINS = ['https://ufcim.pages.dev'];
  const DEV_ORIGINS = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:8787',
    'http://127.0.0.1:8787',
  ];
  app.use('*', async (c, next) => {
    const origins = c.env.ENVIRONMENT === 'production' ? PROD_ORIGINS : DEV_ORIGINS;
    const middleware = cors({
      origin: origins,
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Bootstrap-Token'],
      exposeHeaders: [],
      credentials: false,
      maxAge: 86400,
    });
    return middleware(c, next);
  });
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
  api.route('/departments', departmentRoutes);

  app.route('/api/v1', api);

  app.get('/admin/login', (c) => c.html(renderAdminLogin()));

  // Shell pages are pure HTML skeletons — auth happens via HTMX Bearer headers on partials.
  const adminPages = ['/admin', '/admin/spaces', '/admin/reservations', '/admin/blockings', '/admin/equipment', '/admin/users', '/admin/invitations', '/admin/departments', '/admin/logs'] as const;
  for (const path of adminPages) {
    app.get(path, (c) => c.html(renderAdminShell(path, c.env.ENVIRONMENT)));
  }

  admin.use('*', authMiddleware);
  admin.use('*', syncUserMiddleware);
  admin.use('*', requireMasterAdmin());
  admin.route('/', adminRoutes);

  app.route('/admin', admin);

  return app;
}
