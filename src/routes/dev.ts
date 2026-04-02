import { Hono } from 'hono';
import type { AppEnv } from '@/types/env';
import { DEV_JWKS } from '@/dev/test-jwks';

export const devRoutes = new Hono<AppEnv>();

devRoutes.get('/dev/jwks', (c) => c.json(DEV_JWKS));
