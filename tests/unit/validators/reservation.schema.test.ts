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
      startTime: '09:15',
      endTime: '10:30',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a half-hour range of at least 1 hour (16:30–18:00, MEL-024)', () => {
    const result = createReservationSchema.safeParse({
      spaceId: VALID_UUID,
      date: FUTURE_DATE,
      startTime: '16:30',
      endTime: '18:00',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a range ending at 24:00', () => {
    const result = createReservationSchema.safeParse({
      spaceId: VALID_UUID,
      date: FUTURE_DATE,
      startTime: '22:30',
      endTime: '24:00',
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ['16:00', '16:30'],
    ['16:30', '17:00'],
    ['23:30', '24:00'],
  ])('rejects %s–%s because it lasts less than 1 hour (MEL-024)', (startTime, endTime) => {
    const result = createReservationSchema.safeParse({
      spaceId: VALID_UUID,
      date: FUTURE_DATE,
      startTime,
      endTime,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message)).toContain(
        'A reserva deve durar pelo menos 1 hora'
      );
    }
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

  it('accepts optional purpose field', () => {
    const result = createReservationSchema.safeParse({
      spaceId: VALID_UUID,
      date: FUTURE_DATE,
      startTime: '09:00',
      endTime: '10:00',
      purpose: 'class',
    });
    expect(result.success).toBe(true);
  });

  it('accepts payload without purpose', () => {
    const result = createReservationSchema.safeParse({
      spaceId: VALID_UUID,
      date: FUTURE_DATE,
      startTime: '09:00',
      endTime: '10:00',
    });
    expect(result.success).toBe(true);
  });

  it('rejects purpose longer than 100 chars', () => {
    const result = createReservationSchema.safeParse({
      spaceId: VALID_UUID,
      date: FUTURE_DATE,
      startTime: '09:00',
      endTime: '10:00',
      purpose: 'x'.repeat(101),
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
      expect(issue?.message).toBe('A data final deve ser posterior à data inicial');
    }
  });

  it('rejects when endDate is before startDate', () => {
    const result = createRecurringReservationSchema.safeParse({
      ...base,
      endDate: '2099-05-01', // before 2099-06-15
    });
    expect(result.success).toBe(false);
  });

  it('accepts half-hour times (MEL-024)', () => {
    expect(
      createRecurringReservationSchema.safeParse({ ...base, startTime: '14:30', endTime: '16:00' }).success
    ).toBe(true);
  });

  it('rejects a series shorter than 1 hour (MEL-024)', () => {
    const result = createRecurringReservationSchema.safeParse({ ...base, startTime: '14:00', endTime: '14:30' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message)).toContain(
        'A reserva deve durar pelo menos 1 hora'
      );
    }
  });

  it('rejects dayOfWeek outside 0-6', () => {
    expect(createRecurringReservationSchema.safeParse({ ...base, dayOfWeek: 7 }).success).toBe(false);
    expect(createRecurringReservationSchema.safeParse({ ...base, dayOfWeek: -1 }).success).toBe(false);
  });

  it('normalizes the legacy dayOfWeek into daysOfWeek', () => {
    const result = createRecurringReservationSchema.safeParse(base);
    expect(result.success && result.data.daysOfWeek).toEqual([1]);
  });

  describe('daysOfWeek', () => {
    const { dayOfWeek: _dayOfWeek, ...multi } = base;

    it('accepts up to 3 weekdays, sorted and deduplicated', () => {
      const result = createRecurringReservationSchema.safeParse({ ...multi, daysOfWeek: [5, 1, 3, 1] });
      expect(result.success && result.data.daysOfWeek).toEqual([1, 3, 5]);
    });

    it('rejects more than 3 weekdays', () => {
      const result = createRecurringReservationSchema.safeParse({ ...multi, daysOfWeek: [1, 2, 3, 4] });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((i) => i.message)).toContain('Selecione no máximo 3 dias da semana');
      }
    });

    it('rejects an empty list, an out-of-range day, or no day at all', () => {
      expect(createRecurringReservationSchema.safeParse({ ...multi, daysOfWeek: [] }).success).toBe(false);
      expect(createRecurringReservationSchema.safeParse({ ...multi, daysOfWeek: [7] }).success).toBe(false);
      expect(createRecurringReservationSchema.safeParse(multi).success).toBe(false);
    });

    it('rejects sending both daysOfWeek and dayOfWeek', () => {
      expect(createRecurringReservationSchema.safeParse({ ...base, daysOfWeek: [2] }).success).toBe(false);
    });
  });

  it('accepts empty description (optional, no minimum length)', () => {
    expect(createRecurringReservationSchema.safeParse({ ...base, description: '' }).success).toBe(true);
  });

  it('accepts recurring payload without description', () => {
    const { description: _description, ...withoutDescription } = base;
    expect(createRecurringReservationSchema.safeParse(withoutDescription).success).toBe(true);
  });

  it('accepts optional purpose field in recurring payload', () => {
    expect(createRecurringReservationSchema.safeParse({ ...base, purpose: 'class' }).success).toBe(true);
  });

  it('accepts recurring payload without purpose', () => {
    expect(createRecurringReservationSchema.safeParse(base).success).toBe(true);
  });

  it('rejects purpose longer than 100 chars in recurring payload', () => {
    expect(
      createRecurringReservationSchema.safeParse({ ...base, purpose: 'x'.repeat(101) }).success
    ).toBe(false);
  });

  it('rejects description longer than 200 chars', () => {
    expect(
      createRecurringReservationSchema.safeParse({ ...base, description: 'x'.repeat(201) }).success
    ).toBe(false);
  });
});

describe('updateReservationSchema', () => {
  it('rejects an empty body: at least one field must change (MEL-023)', () => {
    expect(updateReservationSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a description-only edit (MEL-023)', () => {
    expect(updateReservationSchema.safeParse({ description: 'Aula de revisão' }).success).toBe(true);
  });

  it('accepts an empty description, which clears it (MEL-023)', () => {
    expect(updateReservationSchema.safeParse({ description: '' }).success).toBe(true);
  });

  it('rejects a description longer than 100 chars', () => {
    expect(updateReservationSchema.safeParse({ description: 'x'.repeat(101) }).success).toBe(false);
  });

  it('accepts a date-only edit', () => {
    expect(updateReservationSchema.safeParse({ date: '2099-06-16' }).success).toBe(true);
  });

  it('rejects a past date', () => {
    expect(updateReservationSchema.safeParse({ date: '2020-01-01' }).success).toBe(false);
  });

  it('rejects status, purpose and spaceId: they are not editable (MEL-023)', () => {
    expect(updateReservationSchema.safeParse({ status: 'canceled' }).success).toBe(false);
    expect(updateReservationSchema.safeParse({ purpose: 'class' }).success).toBe(false);
    expect(updateReservationSchema.safeParse({ spaceId: 'another-space', date: '2099-06-16' }).success).toBe(false);
  });

  it('rejects a start time off the 30-minute grid', () => {
    expect(updateReservationSchema.safeParse({ startTime: '08:15' }).success).toBe(false);
  });

  it('accepts valid hourly update values', () => {
    expect(updateReservationSchema.safeParse({ startTime: '08:00', endTime: '09:00' }).success).toBe(true);
  });

  it('accepts half-hour update values of at least 1 hour (MEL-024)', () => {
    expect(updateReservationSchema.safeParse({ startTime: '08:30', endTime: '09:30' }).success).toBe(true);
  });

  it('rejects an update shorter than 1 hour (MEL-024)', () => {
    expect(updateReservationSchema.safeParse({ startTime: '08:30', endTime: '09:00' }).success).toBe(false);
  });

  it('does not accept requester fields: the requester is fixed at creation (MEL-025)', () => {
    expect(updateReservationSchema.safeParse({ description: 'x', requesterName: 'Fulano' }).success).toBe(false);
  });

});

describe('requester fields (MEL-025)', () => {
  const single = { spaceId: VALID_UUID, date: FUTURE_DATE, startTime: '09:00', endTime: '10:00' };
  const recurring = {
    spaceId: VALID_UUID, startDate: FUTURE_DATE, endDate: FUTURE_DATE_LATER, dayOfWeek: 1, startTime: '09:00', endTime: '10:00',
  };
  const cases = [
    ['createReservationSchema', createReservationSchema, single],
    ['createRecurringReservationSchema', createRecurringReservationSchema, recurring],
  ] as const;

  describe.each(cases)('%s', (_name, schema, base) => {
    it('accepts a registered requester with a contact', () => {
      const result = schema.safeParse({ ...base, requesterUserId: VALID_UUID, requesterContact: '85 99999-0000' });
      expect(result.success).toBe(true);
    });

    it('accepts a free-text requester and trims it', () => {
      const result = schema.safeParse({ ...base, requesterName: '  Coordenação do CAU  ' });
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ requesterName: 'Coordenação do CAU' });
    });

    it('rejects a registered and a free-text requester together', () => {
      expect(schema.safeParse({ ...base, requesterUserId: VALID_UUID, requesterName: 'Fulano' }).success).toBe(false);
    });

    it('rejects a contact without a requester', () => {
      expect(schema.safeParse({ ...base, requesterContact: 'x@ufc.br' }).success).toBe(false);
    });

    it('rejects a blank free-text requester', () => {
      expect(schema.safeParse({ ...base, requesterName: '   ' }).success).toBe(false);
    });

    it('caps the free-text name and the contact at 100 characters', () => {
      expect(schema.safeParse({ ...base, requesterName: 'a'.repeat(101) }).success).toBe(false);
      expect(schema.safeParse({ ...base, requesterName: 'Fulano', requesterContact: 'a'.repeat(101) }).success).toBe(false);
    });
  });
});
