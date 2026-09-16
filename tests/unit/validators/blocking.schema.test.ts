import { describe, expect, it } from 'vitest';
import { createBlockingSchema, MAX_BLOCKING_RANGE_DAYS } from '@/validators/blocking.schema';

const BASE = {
  spaceId: 'space-1',
  startTime: '08:00',
  endTime: '12:00',
  blockType: 'maintenance' as const,
};

describe('createBlockingSchema', () => {
  it('accepts the single-day form and defaults the reason', () => {
    const parsed = createBlockingSchema.safeParse({ ...BASE, date: '2099-06-15' });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.reason).toBe('');
  });

  it('accepts the inclusive range form (MEL-017)', () => {
    const parsed = createBlockingSchema.safeParse({
      ...BASE,
      dateFrom: '2099-06-15',
      dateTo: '2099-06-19',
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects when both date and the range are provided', () => {
    const parsed = createBlockingSchema.safeParse({
      ...BASE,
      date: '2099-06-15',
      dateFrom: '2099-06-15',
      dateTo: '2099-06-19',
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects when neither form is provided', () => {
    expect(createBlockingSchema.safeParse(BASE).success).toBe(false);
  });

  it('rejects an inverted range', () => {
    const parsed = createBlockingSchema.safeParse({
      ...BASE,
      dateFrom: '2099-06-19',
      dateTo: '2099-06-15',
    });

    expect(parsed.success).toBe(false);
  });

  it('accepts a range of exactly the maximum length', () => {
    // 2099 is not a leap year: Jan 31 + Feb 28 + Mar 1 = 60 days.
    const parsed = createBlockingSchema.safeParse({
      ...BASE,
      dateFrom: '2099-01-01',
      dateTo: '2099-03-01',
    });

    expect(parsed.success).toBe(true);
    expect(MAX_BLOCKING_RANGE_DAYS).toBe(60);
  });

  it('rejects a range longer than the maximum', () => {
    const parsed = createBlockingSchema.safeParse({
      ...BASE,
      dateFrom: '2099-01-01',
      dateTo: '2099-03-02',
    });

    expect(parsed.success).toBe(false);
  });

  it('still rejects an end time that is not after the start', () => {
    const parsed = createBlockingSchema.safeParse({
      ...BASE,
      date: '2099-06-15',
      endTime: '08:00',
    });

    expect(parsed.success).toBe(false);
  });
});
