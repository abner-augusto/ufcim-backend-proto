import { z } from 'zod';
import { uuidSchema, timeSlotSchema, futureDateSchema } from './common.schema';

export const createReservationSchema = z.object({
  spaceId: uuidSchema,
  date: futureDateSchema,
  timeSlot: timeSlotSchema,
});

export const createRecurringReservationSchema = z
  .object({
    spaceId: uuidSchema,
    startDate: futureDateSchema,
    endDate: futureDateSchema,
    dayOfWeek: z.number().int().min(0).max(6), // 0 = Sunday
    timeSlot: timeSlotSchema,
    description: z.string().min(1).max(200),
  })
  .refine((d) => new Date(d.endDate) > new Date(d.startDate), {
    message: 'End date must be after start date',
    path: ['endDate'],
  });

export const updateReservationSchema = z.object({
  date: futureDateSchema.optional(),
  timeSlot: timeSlotSchema.optional(),
  status: z.enum(['confirmed', 'canceled', 'modified']).optional(),
});
