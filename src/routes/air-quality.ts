import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '@/types/env';
import { validateQuery } from '@/middleware/validation';
import { rbac } from '@/middleware/rbac';
import {
  getSpaceAirQuality,
  getSpaceAirQualityHistory,
  HISTORY_MAX_SPAN_MS,
} from '@/services/air-quality.service';

export const airQualityRoutes = new Hono<AppEnv>();

const historyQuerySchema = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    bucket: z.enum(['minute', 'hour']).default('hour'),
  })
  .transform((q) => ({ ...q, from: new Date(q.from).toISOString(), to: new Date(q.to).toISOString() }))
  .refine((q) => q.to > q.from, { message: 'to deve ser posterior a from', path: ['to'] })
  .refine((q) => new Date(q.to).getTime() - new Date(q.from).getTime() <= HISTORY_MAX_SPAN_MS[q.bucket], {
    message: 'Intervalo longo demais: até 2 dias por minuto ou 90 dias por hora',
    path: ['from'],
  });

// GET /spaces/:spaceId/air-quality — the room's device and latest reading.
// Any authenticated role. A room without a device answers 200 with nulls.
airQualityRoutes.get('/:spaceId/air-quality', async (c) => {
  const result = await getSpaceAirQuality(c.env.DB, c.req.param('spaceId'));
  return c.json(result);
});

// GET /spaces/:spaceId/air-quality/history — averaged readings for the room
// report. Same roles as the space report.
airQualityRoutes.get(
  '/:spaceId/air-quality/history',
  rbac(['professor', 'staff', 'maintenance']),
  validateQuery(historyQuerySchema),
  async (c) => {
    const query = c.get('validatedQuery') as z.infer<typeof historyQuerySchema>;
    const result = await getSpaceAirQualityHistory(c.env.DB, c.req.param('spaceId'), query);
    return c.json(result);
  }
);
