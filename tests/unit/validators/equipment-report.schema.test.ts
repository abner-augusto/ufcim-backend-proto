import { describe, expect, it } from 'vitest';
import {
  MAINTENANCE_CATEGORIES,
  createEquipmentReportSchema,
  createMaintenanceTicketSchema,
} from '@/validators/equipment-report.schema';

const SPACE_ID = '11111111-1111-4111-8111-111111111111';
const EQUIPMENT_ID = '22222222-2222-4222-8222-222222222222';

describe('MAINTENANCE_CATEGORIES (MEL-026)', () => {
  it('is the fixed list of room service categories, without cleaning', () => {
    expect(MAINTENANCE_CATEGORIES).toEqual([
      'lighting',
      'electrical',
      'painting',
      'ceiling',
      'doors_windows',
      'plumbing',
      'furniture',
      'other',
    ]);
  });
});

describe('createEquipmentReportSchema (per-equipment route, unchanged)', () => {
  it('still requires a description of at least 5 characters', () => {
    expect(createEquipmentReportSchema.safeParse({ description: 'abc', severity: 'minor' }).success).toBe(false);
    expect(createEquipmentReportSchema.safeParse({ description: 'Não liga', severity: 'minor' }).success).toBe(true);
  });
});

describe('createMaintenanceTicketSchema (MEL-026)', () => {
  it('accepts an equipment ticket', () => {
    const result = createMaintenanceTicketSchema.safeParse({
      equipmentId: EQUIPMENT_ID,
      description: 'Projetor não liga',
      severity: 'major',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a room ticket with space and category', () => {
    const result = createMaintenanceTicketSchema.safeParse({
      spaceId: SPACE_ID,
      category: 'lighting',
      description: 'Duas lâmpadas queimadas',
      severity: 'minor',
    });
    expect(result.success).toBe(true);
  });

  it('lets a room ticket with a fixed category omit the description', () => {
    const result = createMaintenanceTicketSchema.safeParse({
      spaceId: SPACE_ID,
      category: 'painting',
      severity: 'minor',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.description).toBe('');
  });

  it('rejects a ticket with both an equipment and a room target', () => {
    const result = createMaintenanceTicketSchema.safeParse({
      equipmentId: EQUIPMENT_ID,
      spaceId: SPACE_ID,
      category: 'lighting',
      description: 'Projetor não liga',
      severity: 'major',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an equipment ticket that also carries a category', () => {
    const result = createMaintenanceTicketSchema.safeParse({
      equipmentId: EQUIPMENT_ID,
      category: 'electrical',
      description: 'Projetor não liga',
      severity: 'major',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a ticket with no target at all', () => {
    const result = createMaintenanceTicketSchema.safeParse({
      description: 'Algo quebrado',
      severity: 'minor',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a room ticket without a category', () => {
    const result = createMaintenanceTicketSchema.safeParse({
      spaceId: SPACE_ID,
      description: 'Algo quebrado',
      severity: 'minor',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a category without a space', () => {
    const result = createMaintenanceTicketSchema.safeParse({
      category: 'plumbing',
      description: 'Pia vazando',
      severity: 'minor',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown category, including cleaning', () => {
    const result = createMaintenanceTicketSchema.safeParse({
      spaceId: SPACE_ID,
      category: 'cleaning',
      description: 'Sala suja',
      severity: 'minor',
    });
    expect(result.success).toBe(false);
  });

  it('requires a description for "other"', () => {
    const missing = createMaintenanceTicketSchema.safeParse({
      spaceId: SPACE_ID,
      category: 'other',
      severity: 'minor',
    });
    const blank = createMaintenanceTicketSchema.safeParse({
      spaceId: SPACE_ID,
      category: 'other',
      description: '   ',
      severity: 'minor',
    });
    const ok = createMaintenanceTicketSchema.safeParse({
      spaceId: SPACE_ID,
      category: 'other',
      description: 'Cortina rasgada',
      severity: 'minor',
    });

    expect(missing.success).toBe(false);
    expect(blank.success).toBe(false);
    if (!missing.success) expect(missing.error.issues[0].path).toEqual(['description']);
    expect(ok.success).toBe(true);
  });

  it('keeps the equipment ticket description rule (at least 5 characters)', () => {
    const result = createMaintenanceTicketSchema.safeParse({
      equipmentId: EQUIPMENT_ID,
      description: 'abc',
      severity: 'major',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown severity', () => {
    const result = createMaintenanceTicketSchema.safeParse({
      spaceId: SPACE_ID,
      category: 'ceiling',
      severity: 'urgent',
    });
    expect(result.success).toBe(false);
  });
});
