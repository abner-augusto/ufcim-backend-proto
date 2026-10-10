import { describe, it, expect } from 'vitest';
import { canManageReservation } from '@/lib/reservation-permissions';

const OWNER = 'owner-1';
const OTHER = 'other-1';
const REQUESTER = 'requester-1';
const reservation = { userId: OWNER };
const onBehalf = { userId: OWNER, requesterUserId: REQUESTER };

describe('canManageReservation (MEL-023)', () => {
  it.each(['student', 'professor', 'staff'])('lets a %s manage their own reservation', (role) => {
    expect(canManageReservation({ userId: OWNER, role }, reservation, 'edit')).toBe(true);
    expect(canManageReservation({ userId: OWNER, role }, reservation, 'cancel')).toBe(true);
  });

  it.each(['student', 'professor'])("does not let a %s manage someone else's reservation", (role) => {
    expect(canManageReservation({ userId: OTHER, role }, reservation, 'edit')).toBe(false);
    expect(canManageReservation({ userId: OTHER, role }, reservation, 'cancel')).toBe(false);
  });

  it("lets staff manage anyone's reservation", () => {
    expect(canManageReservation({ userId: OTHER, role: 'staff' }, reservation, 'edit')).toBe(true);
    expect(canManageReservation({ userId: OTHER, role: 'staff' }, reservation, 'cancel')).toBe(true);
  });

  it('never lets maintenance manage reservations, not even its own', () => {
    expect(canManageReservation({ userId: OTHER, role: 'maintenance' }, reservation, 'cancel')).toBe(false);
    expect(canManageReservation({ userId: OWNER, role: 'maintenance' }, reservation, 'edit')).toBe(false);
  });
});

describe('canManageReservation — registered requester (MEL-025)', () => {
  it.each(['student', 'professor'])('lets a %s requester cancel a reservation made on their behalf', (role) => {
    expect(canManageReservation({ userId: REQUESTER, role }, onBehalf, 'cancel')).toBe(true);
  });

  it.each(['student', 'professor'])('does not let a %s requester edit it', (role) => {
    expect(canManageReservation({ userId: REQUESTER, role }, onBehalf, 'edit')).toBe(false);
  });

  it('does not extend cancel rights to anyone else', () => {
    expect(canManageReservation({ userId: OTHER, role: 'professor' }, onBehalf, 'cancel')).toBe(false);
  });

  it('keeps maintenance out even when it is the requester', () => {
    expect(canManageReservation({ userId: REQUESTER, role: 'maintenance' }, onBehalf, 'cancel')).toBe(false);
  });

  it('ignores a null requester', () => {
    expect(canManageReservation({ userId: OTHER, role: 'student' }, { userId: OWNER, requesterUserId: null }, 'cancel')).toBe(false);
  });
});
