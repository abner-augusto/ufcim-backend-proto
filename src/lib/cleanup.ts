import type { Env } from '@/types/env';

/**
 * Nightly cleanup for auth-related tables that accumulate without bound:
 * - rate_limit_buckets: 1-hour buffer past window end.
 * - refresh_tokens: 7-day grace past expiration (keeps recent revocations
 *   queryable for audit).
 * - invitations: 30-day grace past expiration, but only if the invitation
 *   reached a terminal state (accepted or revoked). Pending-but-expired
 *   invitations are kept indefinitely for audit; in practice they're tiny.
 */
export async function runNightlyCleanup(env: Env): Promise<void> {
  const now = Date.now();

  const rlCutoff = new Date(now - 60 * 60 * 1000).toISOString();
  const rl = await env.DB.prepare(
    `DELETE FROM rate_limit_buckets WHERE window_start < ?`
  ).bind(rlCutoff).run();

  const tokCutoff = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const tok = await env.DB.prepare(
    `DELETE FROM refresh_tokens WHERE expires_at < ?`
  ).bind(tokCutoff).run();

  const invCutoff = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const inv = await env.DB.prepare(
    `DELETE FROM invitations
     WHERE expires_at < ?
       AND (accepted_at IS NOT NULL OR revoked_at IS NOT NULL)`
  ).bind(invCutoff).run();

  console.log(JSON.stringify({
    msg: 'nightly_cleanup',
    rate_limit_deleted: rl.meta?.changes ?? 0,
    refresh_tokens_deleted: tok.meta?.changes ?? 0,
    invitations_deleted: inv.meta?.changes ?? 0,
  }));
}
