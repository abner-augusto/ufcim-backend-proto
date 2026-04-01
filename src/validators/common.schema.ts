import { z } from 'zod';

export const uuidSchema = z.string().uuid();

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const timeSlotSchema = z.enum(['morning', 'afternoon', 'evening']);

export const userRoleSchema = z.enum(['student', 'professor', 'staff', 'maintenance']);

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format');

export const futureDateSchema = dateSchema.refine(
  (d) => new Date(d) >= new Date(new Date().toISOString().split('T')[0]),
  'Date cannot be in the past'
);
