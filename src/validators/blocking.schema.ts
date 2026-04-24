import { z } from 'zod';
import { uuidSchema, futureDateSchema, hourlyTimeSchema, boundaryTimeSchema } from './common.schema';

export const blockTypeSchema = z.enum(['maintenance', 'administrative']);

export const createBlockingSchema = z
  .object({
    spaceId: uuidSchema,
    date: futureDateSchema,
    startTime: hourlyTimeSchema,
    endTime: boundaryTimeSchema,
    reason: z.string().max(500).optional().default(''),
    blockType: blockTypeSchema,
  })
  .refine((data) => data.startTime < data.endTime, {
    message: 'O horário de término deve ser posterior ao horário de início',
    path: ['endTime'],
  });
