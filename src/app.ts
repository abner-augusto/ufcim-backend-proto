import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env, AppVariables } from '@/types/env';
import { authMiddleware } from '@/middleware/auth';
import { globalErrorHandler } from '@/middleware/error-handler';
import { createDb } from '@/db/client';
import { UserService } from '@/services/user.service';
import { DEV_JWKS } from '@/dev/test-jwks';
import { userRoutes } from '@/routes/users';
import { spaceRoutes } from '@/routes/spaces';
import { equipmentRoutes } from '@/routes/equipment';
import { reservationRoutes } from '@/routes/reservations';
import { blockingRoutes } from '@/routes/blockings';
import { notificationRoutes } from '@/routes/notifications';
import { logRoutes } from '@/routes/logs';
import { statsRoutes } from '@/routes/stats';
import { adminRoutes } from '@/routes/admin';
import { rbac } from '@/middleware/rbac';

type AppEnv = { Bindings: Env; Variables: AppVariables };

const app = new Hono<AppEnv>();

// ── Global middleware ────────────────────────────────────────────────────────
app.use('*', cors());
app.use('*', logger());
app.onError(globalErrorHandler);

// ── Health check (unauthenticated) ───────────────────────────────────────────
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── Dev-only: serve test JWKS so local JWT verification works without Keycloak ──
// Point JWKS_URL=http://localhost:8787/dev/jwks in .dev.vars to use this.
app.get('/dev/jwks', (c) => c.json(DEV_JWKS));

// ── Authenticated API routes ─────────────────────────────────────────────────
const api = new Hono<AppEnv>();
const admin = new Hono<AppEnv>();

const syncUserMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const db = createDb(c.env.DB);
  const userService = new UserService(db);
  await userService.syncFromToken(c.get('user'));
  await next();
});

// 1. Verify JWT and set c.get('user')
api.use('*', authMiddleware);

// 2. Upsert user from JWT claims on every request (idempotent, keeps DB in sync)
api.use('*', syncUserMiddleware);

api.route('/users', userRoutes);
api.route('/spaces', spaceRoutes);
api.route('/equipment', equipmentRoutes);
api.route('/reservations', reservationRoutes);
api.route('/blockings', blockingRoutes);
api.route('/notifications', notificationRoutes);
api.route('/logs', logRoutes);
api.route('/stats', statsRoutes);

app.route('/api/v1', api);

admin.use('*', authMiddleware);
admin.use('*', syncUserMiddleware);
admin.use('*', rbac(['staff']));
admin.route('/', adminRoutes);

app.route('/admin', admin);

export { app };
