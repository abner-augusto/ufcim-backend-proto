import { z } from 'zod';
import { uuidSchema, timeSlotSchema, futureDateSchema } from './common.schema';

export const blockTypeSchema = z.enum(['maintenance', 'administrative']);

export const createBlockingSchema = z.object({
  spaceId: uuidSchema,
  date: futureDateSchema,
  timeSlot: timeSlotSchema,
  reason: z.string().min(1).max(500),
  blockType: blockTypeSchema,
});
