import { describe, it, expect } from 'vitest';
import { departmentAuditLogQuerySchema } from '@/validators/department-audit-log.schema';

describe('departmentAuditLogQuerySchema', () => {
  it('applies pagination defaults and optional filters', () => {
    const parsed = departmentAuditLogQuerySchema.parse({});
    expect(parsed).toEqual({ page: 1, limit: 20 });
  });

  it('accepts valid filters', () => {
    const parsed = departmentAuditLogQuerySchema.parse({
      userId: 'staff-1',
      actionType: 'create_blocking',
      referenceType: 'blocking',
      dateFrom: '2026-05-01',
      dateTo: '2026-05-31',
      page: '2',
      limit: '15',
    });
    expect(parsed).toEqual({
      userId: 'staff-1',
      actionType: 'create_blocking',
      referenceType: 'blocking',
      dateFrom: '2026-05-01',
      dateTo: '2026-05-31',
      page: 2,
      limit: 15,
    });
  });

  it('rejects non-reservation/blocking referenceType and malformed dates', () => {
    expect(() => departmentAuditLogQuerySchema.parse({ referenceType: 'space' })).toThrow();
    expect(() => departmentAuditLogQuerySchema.parse({ dateFrom: '01/05/2026' })).toThrow();
    expect(() => departmentAuditLogQuerySchema.parse({ dateTo: '2026-5-1' })).toThrow();
  });
});
