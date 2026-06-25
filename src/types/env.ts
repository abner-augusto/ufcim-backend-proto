import type { JwtPayload } from './auth';

export type Env = {
  DB: D1Database;
  JWKS_URL: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE?: string;
  JWT_SIGNING_SECRET: string;
  INVITE_BASE_URL: string;
  ADMIN_BASE_URL: string;
  BOOTSTRAP_TOKEN?: string;
  /** Resend API key. When unset, invitation e-mails are skipped (link still generated). */
  RESEND_API_KEY?: string;
  /** From header for outbound e-mail, e.g. "UFCIM <noreply@ufcim.integrarte.arq.br>". */
  EMAIL_FROM?: string;
  /** Comma-separated allow-list of e-mail domains for invitations. Supports `*.base` wildcards that match the apex and any subdomain (e.g. "*.ufc.br,teste.com"). Empty/unset = no restriction. */
  ALLOWED_EMAIL_DOMAINS?: string;
  /** Cloudflare Turnstile secret. When unset, the captcha check is skipped (dev). */
  TURNSTILE_SECRET_KEY?: string;
  /** Telegram bot token (from @BotFather). When unset (with TELEGRAM_CHAT_ID), invite-request notifications are skipped. */
  TELEGRAM_BOT_TOKEN?: string;
  /** Telegram chat/group id that receives invite-request notifications. */
  TELEGRAM_CHAT_ID?: string;
  ENVIRONMENT: 'development' | 'staging' | 'production';
};

export type AppVariables = {
  user: JwtPayload;
  validatedBody: unknown;
  validatedQuery: unknown;
};

/** Shorthand for the Hono generic used in every route file. */
export type AppEnv = { Bindings: Env; Variables: AppVariables };
