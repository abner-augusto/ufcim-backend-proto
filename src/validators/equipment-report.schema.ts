import { z } from 'zod';

/** Room service categories for tickets without equipment (MEL-026). */
export const MAINTENANCE_CATEGORIES = [
  'lighting',
  'electrical',
  'painting',
  'ceiling',
  'doors_windows',
  'plumbing',
  'furniture',
  'other',
] as const;
export type MaintenanceCategory = (typeof MAINTENANCE_CATEGORIES)[number];

/** pt-BR labels used in notifications and audit messages. */
export const MAINTENANCE_CATEGORY_LABELS: Record<MaintenanceCategory, string> = {
  lighting: 'Iluminação',
  electrical: 'Tomadas e elétrica',
  painting: 'Pintura',
  ceiling: 'Forro e teto',
  doors_windows: 'Portas e janelas',
  plumbing: 'Hidráulica',
  furniture: 'Mobiliário',
  other: 'Outro',
};

const MIN_DESCRIPTION = 5;
const severitySchema = z.enum(['minor', 'major', 'blocking']);

// POST /equipment/:id/reports — the equipment comes from the path.
export const createEquipmentReportSchema = z.object({
  description: z.string().trim().min(MIN_DESCRIPTION, 'Descrição muito curta').max(500),
  severity: severitySchema,
});

/**
 * POST /equipment/reports — a ticket targets either one equipment
 * (`equipmentId`) or the room itself (`spaceId` + `category`), never both.
 * Equipment tickets keep the 5-character description rule; room tickets may
 * omit it, except for "other", which has nothing else to say what is wrong.
 */
export const createMaintenanceTicketSchema = z
  .object({
    equipmentId: z.string().trim().min(1).optional(),
    spaceId: z.string().trim().min(1).optional(),
    category: z.enum(MAINTENANCE_CATEGORIES).optional(),
    description: z.string().trim().max(500).default(''),
    severity: severitySchema,
  })
  .superRefine((v, ctx) => {
    if (v.equipmentId) {
      if (v.spaceId || v.category) {
        ctx.addIssue({
          code: 'custom',
          path: ['equipmentId'],
          message: 'Informe um equipamento ou uma sala com categoria, não os dois.',
        });
      }
      if (v.description.length < MIN_DESCRIPTION) {
        ctx.addIssue({ code: 'custom', path: ['description'], message: 'Descrição muito curta' });
      }
      return;
    }

    if (!v.spaceId) {
      ctx.addIssue({ code: 'custom', path: ['spaceId'], message: 'Informe o equipamento ou a sala.' });
    }
    if (!v.category) {
      ctx.addIssue({ code: 'custom', path: ['category'], message: 'Escolha a categoria do problema.' });
    }
    if (v.category === 'other' && v.description.length < MIN_DESCRIPTION) {
      ctx.addIssue({ code: 'custom', path: ['description'], message: 'Descreva o problema.' });
    }
  });

export type CreateMaintenanceTicketBody = z.infer<typeof createMaintenanceTicketSchema>;

export const dismissReportSchema = z.object({
  reason: z.string().trim().min(3).max(200),
});
