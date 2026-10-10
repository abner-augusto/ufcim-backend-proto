import { describe, expect, it } from 'vitest';
import {
  buildAvailability,
  datesBetween,
  DEFAULT_CLOSED_FROM,
  DEFAULT_CLOSED_TO,
  hourlyOccupancy,
  intervalsOverlap,
  isSlotEndTime,
  isSlotStartTime,
  MIN_DURATION_MINUTES,
  normalizeClosedHours,
  SLOT_MINUTES,
} from '@/lib/schedule';

describe('normalizeClosedHours', () => {
  it('falls back to default overnight closed hours when values are invalid', () => {
    expect(normalizeClosedHours('closed_from', 'closed_to')).toEqual({
      closedFrom: DEFAULT_CLOSED_FROM,
      closedTo: DEFAULT_CLOSED_TO,
    });
  });
});

describe('slot constants (MEL-024)', () => {
  it('uses 30-minute slots and a 1-hour minimum', () => {
    expect(SLOT_MINUTES).toBe(30);
    expect(MIN_DURATION_MINUTES).toBe(60);
  });
});

describe('isSlotStartTime / isSlotEndTime (MEL-024)', () => {
  it.each(['00:00', '07:30', '16:30', '23:30'])('accepts %s as a start', (time) => {
    expect(isSlotStartTime(time)).toBe(true);
  });

  it.each(['16:15', '16:45', '24:00', '7:30', '16:3'])('rejects %s as a start', (time) => {
    expect(isSlotStartTime(time)).toBe(false);
  });

  it.each(['00:30', '18:00', '23:30', '24:00'])('accepts %s as an end', (time) => {
    expect(isSlotEndTime(time)).toBe(true);
  });

  it.each(['24:30', '18:15'])('rejects %s as an end', (time) => {
    expect(isSlotEndTime(time)).toBe(false);
  });
});

describe('intervalsOverlap', () => {
  it('detects a partial half-hour overlap (16:00–17:00 vs 16:30–17:30)', () => {
    expect(intervalsOverlap('16:00', '17:00', '16:30', '17:30')).toBe(true);
  });

  it('treats touching intervals as free (16:00–16:30 vs 16:30–17:30)', () => {
    expect(intervalsOverlap('16:00', '16:30', '16:30', '17:30')).toBe(false);
  });
});

describe('buildAvailability', () => {
  it('returns 48 half-hour slots covering the whole day', () => {
    const slots = buildAvailability('22:00', '07:00', [], []);

    expect(slots).toHaveLength(48);
    expect(slots[0]).toMatchObject({ startTime: '00:00', endTime: '00:30' });
    expect(slots[33]).toMatchObject({ startTime: '16:30', endTime: '17:00' });
    expect(slots[47]).toMatchObject({ startTime: '23:30', endTime: '24:00' });
  });

  it('accepts a custom step', () => {
    const slots = buildAvailability('22:00', '07:00', [], [], 60);

    expect(slots).toHaveLength(24);
    expect(slots[23]).toMatchObject({ startTime: '23:00', endTime: '24:00' });
  });

  it('marks overnight hours as closed when closed hours are valid', () => {
    const slots = buildAvailability('22:00', '07:00', [], []);

    expect(slots.find((slot) => slot.startTime === '23:00')?.status).toBe('closed');
    expect(slots.find((slot) => slot.startTime === '06:30')?.status).toBe('closed');
    expect(slots.find((slot) => slot.startTime === '07:00')?.status).toBe('available');
    expect(slots.find((slot) => slot.startTime === '21:30')?.status).toBe('available');
    expect(slots.find((slot) => slot.startTime === '22:00')?.status).toBe('closed');
  });

  it('falls back to default overnight closed hours when closed hours are malformed', () => {
    const slots = buildAvailability('closed_from', 'closed_to', [], []);

    expect(slots.find((slot) => slot.startTime === '23:00')?.status).toBe('closed');
    expect(slots.find((slot) => slot.startTime === '06:00')?.status).toBe('closed');
    expect(slots.find((slot) => slot.startTime === '12:00')?.status).toBe('available');
  });

  it('marks only the half-hours a 16:30–18:00 reservation covers', () => {
    const slots = buildAvailability('22:00', '07:00', [{ startTime: '16:30', endTime: '18:00' }], []);
    const status = (time: string) => slots.find((slot) => slot.startTime === time)?.status;

    expect(status('16:00')).toBe('available');
    expect(status('16:30')).toBe('reserved');
    expect(status('17:00')).toBe('reserved');
    expect(status('17:30')).toBe('reserved');
    expect(status('18:00')).toBe('available');
  });

  it('gives blockings precedence over reservations', () => {
    const slots = buildAvailability(
      '22:00',
      '07:00',
      [{ startTime: '10:00', endTime: '11:00' }],
      [{ startTime: '10:30', endTime: '12:00' }]
    );
    const status = (time: string) => slots.find((slot) => slot.startTime === time)?.status;

    expect(status('10:00')).toBe('reserved');
    expect(status('10:30')).toBe('blocked');
    expect(status('11:30')).toBe('blocked');
  });
});

describe('hourlyOccupancy (MEL-024)', () => {
  it('aggregates the two halves of each hour', () => {
    const slots = buildAvailability('22:00', '07:00', [{ startTime: '16:30', endTime: '18:00' }], []);
    const hours = hourlyOccupancy(slots);

    expect(hours).toHaveLength(24);
    expect(hours[16]).toEqual({ hour: '16:00', occupied: 1, open: 2 });
    expect(hours[17]).toEqual({ hour: '17:00', occupied: 2, open: 2 });
    expect(hours[18]).toEqual({ hour: '18:00', occupied: 0, open: 2 });
    expect(hours[23]).toEqual({ hour: '23:00', occupied: 0, open: 0 });
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
