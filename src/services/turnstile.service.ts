import type { Env } from '@/types/env';

const SITEVERIFY_ENDPOINT = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Verifies a Cloudflare Turnstile token server-side.
 *
 * When TURNSTILE_SECRET_KEY is unset (e.g. local dev), verification is skipped
 * and returns `true` so the flow keeps working. In any deployed environment the
 * secret must be set for the captcha to actually be enforced.
 */
export class TurnstileService {
  constructor(private env: Env) {}

  get isEnabled(): boolean {
    return Boolean(this.env.TURNSTILE_SECRET_KEY);
  }

  async verify(token: string | undefined, remoteIp?: string): Promise<boolean> {
    if (!this.env.TURNSTILE_SECRET_KEY) return true; // not configured → skip
    if (!token) return false;

    try {
      const form = new FormData();
      form.append('secret', this.env.TURNSTILE_SECRET_KEY);
      form.append('response', token);
      if (remoteIp) form.append('remoteip', remoteIp);

      const res = await fetch(SITEVERIFY_ENDPOINT, { method: 'POST', body: form });
      if (!res.ok) return false;
      const data = (await res.json()) as { success: boolean };
      return data.success === true;
    } catch {
      return false;
    }
  }
}
