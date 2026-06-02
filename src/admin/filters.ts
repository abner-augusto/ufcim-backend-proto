import { z } from 'zod';
import { paginationSchema } from '@/validators/common.schema';
import { updateEquipmentStatusSchema } from '@/validators/equipment.schema';

// Filter schemas use z.string() (not .uuid()) because Zod v4 enforces strict
// RFC 4122 compliance, which rejects the deterministic seed UUIDs used in dev.
export const reservationFilterSchema = paginationSchema.extend({
  spaceId: z.string().optional(),
  userId: z.string().optional(),
  status: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export const blockingFilterSchema = paginationSchema.extend({
  spaceId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export const logFilterSchema = paginationSchema.extend({
  userId: z.string().optional(),
  actionType: z.string().optional(),
  referenceType: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export const equipmentFormSchema = updateEquipmentStatusSchema.extend({
  page: z.coerce.number().int().positive().default(1).optional(),
});
