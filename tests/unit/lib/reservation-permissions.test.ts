import { describe, it, expect } from 'vitest';
import { canManageReservation } from '@/lib/reservation-permissions';

const OWNER = 'owner-1';
const OTHER = 'other-1';
const reservation = { userId: OWNER };

describe('canManageReservation (MEL-023)', () => {
  it.each(['student', 'professor', 'staff'])('lets a %s manage their own reservation', (role) => {
    expect(canManageReservation({ userId: OWNER, role }, reservation)).toBe(true);
  });

  it.each(['student', 'professor'])("does not let a %s manage someone else's reservation", (role) => {
    expect(canManageReservation({ userId: OTHER, role }, reservation)).toBe(false);
  });

  it("lets staff manage anyone's reservation", () => {
    expect(canManageReservation({ userId: OTHER, role: 'staff' }, reservation)).toBe(true);
  });

  it('never lets maintenance manage reservations, not even its own', () => {
    expect(canManageReservation({ userId: OTHER, role: 'maintenance' }, reservation)).toBe(false);
    expect(canManageReservation({ userId: OWNER, role: 'maintenance' }, reservation)).toBe(false);
  });
});
