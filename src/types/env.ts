export type Env = {
  DB: D1Database;
  JWKS_URL: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE?: string;
  ENVIRONMENT: 'development' | 'staging' | 'production';
};
