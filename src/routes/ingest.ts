import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '@/types/env';
import { validate } from '@/middleware/validation';
import { rateLimit } from '@/middleware/rate-limit';
import { UnauthorizedError } from '@/middleware/error-handler';
import { findCollectorByToken, ingestSamples } from '@/services/air-quality.service';
import { ingestSamplesSchema, type IngestSamplesBody } from '@/validators/ingest.schema';

/**
 * Machine-to-machine ingestion (ADR 0002). Mounted outside /api/v1, which
 * requires a user JWT: a collector authenticates with its own bearer token,
 * stored in D1 only as a SHA-256 hash.
 */
export const ingestRoutes = new Hono<AppEnv>();

const collectorAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  const collector = token ? await findCollectorByToken(c.env.DB, token) : null;
  if (!collector) throw new UnauthorizedError('Token de coletor inválido');
  c.set('collector', collector);
  await next();
});

// POST /ingest/v1/samples — one batch of minute samples plus device status.
ingestRoutes.post(
  '/samples',
  rateLimit({ namespace: 'ingest', max: 30, windowSeconds: 60 }),
  collectorAuth,
  validate(ingestSamplesSchema),
  async (c) => {
    const body = c.get('validatedBody') as IngestSamplesBody;
    const result = await ingestSamples(c.env.DB, c.get('collector'), body);
    return c.json(result);
  }
);
