import { AppError } from '@/middleware/error-handler';
import type { Env } from '@/types/env';

/** Parsed, lowercased allow-list from env. Empty array = no restriction. */
export function parseAllowedDomains(env: Env): string[] {
  return (env.ALLOWED_EMAIL_DOMAINS ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Whether `domain` matches an allow-list entry. A `*.base` entry matches both the
 * apex (`base`) and any subdomain (`*.base`); other entries match exactly.
 */
function domainMatches(domain: string, entry: string): boolean {
  if (entry.startsWith('*.')) {
    const base = entry.slice(2);
    return domain === base || domain.endsWith(`.${base}`);
  }
  return domain === entry;
}

/** Throws 422 when `email`'s domain is not in the configured allow-list. No-op if unset. */
export function assertAllowedDomain(env: Env, email: string): void {
  const allowed = parseAllowedDomains(env);
  if (allowed.length === 0) return; // no restriction configured
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
  if (!allowed.some((entry) => domainMatches(domain, entry))) {
    throw new AppError(
      422,
      `E-mail de domínio "${domain}" não é permitido. Domínios aceitos: ${allowed.join(', ')}.`,
      'EMAIL_DOMAIN_NOT_ALLOWED'
    );
  }
}
