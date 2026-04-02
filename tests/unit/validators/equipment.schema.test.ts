import { describe, expect, it } from 'vitest';
import { createEquipmentSchema } from '@/validators/equipment.schema';

describe('createEquipmentSchema', () => {
  it('accepts a valid 10-digit university asset ID', () => {
    const result = createEquipmentSchema.safeParse({
      assetId: '2020002658',
      spaceId: '11111111-1111-4111-8111-111111111111',
      name: 'Projetor Epson PowerLite',
      type: 'projector',
      status: 'working',
    });

    expect(result.success).toBe(true);
  });

  it('rejects asset IDs that are not exactly 10 digits', () => {
    const result = createEquipmentSchema.safeParse({
      assetId: 'EQ-2020-02658',
      spaceId: '11111111-1111-4111-8111-111111111111',
      name: 'Projetor Epson PowerLite',
      type: 'projector',
      status: 'working',
    });

    expect(result.success).toBe(false);
  });
});
