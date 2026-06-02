import type { Context } from 'hono';
import type { AppEnv } from '@/types/env';

/** Hono context type shared across the admin route handlers and view renderers. */
export type AdminContext = Context<AppEnv>;

/** The authenticated master admin performing the current action. */
export function getActingUserId(c: AdminContext): string {
  return c.get('user').sub;
}
