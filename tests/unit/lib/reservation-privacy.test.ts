import { describe, it, expect } from 'vitest';
import { formatReservationAuthor } from '@/lib/reservation-privacy';

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
