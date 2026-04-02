import { describe, it, expect } from 'vitest';
import {
  uuidSchema,
  paginationSchema,
  hourlyTimeSchema,
  boundaryTimeSchema,
  userRoleSchema,
  dateSchema,
  futureDateSchema,
} from '@/validators/common.schema';

// Helper: today in YYYY-MM-DD
function today() {
  return new Date().toISOString().split('T')[0];
}
function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}
function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

describe('uuidSchema', () => {
  it('accepts a valid UUID v4', () => {
    expect(uuidSchema.safeParse('550e8400-e29b-41d4-a716-446655440000').success).toBe(true);
  });

  it('rejects an invalid UUID', () => {
    expect(uuidSchema.safeParse('not-a-uuid').success).toBe(false);
  });
});

describe('dateSchema', () => {
  it('accepts YYYY-MM-DD format', () => {
    expect(dateSchema.safeParse('2026-06-15').success).toBe(true);
  });

  it('rejects DD/MM/YYYY format', () => {
    expect(dateSchema.safeParse('15/06/2026').success).toBe(false);
  });

  it('rejects date with time component', () => {
    expect(dateSchema.safeParse('2026-06-15T00:00:00Z').success).toBe(false);
  });

  it('rejects empty string', () => {
    expect(dateSchema.safeParse('').success).toBe(false);
  });
});

describe('futureDateSchema', () => {
  it('accepts today', () => {
    expect(futureDateSchema.safeParse(today()).success).toBe(true);
  });

  it('accepts a future date', () => {
    expect(futureDateSchema.safeParse('2099-12-31').success).toBe(true);
  });

  it('rejects yesterday', () => {
    const result = futureDateSchema.safeParse(yesterday());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/past/i);
    }
  });

  it('rejects wrong format even for future date-like string', () => {
    expect(futureDateSchema.safeParse('31-12-2099').success).toBe(false);
  });
});

describe('hourlyTimeSchema', () => {
  it.each(['00:00', '09:00', '23:00'])('accepts %s', (time) => {
    expect(hourlyTimeSchema.safeParse(time).success).toBe(true);
  });

  it('rejects non-hourly values', () => {
    expect(hourlyTimeSchema.safeParse('09:30').success).toBe(false);
  });
});

describe('boundaryTimeSchema', () => {
  it('accepts 24:00 as an end boundary', () => {
    expect(boundaryTimeSchema.safeParse('24:00').success).toBe(true);
  });
});

describe('userRoleSchema', () => {
  it.each(['student', 'professor', 'staff', 'maintenance'])('accepts %s', (role) => {
    expect(userRoleSchema.safeParse(role).success).toBe(true);
  });

  it('rejects an unknown role', () => {
    expect(userRoleSchema.safeParse('admin').success).toBe(false);
  });
});

describe('paginationSchema', () => {
  it('defaults page to 1 and limit to 20', () => {
    const result = paginationSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });

  it('coerces string numbers', () => {
    const result = paginationSchema.safeParse({ page: '3', limit: '10' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.limit).toBe(10);
    }
  });

  it('rejects limit above 100', () => {
    expect(paginationSchema.safeParse({ limit: '101' }).success).toBe(false);
  });

  it('rejects limit of 0', () => {
    expect(paginationSchema.safeParse({ limit: '0' }).success).toBe(false);
  });

  it('rejects page of 0', () => {
    expect(paginationSchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('rejects non-integer page', () => {
    expect(paginationSchema.safeParse({ page: '1.5' }).success).toBe(false);
  });
});
