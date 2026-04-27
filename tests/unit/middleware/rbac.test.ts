import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { extractRole, requireMasterAdmin, isMasterAdmin } from '@/middleware/rbac';
import type { JwtPayload } from '@/types/auth';
import type { AppEnv, Env } from '@/types/env';

const TEST_ENV: Env = {
  DB: {} as D1Database,
  JWKS_URL: '',
  JWT_ISSUER: 'http://localhost',
  JWT_SIGNING_SECRET: 'secret',
  INVITE_BASE_URL: '',
  ADMIN_BASE_URL: '',
  ENVIRONMENT: 'development',
};

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

describe('isMasterAdmin', () => {
  it('returns true when ufcim-master-admin is in realm_access.roles', () => {
    expect(isMasterAdmin(payload(['ufcim-staff', 'ufcim-master-admin']))).toBe(true);
  });

  it('returns false when ufcim-master-admin is absent', () => {
    expect(isMasterAdmin(payload(['ufcim-staff']))).toBe(false);
  });

  it('returns false when realm_access is absent', () => {
    const p = payload([]);
    delete (p as Partial<JwtPayload>).realm_access;
    expect(isMasterAdmin(p)).toBe(false);
  });
});

describe('requireMasterAdmin', () => {
  function makeApp(userPayload: JwtPayload) {
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('user', userPayload);
      await next();
    });
    app.use('*', requireMasterAdmin());
    app.get('/admin', (c) => c.json({ ok: true }));
    return app;
  }

  it('allows a user with ufcim-master-admin role', async () => {
    const app = makeApp(payload(['ufcim-staff', 'ufcim-master-admin']));
    const res = await app.request('http://localhost/admin', { method: 'GET' }, TEST_ENV);
    expect(res.status).toBe(200);
  });

  it('returns 403 for a staff user without master-admin role', async () => {
    const app = makeApp(payload(['ufcim-staff']));
    const res = await app.request('http://localhost/admin', { method: 'GET' }, TEST_ENV);
    expect(res.status).toBe(403);
  });

  it('returns 403 when realm_access is missing', async () => {
    const p = payload([]);
    delete (p as Partial<JwtPayload>).realm_access;
    const app = makeApp(p);
    const res = await app.request('http://localhost/admin', { method: 'GET' }, TEST_ENV);
    expect(res.status).toBe(403);
  });
});
