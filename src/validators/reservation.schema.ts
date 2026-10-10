import { z } from 'zod';
import { futureDateSchema, slotStartTimeSchema, slotEndTimeSchema } from './common.schema';
import { meetsMinimumDuration } from '@/lib/schedule';

const END_AFTER_START_MESSAGE = 'O horário de término deve ser posterior ao horário de início';
const MIN_DURATION_MESSAGE = 'A reserva deve durar pelo menos 1 hora';

export const createReservationSchema = z
  .object({
    spaceId: z.string().min(1, 'ID do espaço é obrigatório'),
    date: futureDateSchema,
    startTime: slotStartTimeSchema,
    endTime: slotEndTimeSchema,
    purpose: z.string().max(100).optional(),
    description: z.string().trim().max(100).optional(),
  })
  .refine((data) => data.startTime < data.endTime, {
    message: END_AFTER_START_MESSAGE,
    path: ['endTime'],
  })
  .refine((data) => meetsMinimumDuration(data.startTime, data.endTime), {
    message: MIN_DURATION_MESSAGE,
    path: ['endTime'],
  });

export const createRecurringReservationSchema = z
  .object({
    spaceId: z.string().min(1, 'ID do espaço é obrigatório'),
    startDate: futureDateSchema,
    endDate: futureDateSchema,
    dayOfWeek: z.number().int().min(0).max(6), // 0 = Sunday
    startTime: slotStartTimeSchema,
    endTime: slotEndTimeSchema,
    description: z.string().trim().max(100).optional(),
    purpose: z.string().max(100).optional(),
  })
  .refine((d) => new Date(d.endDate) > new Date(d.startDate), {
    message: 'A data final deve ser posterior à data inicial',
    path: ['endDate'],
  })
  .refine((d) => d.startTime < d.endTime, {
    message: END_AFTER_START_MESSAGE,
    path: ['endTime'],
  })
  .refine((d) => meetsMinimumDuration(d.startTime, d.endTime), {
    message: MIN_DURATION_MESSAGE,
    path: ['endTime'],
  });

/**
 * PATCH /reservations/:id (MEL-023). The space, status and purpose are not
 * editable; unknown keys are rejected. When only one bound of the range is
 * sent, the service re-checks order and minimum duration against the stored one.
 */
export const updateReservationSchema = z
  .object({
    date: futureDateSchema.optional(),
    startTime: slotStartTimeSchema.optional(),
    endTime: slotEndTimeSchema.optional(),
    description: z.string().trim().max(100).optional(),
  })
  .strict()
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Informe ao menos um campo para alterar',
  })
  .refine((data) => !data.startTime || !data.endTime || data.startTime < data.endTime, {
    message: END_AFTER_START_MESSAGE,
    path: ['endTime'],
  })
  .refine(
    (data) => !data.startTime || !data.endTime || meetsMinimumDuration(data.startTime, data.endTime),
    {
      message: MIN_DURATION_MESSAGE,
      path: ['endTime'],
    }
  );
