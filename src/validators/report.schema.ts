import { z } from 'zod';
import { dateSchema } from './common.schema';
import { equipmentStatusSchema } from './equipment.schema';

/** MEL-013: optional window; the service defaults it and enforces the 90-day cap. */
export const maintenanceRangeQuerySchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});

export const maintenanceEquipmentQuerySchema = maintenanceRangeQuerySchema.extend({
  spaceId: z.string().min(1).optional(),
  departmentId: z.string().min(1).optional(),
  equipmentId: z.string().min(1).optional(),
  status: equipmentStatusSchema.optional(),
  severity: z.enum(['minor', 'major', 'blocking']).optional(),
});

export const occupancyQuerySchema = z.object({
  startDate: dateSchema,
  endDate: dateSchema,
  campus: z.string().min(1).optional(),
  department: z.string().min(1).optional(),
  spaceId: z.string().optional(),
  groupBy: z.enum(['day', 'week', 'month']).default('day'),
}).refine((data) => new Date(data.endDate) >= new Date(data.startDate), {
  message: 'endDate deve ser maior ou igual a startDate',
  path: ['endDate'],
});
