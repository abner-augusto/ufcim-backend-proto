import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '@/types/env';

export interface RateLimitOptions {
  /** Bucket namespace, e.g. 'login'. */
  namespace: string;
  /** Maximum requests allowed in the window. */
  max: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/**
 * Per-IP fixed-window rate limiter backed by D1.
 *
 * Atomically upserts a counter per (namespace, ip). When the post-write count
 * exceeds `max` within the current window, returns 429.
 *
 * Note: eventually consistent across regions. Small overshoots possible at
 * the window boundary. Suitable for minute-scale brute-force protection,
 * NOT for second-scale precision rate limiting.
 */
export function rateLimit(opts: RateLimitOptions) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const ip = c.req.header('CF-Connecting-IP')
      ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim()
      ?? 'unknown';

    const key = `${opts.namespace}:${ip}`;
    const nowISO = new Date().toISOString();

    // Single atomic statement:
    // - If no row exists: insert with count=1.
    // - If row exists and the existing window has expired: reset to count=1.
    // - Otherwise: increment count by 1.
    // RETURNING gives us the post-write state.
    const sql = `
      INSERT INTO rate_limit_buckets (key, count, window_start)
      VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET
        count = CASE
          WHEN (CAST(strftime('%s', ?) AS INTEGER) - CAST(strftime('%s', rate_limit_buckets.window_start) AS INTEGER)) >= ?
            THEN 1
          ELSE rate_limit_buckets.count + 1
        END,
        window_start = CASE
          WHEN (CAST(strftime('%s', ?) AS INTEGER) - CAST(strftime('%s', rate_limit_buckets.window_start) AS INTEGER)) >= ?
            THEN excluded.window_start
          ELSE rate_limit_buckets.window_start
        END
      RETURNING count;
    `;

    const result = await c.env.DB.prepare(sql)
      .bind(key, nowISO, nowISO, opts.windowSeconds, nowISO, opts.windowSeconds)
      .first<{ count: number }>();

    const count = result?.count ?? 1;

    if (count > opts.max) {
      c.header('Retry-After', String(opts.windowSeconds));
      return c.json(
        {
          error: 'Muitas tentativas. Aguarde um momento e tente novamente.',
          code: 'RATE_LIMITED',
        },
        429
      );
    }

    return next();
  });
}
