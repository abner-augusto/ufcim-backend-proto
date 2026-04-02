import { z } from 'zod';
import { uuidSchema, futureDateSchema, hourlyTimeSchema, boundaryTimeSchema } from './common.schema';

export const createReservationSchema = z
  .object({
    spaceId: uuidSchema,
    date: futureDateSchema,
    startTime: hourlyTimeSchema,
    endTime: boundaryTimeSchema,
  })
  .refine((data) => data.startTime < data.endTime, {
    message: 'End time must be after start time',
    path: ['endTime'],
  });

export const createRecurringReservationSchema = z
  .object({
    spaceId: uuidSchema,
    startDate: futureDateSchema,
    endDate: futureDateSchema,
    dayOfWeek: z.number().int().min(0).max(6), // 0 = Sunday
    startTime: hourlyTimeSchema,
    endTime: boundaryTimeSchema,
    description: z.string().min(1).max(200),
  })
  .refine((d) => new Date(d.endDate) > new Date(d.startDate), {
    message: 'End date must be after start date',
    path: ['endDate'],
  })
  .refine((d) => d.startTime < d.endTime, {
    message: 'End time must be after start time',
    path: ['endTime'],
  });

export const updateReservationSchema = z.object({
  date: futureDateSchema.optional(),
  startTime: hourlyTimeSchema.optional(),
  endTime: boundaryTimeSchema.optional(),
  status: z.enum(['confirmed', 'canceled', 'modified']).optional(),
}).refine((data) => {
  if (!data.startTime || !data.endTime) return true;
  return data.startTime < data.endTime;
}, {
  message: 'End time must be after start time',
  path: ['endTime'],
});
