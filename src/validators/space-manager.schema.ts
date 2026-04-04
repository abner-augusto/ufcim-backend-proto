import { z } from 'zod';
import { uuidSchema } from './common.schema';

export const assignManagerSchema = z.object({
  spaceId: uuidSchema,
  userId: uuidSchema,
  role: z.enum(['coordinator', 'maintainer']),
});

export const removeManagerSchema = z.object({
  spaceId: uuidSchema,
  userId: uuidSchema,
});
