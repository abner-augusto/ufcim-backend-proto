import { describe, it, expect } from 'vitest';
import { departmentReservationQuerySchema } from '@/validators/department-reservation.schema';

describe('departmentReservationQuerySchema', () => {
  it('applies pagination defaults when query is empty', () => {
    const parsed = departmentReservationQuerySchema.parse({});
    expect(parsed).toEqual({ page: 1, limit: 20 });
  });

  it('accepts all valid filters', () => {
    const parsed = departmentReservationQuerySchema.parse({
      spaceId: 'a1a00001-0000-4000-8000-000000000000',
      dateFrom: '2026-05-01',
      dateTo: '2026-05-31',
      status: 'active',
      createdBy: '00000000-0000-0000-0000-000000000003',
      page: '2',
      limit: '50',
    });

    expect(parsed).toEqual({
      spaceId: 'a1a00001-0000-4000-8000-000000000000',
      dateFrom: '2026-05-01',
      dateTo: '2026-05-31',
      status: 'active',
      createdBy: '00000000-0000-0000-0000-000000000003',
      page: 2,
      limit: 50,
    });
  });

  it.each(['active', 'canceled', 'all', 'confirmed', 'modified', 'overridden'] as const)(
    'accepts status %s',
    (status) => {
      expect(departmentReservationQuerySchema.parse({ status }).status).toBe(status);
    }
  );

  it('rejects invalid status, malformed date, empty createdBy, and out-of-range limit', () => {
    expect(departmentReservationQuerySchema.safeParse({ status: 'pending' }).success).toBe(false);
    expect(departmentReservationQuerySchema.safeParse({ dateFrom: '01/05/2026' }).success).toBe(false);
    expect(departmentReservationQuerySchema.safeParse({ dateTo: '2026-5-1' }).success).toBe(false);
    expect(departmentReservationQuerySchema.safeParse({ createdBy: '   ' }).success).toBe(false);
    expect(departmentReservationQuerySchema.safeParse({ spaceId: '' }).success).toBe(false);
    expect(departmentReservationQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(departmentReservationQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });
});
