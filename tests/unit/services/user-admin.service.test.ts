import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserAdminService } from '@/services/user-admin.service';
import type { Env } from '@/types/env';

// ─── Mock DB ──────────────────────────────────────────────────────────────────

function createMockDb() {
  const insertReturning = vi.fn().mockResolvedValue([{}]);
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
  const insertFn = vi.fn().mockReturnValue({ values: insertValues });

  const updateReturningFn = vi.fn().mockResolvedValue([makeUser()]);
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturningFn });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });

  return {
    query: {
      users: { findFirst: vi.fn().mockResolvedValue(undefined) },
      refreshTokens: {
        findFirst: vi.fn().mockResolvedValue(undefined),
        findMany: vi.fn().mockResolvedValue([]),
      },
      invitations: { findFirst: vi.fn().mockResolvedValue(undefined) },
      auditLogs: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    },
    insert: insertFn,
    update: updateFn,
    _update: { returning: updateReturningFn, where: updateWhere },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PAST = new Date(Date.now() - 86400_000).toISOString();
const FUTURE = new Date(Date.now() + 86400_000).toISOString();

const TEST_ENV: Env = {
  DB: {} as D1Database,
  JWKS_URL: '',
  JWT_ISSUER: 'http://localhost',
  JWT_SIGNING_SECRET: 'test-secret',
  INVITE_BASE_URL: 'http://localhost',
  ADMIN_BASE_URL: 'http://localhost/admin',
  ENVIRONMENT: 'development',
};

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    name: 'Test User',
    email: 'test@ufc.br',
    registration: '2023001',
    role: 'student',
    department: 'CC',
    isMasterAdmin: false,
    disabledAt: null,
    createdAt: PAST,
    updatedAt: PAST,
    ...overrides,
  };
}

// ─── changeRole ───────────────────────────────────────────────────────────────

describe('UserAdminService.changeRole', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: UserAdminService;

  beforeEach(() => {
    db = createMockDb();
    service = new UserAdminService(db as never, TEST_ENV);
  });

  it('changes the role for a regular user', async () => {
    db.query.users.findFirst.mockResolvedValue(makeUser());

    await service.changeRole('actor-1', 'user-1', 'professor');
    expect(db.update).toHaveBeenCalled();
  });

  it('errors when targeting a master admin', async () => {
    db.query.users.findFirst.mockResolvedValue(makeUser({ isMasterAdmin: true }));

    await expect(service.changeRole('actor-1', 'user-1', 'professor')).rejects.toThrow(
      'administrador principal'
    );
  });

  it('errors when user not found', async () => {
    db.query.users.findFirst.mockResolvedValue(undefined);

    await expect(service.changeRole('actor-1', 'ghost-id', 'professor')).rejects.toThrow(
      'não encontrado'
    );
  });
});

// ─── setDisabled ──────────────────────────────────────────────────────────────

describe('UserAdminService.setDisabled', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: UserAdminService;

  beforeEach(() => {
    db = createMockDb();
    service = new UserAdminService(db as never, TEST_ENV);
  });

  it('disables the user and revokes all refresh tokens', async () => {
    db.query.users.findFirst.mockResolvedValue(makeUser());
    db._update.returning.mockResolvedValue([makeUser({ disabledAt: new Date().toISOString() })]);

    await service.setDisabled('actor-1', 'user-1', true);

    // update called for users table + refreshTokens table
    expect(db.update.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('does not revoke refresh tokens when re-enabling', async () => {
    db.query.users.findFirst.mockResolvedValue(makeUser({ disabledAt: PAST }));
    db._update.returning.mockResolvedValue([makeUser({ disabledAt: null })]);

    await service.setDisabled('actor-1', 'user-1', false);

    // Only updates users table (not refreshTokens)
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it('errors when targeting a master admin', async () => {
    db.query.users.findFirst.mockResolvedValue(makeUser({ isMasterAdmin: true }));

    await expect(service.setDisabled('actor-1', 'user-1', true)).rejects.toThrow(
      'administrador principal'
    );
  });
});

// ─── revokeAllSessions ────────────────────────────────────────────────────────

describe('UserAdminService.revokeAllSessions', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: UserAdminService;

  beforeEach(() => {
    db = createMockDb();
    service = new UserAdminService(db as never, TEST_ENV);
  });

  it('returns count of revoked sessions', async () => {
    db.query.users.findFirst.mockResolvedValue(makeUser());
    db._update.returning.mockResolvedValue([
      { id: 'rt-1' },
      { id: 'rt-2' },
    ]);

    const result = await service.revokeAllSessions('actor-1', 'user-1');
    expect(result.revoked).toBe(2);
  });

  it('returns 0 when user has no active sessions', async () => {
    db.query.users.findFirst.mockResolvedValue(makeUser());
    db._update.returning.mockResolvedValue([]);

    const result = await service.revokeAllSessions('actor-1', 'user-1');
    expect(result.revoked).toBe(0);
  });

  it('errors when user not found', async () => {
    db.query.users.findFirst.mockResolvedValue(undefined);

    await expect(service.revokeAllSessions('actor-1', 'ghost-id')).rejects.toThrow('não encontrado');
  });
});
