import { z } from 'zod';
import { futureDateSchema, hourlyTimeSchema, boundaryTimeSchema } from './common.schema';

export const blockTypeSchema = z.enum(['maintenance', 'administrative']);

export const createBlockingSchema = z
  .object({
    spaceId: z.string().min(1, 'ID do espaço é obrigatório'),
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
