import { z } from 'zod';
import { dateSchema, paginationSchema } from './common.schema';

export const departmentReservationStatusFilterSchema = z.enum([
  'active',
  'canceled',
  'all',
  'confirmed',
  'modified',
  'overridden',
]);

export const departmentReservationQuerySchema = paginationSchema.extend({
  spaceId: z.string().trim().min(1).optional(),
  dateFrom: dateSchema.optional(),
  dateTo: dateSchema.optional(),
  status: departmentReservationStatusFilterSchema.optional(),
  createdBy: z.string().trim().min(1).optional(),
});

export type DepartmentReservationQuery = z.infer<typeof departmentReservationQuerySchema>;
