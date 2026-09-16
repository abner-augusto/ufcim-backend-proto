import { describe, expect, it } from 'vitest';
import {
  buildHourlyAvailability,
  datesBetween,
  DEFAULT_CLOSED_FROM,
  DEFAULT_CLOSED_TO,
  normalizeClosedHours,
} from '@/lib/schedule';

describe('normalizeClosedHours', () => {
  it('falls back to default overnight closed hours when values are invalid', () => {
    expect(normalizeClosedHours('closed_from', 'closed_to')).toEqual({
      closedFrom: DEFAULT_CLOSED_FROM,
      closedTo: DEFAULT_CLOSED_TO,
    });
  });
});

describe('buildHourlyAvailability', () => {
  it('marks overnight hours as closed when closed hours are valid', () => {
    const slots = buildHourlyAvailability('22:00', '07:00', [], []);

    expect(slots.find((slot) => slot.startTime === '23:00')?.status).toBe('closed');
    expect(slots.find((slot) => slot.startTime === '06:00')?.status).toBe('closed');
    expect(slots.find((slot) => slot.startTime === '07:00')?.status).toBe('available');
  });

  it('falls back to default overnight closed hours when closed hours are malformed', () => {
    const slots = buildHourlyAvailability('closed_from', 'closed_to', [], []);

    expect(slots.find((slot) => slot.startTime === '23:00')?.status).toBe('closed');
    expect(slots.find((slot) => slot.startTime === '06:00')?.status).toBe('closed');
    expect(slots.find((slot) => slot.startTime === '12:00')?.status).toBe('available');
  });
});

describe('datesBetween', () => {
  it('returns a single date when from equals to', () => {
    expect(datesBetween('2099-06-15', '2099-06-15')).toEqual(['2099-06-15']);
  });

  it('returns the inclusive range (MEL-017)', () => {
    expect(datesBetween('2099-06-15', '2099-06-18')).toEqual([
      '2099-06-15',
      '2099-06-16',
      '2099-06-17',
      '2099-06-18',
    ]);
  });

  it('crosses month and year boundaries', () => {
    expect(datesBetween('2099-12-30', '2100-01-02')).toEqual([
      '2099-12-30',
      '2099-12-31',
      '2100-01-01',
      '2100-01-02',
    ]);
  });
});
