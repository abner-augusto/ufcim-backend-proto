import { describe, it, expect } from 'vitest';
import {
  createReservationSchema,
  createRecurringReservationSchema,
  updateReservationSchema,
} from '@/validators/reservation.schema';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const FUTURE_DATE = '2099-06-15';
const FUTURE_DATE_LATER = '2099-07-15';

describe('createReservationSchema', () => {
  it('accepts a valid payload', () => {
    const result = createReservationSchema.safeParse({
      spaceId: VALID_UUID,
      date: FUTURE_DATE,
      startTime: '09:00',
      endTime: '10:00',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing spaceId', () => {
    const result = createReservationSchema.safeParse({
      date: FUTURE_DATE,
      startTime: '09:00',
      endTime: '10:00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid startTime', () => {
    const result = createReservationSchema.safeParse({
      spaceId: VALID_UUID,
      date: FUTURE_DATE,
      startTime: '09:30',
      endTime: '10:00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects endTime earlier than startTime', () => {
    const result = createReservationSchema.safeParse({
      spaceId: VALID_UUID,
      date: FUTURE_DATE,
      startTime: '10:00',
      endTime: '09:00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a past date', () => {
    const result = createReservationSchema.safeParse({
      spaceId: VALID_UUID,
      date: '2020-01-01',
      startTime: '14:00',
      endTime: '15:00',
    });
    expect(result.success).toBe(false);
  });
});

describe('createRecurringReservationSchema', () => {
  const base = {
    spaceId: VALID_UUID,
    startDate: FUTURE_DATE,
    endDate: FUTURE_DATE_LATER,
    dayOfWeek: 1,
    startTime: '14:00',
    endTime: '15:00',
    description: 'Weekly lecture',
  };

  it('accepts a valid recurring payload', () => {
    expect(createRecurringReservationSchema.safeParse(base).success).toBe(true);
  });

  it('rejects when endDate equals startDate', () => {
    const result = createRecurringReservationSchema.safeParse({
      ...base,
      endDate: FUTURE_DATE,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('endDate'));
      expect(issue?.message).toMatch(/after start/i);
    }
  });

  it('rejects when endDate is before startDate', () => {
    const result = createRecurringReservationSchema.safeParse({
      ...base,
      endDate: '2099-05-01', // before 2099-06-15
    });
    expect(result.success).toBe(false);
  });

  it('rejects dayOfWeek outside 0-6', () => {
    expect(createRecurringReservationSchema.safeParse({ ...base, dayOfWeek: 7 }).success).toBe(false);
    expect(createRecurringReservationSchema.safeParse({ ...base, dayOfWeek: -1 }).success).toBe(false);
  });

  it('rejects empty description', () => {
    expect(createRecurringReservationSchema.safeParse({ ...base, description: '' }).success).toBe(false);
  });

  it('rejects description longer than 200 chars', () => {
    expect(
      createRecurringReservationSchema.safeParse({ ...base, description: 'x'.repeat(201) }).success
    ).toBe(false);
  });
});

describe('updateReservationSchema', () => {
  it('accepts all fields optional (empty object is valid)', () => {
    expect(updateReservationSchema.safeParse({}).success).toBe(true);
  });

  it('accepts valid status values', () => {
    for (const status of ['confirmed', 'canceled', 'modified']) {
      expect(updateReservationSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it('accepts valid hourly update values', () => {
    expect(updateReservationSchema.safeParse({ startTime: '08:00', endTime: '09:00' }).success).toBe(true);
  });

  it('rejects invalid status', () => {
    expect(updateReservationSchema.safeParse({ status: 'overridden' }).success).toBe(false);
  });
});
