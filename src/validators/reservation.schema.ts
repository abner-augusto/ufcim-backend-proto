import { z } from 'zod';
import { futureDateSchema, slotStartTimeSchema, slotEndTimeSchema } from './common.schema';
import { meetsMinimumDuration } from '@/lib/schedule';

const END_AFTER_START_MESSAGE = 'O horário de término deve ser posterior ao horário de início';
const MIN_DURATION_MESSAGE = 'A reserva deve durar pelo menos 1 hora';

/**
 * Optional requester (MEL-025): staff registering on someone's behalf send a
 * registered user (`requesterUserId`) or a free-text name, never both, plus an
 * optional contact. Only staff may send any of them; the service returns 403
 * otherwise and 400 for an unknown or inactive user.
 */
const requesterFields = {
  requesterUserId: z.string().trim().min(1).max(64).optional(),
  requesterName: z.string().trim().min(1, 'Informe o nome do solicitante').max(100).optional(),
  requesterContact: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((value) => value || undefined),
};

type RequesterFields = { requesterUserId?: string; requesterName?: string; requesterContact?: string };

const ONE_REQUESTER_MESSAGE = 'Informe um usuário cadastrado ou um nome, não os dois';
const CONTACT_NEEDS_REQUESTER_MESSAGE = 'Informe o solicitante para registrar o contato';
const hasOneRequester = (d: RequesterFields) => !(d.requesterUserId && d.requesterName);
const contactHasRequester = (d: RequesterFields) => !d.requesterContact || !!(d.requesterUserId || d.requesterName);

export const createReservationSchema = z
  .object({
    spaceId: z.string().min(1, 'ID do espaço é obrigatório'),
    date: futureDateSchema,
    startTime: slotStartTimeSchema,
    endTime: slotEndTimeSchema,
    purpose: z.string().max(100).optional(),
    description: z.string().trim().max(100).optional(),
    ...requesterFields,
  })
  .refine(hasOneRequester, { message: ONE_REQUESTER_MESSAGE, path: ['requesterName'] })
  .refine(contactHasRequester, { message: CONTACT_NEEDS_REQUESTER_MESSAGE, path: ['requesterContact'] })
  .refine((data) => data.startTime < data.endTime, {
    message: END_AFTER_START_MESSAGE,
    path: ['endTime'],
  })
  .refine((data) => meetsMinimumDuration(data.startTime, data.endTime), {
    message: MIN_DURATION_MESSAGE,
    path: ['endTime'],
  });

const weekdaySchema = z.number().int().min(0).max(6); // 0 = Sunday
export const MAX_RECURRING_WEEKDAYS = 3;

/**
 * A series repeats on up to 3 weekdays (`daysOfWeek`). `dayOfWeek` is the
 * single-day field older clients still send; exactly one of the two is
 * required, and the parsed body always carries `daysOfWeek`, sorted and unique.
 */
export const createRecurringReservationSchema = z
  .object({
    spaceId: z.string().min(1, 'ID do espaço é obrigatório'),
    startDate: futureDateSchema,
    endDate: futureDateSchema,
    daysOfWeek: z
      .array(weekdaySchema)
      .min(1, 'Selecione ao menos um dia da semana')
      .refine((days) => new Set(days).size <= MAX_RECURRING_WEEKDAYS, {
        message: `Selecione no máximo ${MAX_RECURRING_WEEKDAYS} dias da semana`,
      })
      .optional(),
    dayOfWeek: weekdaySchema.optional(),
    startTime: slotStartTimeSchema,
    endTime: slotEndTimeSchema,
    description: z.string().trim().max(100).optional(),
    purpose: z.string().max(100).optional(),
    ...requesterFields,
  })
  .refine(hasOneRequester, { message: ONE_REQUESTER_MESSAGE, path: ['requesterName'] })
  .refine(contactHasRequester, { message: CONTACT_NEEDS_REQUESTER_MESSAGE, path: ['requesterContact'] })
  .refine((d) => (d.daysOfWeek === undefined) !== (d.dayOfWeek === undefined), {
    message: 'Selecione ao menos um dia da semana',
    path: ['daysOfWeek'],
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
  })
  .transform(({ dayOfWeek, daysOfWeek, ...rest }) => ({
    ...rest,
    daysOfWeek: [...new Set(daysOfWeek ?? [dayOfWeek!])].sort((a, b) => a - b),
  }));

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
