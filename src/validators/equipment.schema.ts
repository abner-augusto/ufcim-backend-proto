import { z } from 'zod';

export const equipmentStatusSchema = z.enum([
  'working',
  'broken',
  'under_repair',
  'replacement_scheduled',
]);

export const equipmentAssetIdSchema = z
  .string()
  .regex(/^\d{10}$/, 'O ID patrimonial do equipamento deve ter exatamente 10 dígitos');

export const createEquipmentSchema = z.object({
  assetId: equipmentAssetIdSchema,
  spaceId: z.string().min(1, 'ID do espaço é obrigatório'),
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(100),
  status: equipmentStatusSchema,
  notes: z.string().optional(),
});

export const updateEquipmentStatusSchema = z.object({
  assetId: equipmentAssetIdSchema.optional(),
  status: equipmentStatusSchema,
  notes: z.string().optional(),
});
