import { z } from 'zod';

export const uuidSchema = z.string().uuid();

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const userRoleSchema = z.enum(['student', 'professor', 'staff', 'maintenance']);

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format');

export const futureDateSchema = dateSchema.refine(
  (d) => new Date(d) >= new Date(new Date().toISOString().split('T')[0]),
  'Date cannot be in the past'
);

export const hourlyTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):00$/, 'Time must be on the hour in HH:00 format');

export const boundaryTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-4]):00$/, 'Time must be on the hour in HH:00 format');
