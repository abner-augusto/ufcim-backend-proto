import { createApp } from './app';
import { localAuthMiddleware } from './middleware/auth-local';
import { runNightlyCleanup } from './lib/cleanup';
import type { Env } from './types/env';

const app = createApp({ authMiddleware: localAuthMiddleware });

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runNightlyCleanup(env));
  },
};
