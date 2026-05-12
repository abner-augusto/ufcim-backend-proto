import { z } from 'zod';
import { dateSchema, uuidSchema } from './common.schema';

export const occupancyQuerySchema = z.object({
  startDate: dateSchema,
  endDate: dateSchema,
  campus: z.string().min(1).optional(),
  department: z.string().min(1).optional(),
  spaceId: uuidSchema.optional(),
  groupBy: z.enum(['day', 'week', 'month']).default('day'),
}).refine((data) => new Date(data.endDate) >= new Date(data.startDate), {
  message: 'endDate deve ser maior ou igual a startDate',
  path: ['endDate'],
});
