import { z } from 'zod';
import { futureDateSchema, hourlyTimeSchema, boundaryTimeSchema } from './common.schema';
import { datesBetween } from '@/lib/schedule';

export const blockTypeSchema = z.enum(['maintenance', 'administrative']);

/** Maximum span (inclusive, in days) accepted by a single multi-day blocking operation. */
export const MAX_BLOCKING_RANGE_DAYS = 60;

export const createBlockingSchema = z
  .object({
    spaceId: z.string().min(1, 'ID do espaço é obrigatório'),
    /** Single-day form (compat). Mutually exclusive with `dateFrom`/`dateTo`. */
    date: futureDateSchema.optional(),
    dateFrom: futureDateSchema.optional(),
    dateTo: futureDateSchema.optional(),
    startTime: hourlyTimeSchema,
    endTime: boundaryTimeSchema,
    reason: z.string().max(500).optional().default(''),
    blockType: blockTypeSchema,
  })
  .refine((data) => data.startTime < data.endTime, {
    message: 'O horário de término deve ser posterior ao horário de início',
    path: ['endTime'],
  })
  .refine(
    (data) => (data.date ? !data.dateFrom && !data.dateTo : Boolean(data.dateFrom && data.dateTo)),
    {
      message: 'Informe uma data única (date) ou um intervalo (dateFrom e dateTo)',
      path: ['dateFrom'],
    }
  )
  .refine((data) => !data.dateFrom || !data.dateTo || data.dateFrom <= data.dateTo, {
    message: 'A data inicial deve ser anterior ou igual à data final',
    path: ['dateTo'],
  })
  .refine(
    (data) =>
      !data.dateFrom ||
      !data.dateTo ||
      datesBetween(data.dateFrom, data.dateTo).length <= MAX_BLOCKING_RANGE_DAYS,
    {
      message: `O intervalo não pode passar de ${MAX_BLOCKING_RANGE_DAYS} dias`,
      path: ['dateTo'],
    }
  );
