import { describe, it, expect } from 'vitest';
import {
  formatReservationAuthor,
  reservationAuthorInput,
  requesterContactFor,
  presentReservationForViewer,
  withRequesterContactFor,
} from '@/lib/reservation-privacy';

const STAFF = { id: 'staff-1', name: 'Carlos Oliveira', role: 'staff', email: 'c@x' };
const PROF = { id: 'prof-1', name: 'Dra. Maria Costa', role: 'professor', email: 'm@x' };

describe('reservationAuthorInput (MEL-025)', () => {
  it('uses the owner when nobody else asked for the reservation', () => {
    expect(reservationAuthorInput({ userId: PROF.id, user: PROF })).toEqual({
      ownerId: PROF.id, ownerName: PROF.name, ownerRole: 'professor',
    });
  });

  it('uses the registered requester as the author', () => {
    expect(
      reservationAuthorInput({ userId: STAFF.id, user: STAFF, requesterUserId: PROF.id, requester: PROF })
    ).toEqual({ ownerId: PROF.id, ownerName: PROF.name, ownerRole: 'professor' });
  });

  it("uses the free-text requester's name with the registering staff's role", () => {
    expect(
      reservationAuthorInput({ userId: STAFF.id, user: STAFF, requesterName: 'Coordenação do CAU' })
    ).toEqual({ ownerId: '', ownerName: 'Coordenação do CAU', ownerRole: 'staff' });
  });

  it('returns null when no person can be resolved', () => {
    expect(reservationAuthorInput({ userId: 'x', user: null })).toBeNull();
  });

  it('keeps the privacy rule: a student sees only the requester role label', () => {
    const input = reservationAuthorInput({ userId: STAFF.id, user: STAFF, requesterUserId: PROF.id, requester: PROF })!;
    expect(formatReservationAuthor(input, { userId: 'stud-1', role: 'student' })).toEqual({
      displayName: 'professor', role: 'professor', isSelf: false,
    });
  });

  it('marks the registered requester as self', () => {
    const input = reservationAuthorInput({ userId: STAFF.id, user: STAFF, requesterUserId: PROF.id, requester: PROF })!;
    expect(formatReservationAuthor(input, { userId: PROF.id, role: 'professor' }).isSelf).toBe(true);
  });
});

describe('requesterContactFor (MEL-025)', () => {
  it('shows the contact to staff only', () => {
    expect(requesterContactFor('staff', '85 99999-0000')).toBe('85 99999-0000');
    for (const role of ['student', 'professor', 'maintenance']) {
      expect(requesterContactFor(role, '85 99999-0000')).toBeUndefined();
    }
  });

  it('returns null to staff when there is no contact', () => {
    expect(requesterContactFor('staff', null)).toBeNull();
  });
});

describe('withRequesterContactFor (MEL-025)', () => {
  const row = { id: 'r1', requesterContact: 'maria@ufc.br' };

  it('keeps the contact for staff and drops it for everyone else', () => {
    expect(withRequesterContactFor('staff', row)).toEqual(row);
    for (const role of ['student', 'professor', 'maintenance']) {
      expect(withRequesterContactFor(role, row)).toEqual({ id: 'r1' });
    }
  });
});

describe('presentReservationForViewer (MEL-025)', () => {
  const row = {
    id: 'r1',
    userId: STAFF.id,
    createdBy: STAFF.id,
    requesterUserId: PROF.id,
    requesterName: null,
    requesterContact: 'maria@ufc.br',
    creator: STAFF,
    requester: PROF,
  };

  it('marks the reservation as made on behalf of the requester and names who registered it', () => {
    const view = presentReservationForViewer(row, { userId: PROF.id, role: 'professor' });
    expect(view.onBehalfOfMe).toBe(true);
    expect(view.registeredBy).toEqual({ id: STAFF.id, name: STAFF.name });
    expect(view.requester).toEqual({ userId: PROF.id, name: PROF.name });
  });

  it('hides the contact from the requester and keeps it for staff', () => {
    expect(presentReservationForViewer(row, { userId: PROF.id, role: 'professor' })).not.toHaveProperty('requesterContact');
    expect(presentReservationForViewer(row, { userId: STAFF.id, role: 'staff' }).requesterContact).toBe('maria@ufc.br');
  });

  it('never leaks the full user rows', () => {
    const view = presentReservationForViewer(row, { userId: STAFF.id, role: 'staff' });
    expect(view).not.toHaveProperty('creator');
    expect(JSON.stringify(view)).not.toContain('m@x');
  });

  it('is not "on behalf of me" for the staff owner', () => {
    expect(presentReservationForViewer(row, { userId: STAFF.id, role: 'staff' }).onBehalfOfMe).toBe(false);
  });

  it('exposes a free-text requester by name and no requester for a plain reservation', () => {
    const freeText = { ...row, requesterUserId: null, requester: null, requesterName: 'Coordenação' };
    expect(presentReservationForViewer(freeText, { userId: STAFF.id, role: 'staff' }).requester).toEqual({
      userId: null, name: 'Coordenação',
    });
    const plain = { ...row, requesterUserId: null, requester: null, requesterContact: null };
    expect(presentReservationForViewer(plain, { userId: STAFF.id, role: 'staff' }).requester).toBeNull();
  });
});

describe('formatReservationAuthor', () => {
  const owner = { ownerId: 'user-123', ownerName: 'João Silva', ownerRole: 'professor' };

  it('shows full name when viewer is the owner (isSelf)', () => {
    const result = formatReservationAuthor(owner, { userId: 'user-123', role: 'professor' });
    expect(result).toEqual({
      displayName: 'João Silva',
      role: 'professor',
      isSelf: true,
    });
  });

  it('shows full name when viewer has a privileged role (professor)', () => {
    const result = formatReservationAuthor(owner, { userId: 'other-user', role: 'professor' });
    expect(result).toEqual({
      displayName: 'João Silva',
      role: 'professor',
      isSelf: false,
    });
  });

  it('shows full name when viewer has a privileged role (staff)', () => {
    const result = formatReservationAuthor(owner, { userId: 'other-user', role: 'staff' });
    expect(result).toEqual({
      displayName: 'João Silva',
      role: 'professor',
      isSelf: false,
    });
  });

  it('shows full name when viewer has a privileged role (maintenance)', () => {
    const result = formatReservationAuthor(owner, { userId: 'other-user', role: 'maintenance' });
    expect(result).toEqual({
      displayName: 'João Silva',
      role: 'professor',
      isSelf: false,
    });
  });

  it('shows role label only when viewer is a student (not owner)', () => {
    const result = formatReservationAuthor(owner, { userId: 'other-student', role: 'student' });
    expect(result).toEqual({
      displayName: 'professor',
      role: 'professor',
      isSelf: false,
    });
  });

  it('shows full name when viewer is a student but isManager', () => {
    const result = formatReservationAuthor(
      owner,
      { userId: 'other-student', role: 'student' },
      { isManager: true }
    );
    expect(result).toEqual({
      displayName: 'João Silva',
      role: 'professor',
      isSelf: false,
    });
  });

  it('shows full name when student views own reservation', () => {
    const studentOwner = { ownerId: 'stud-1', ownerName: 'Maria', ownerRole: 'student' };
    const result = formatReservationAuthor(studentOwner, { userId: 'stud-1', role: 'student' });
    expect(result).toEqual({
      displayName: 'Maria',
      role: 'student',
      isSelf: true,
    });
  });

  it('shows "estudante" when student views another student reservation', () => {
    const studentOwner = { ownerId: 'stud-1', ownerName: 'Maria', ownerRole: 'student' };
    const result = formatReservationAuthor(studentOwner, { userId: 'stud-2', role: 'student' });
    expect(result).toEqual({
      displayName: 'estudante',
      role: 'student',
      isSelf: false,
    });
  });
});
