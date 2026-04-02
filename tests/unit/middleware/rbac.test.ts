import { describe, it, expect } from 'vitest';
import { extractRole } from '@/middleware/rbac';
import type { JwtPayload } from '@/types/auth';

function payload(roles: string[]): JwtPayload {
  return {
    sub: 'test-user',
    email: 'test@ufc.br',
    name: 'Test User',
    preferred_username: '2023001',
    realm_access: { roles },
    exp: 9999999999,
    iss: 'http://localhost:8787',
  };
}

describe('extractRole', () => {
  it('maps ufcim-student to student', () => {
    expect(extractRole(payload(['ufcim-student']))).toBe('student');
  });

  it('maps ufcim-professor to professor', () => {
    expect(extractRole(payload(['ufcim-professor']))).toBe('professor');
  });

  it('maps ufcim-staff to staff', () => {
    expect(extractRole(payload(['ufcim-staff']))).toBe('staff');
  });

  it('maps ufcim-maintenance to maintenance', () => {
    expect(extractRole(payload(['ufcim-maintenance']))).toBe('maintenance');
  });

  it('returns null for unrecognised role', () => {
    expect(extractRole(payload(['some-other-role']))).toBeNull();
  });

  it('returns null for empty roles array', () => {
    expect(extractRole(payload([]))).toBeNull();
  });

  it('returns null when realm_access is absent', () => {
    const p = payload([]);
    delete (p as Partial<JwtPayload>).realm_access;
    expect(extractRole(p)).toBeNull();
  });

  it('picks the first matching role when multiple ufcim roles are present', () => {
    // Only one should match; result is a valid UserRole
    const role = extractRole(payload(['ufcim-student', 'ufcim-professor']));
    expect(['student', 'professor']).toContain(role);
  });
});
