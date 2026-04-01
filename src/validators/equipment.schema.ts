import { z } from 'zod';
import { uuidSchema } from './common.schema';

export const equipmentStatusSchema = z.enum([
  'working',
  'broken',
  'under_repair',
  'replacement_scheduled',
]);

export const createEquipmentSchema = z.object({
  spaceId: uuidSchema,
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(100),
  status: equipmentStatusSchema,
  notes: z.string().optional(),
});

export const updateEquipmentStatusSchema = z.object({
  status: equipmentStatusSchema,
  notes: z.string().optional(),
});
