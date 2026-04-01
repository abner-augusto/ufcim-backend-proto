import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env } from '@/types/env';
import type { JwtPayload } from '@/types/auth';
import { authMiddleware } from '@/middleware/auth';
import { globalErrorHandler } from '@/middleware/error-handler';

// Route stubs — replaced with real implementations in Phase 5
const userRoutes = new Hono();
const spaceRoutes = new Hono();
const equipmentRoutes = new Hono();
const reservationRoutes = new Hono();
const blockingRoutes = new Hono();
const notificationRoutes = new Hono();
const logRoutes = new Hono();

type AppVariables = { user: JwtPayload };

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// ── Global middleware ────────────────────────────────────────────────────────
app.use('*', cors());
app.use('*', logger());
app.onError(globalErrorHandler);

// ── Health check (unauthenticated) ───────────────────────────────────────────
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── Authenticated API routes ─────────────────────────────────────────────────
const api = new Hono<{ Bindings: Env; Variables: AppVariables }>();
api.use('*', authMiddleware);

api.route('/users', userRoutes);
api.route('/spaces', spaceRoutes);
api.route('/equipment', equipmentRoutes);
api.route('/reservations', reservationRoutes);
api.route('/blockings', blockingRoutes);
api.route('/notifications', notificationRoutes);
api.route('/logs', logRoutes);

app.route('/api/v1', api);

export { app };
