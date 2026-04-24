import { z } from 'zod';

export const uuidSchema = z.string().uuid({ message: 'ID inválido' });

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const userRoleSchema = z.enum(['student', 'professor', 'staff', 'maintenance']);

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'A data deve estar no formato AAAA-MM-DD');

export const futureDateSchema = dateSchema.refine(
  (d) => new Date(d) >= new Date(new Date().toISOString().split('T')[0]),
  'A data não pode ser no passado'
);

export const hourlyTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):00$/, 'O horário deve ser uma hora cheia no formato HH:00 (ex: 14:00)');

export const boundaryTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-4]):00$/, 'O horário deve ser uma hora cheia no formato HH:00 (ex: 14:00)');
