import { createApp } from './app';
import { devAuthMiddleware } from './middleware/auth-dev';
import { devRoutes } from './routes/dev';
import { runNightlyCleanup } from './lib/cleanup';
import type { Env } from './types/env';

const app = createApp({
  authMiddleware: devAuthMiddleware,
  devRoutes,
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runNightlyCleanup(env));
  },
};
