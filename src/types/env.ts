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
  ENVIRONMENT: 'development' | 'staging' | 'production';
};

export type AppVariables = {
  user: JwtPayload;
  validatedBody: unknown;
  validatedQuery: unknown;
};

/** Shorthand for the Hono generic used in every route file. */
export type AppEnv = { Bindings: Env; Variables: AppVariables };
