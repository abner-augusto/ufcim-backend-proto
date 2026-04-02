import { z } from 'zod';
import { uuidSchema, futureDateSchema, hourlyTimeSchema, boundaryTimeSchema } from './common.schema';

export const blockTypeSchema = z.enum(['maintenance', 'administrative']);

export const createBlockingSchema = z
  .object({
    spaceId: uuidSchema,
    date: futureDateSchema,
    startTime: hourlyTimeSchema,
    endTime: boundaryTimeSchema,
    reason: z.string().min(1).max(500),
    blockType: blockTypeSchema,
  })
  .refine((data) => data.startTime < data.endTime, {
    message: 'End time must be after start time',
    path: ['endTime'],
  });
