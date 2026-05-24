import { z } from 'zod';

export const createEquipmentReportSchema = z.object({
  description: z.string().trim().min(5, 'Descrição muito curta').max(500),
  severity: z.enum(['minor', 'major', 'blocking']),
});

export const dismissReportSchema = z.object({
  reason: z.string().trim().min(3).max(200),
});
