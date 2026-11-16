import { z } from 'zod';
import { dateSchema, paginationSchema } from './common.schema';

export const departmentAuditLogQuerySchema = paginationSchema.extend({
  userId: z.string().trim().min(1).optional(),
  actionType: z.string().trim().min(1).optional(),
  referenceType: z.enum(['reservation', 'blocking']).optional(),
  dateFrom: dateSchema.optional(),
  dateTo: dateSchema.optional(),
});

export type DepartmentAuditLogQuery = z.infer<typeof departmentAuditLogQuerySchema>;
