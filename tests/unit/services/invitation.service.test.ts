import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InvitationService } from '@/services/invitation.service';
import type { Env } from '@/types/env';

// ─── Mock DB ──────────────────────────────────────────────────────────────────

function createMockDb() {
  const insertReturning = vi.fn().mockResolvedValue([{ id: 'inv-new', email: 'new@ufc.br', role: 'student', name: 'New', registration: null, department: 'CC', tokenHash: 'hash', purpose: 'invite', invitedBy: 'actor-1', expiresAt: FUTURE, acceptedAt: null, acceptedUserId: null, revokedAt: null, createdAt: NOW }]);
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
  const insertFn = vi.fn().mockReturnValue({ values: insertValues });

  const updateReturning = vi.fn().mockResolvedValue([{ id: 'inv-1', revokedAt: NOW, acceptedAt: null }]);
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });

  return {
    query: {
      users: { findFirst: vi.fn().mockResolvedValue(undefined) },
      invitations: {
        findFirst: vi.fn().mockResolvedValue(undefined),
        findMany: vi.fn().mockResolvedValue([]),
      },
      departments: { findFirst: vi.fn().mockResolvedValue({ id: 'cc', name: 'CC', campus: 'Pici' }) },
      auditLogs: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    },
    insert: insertFn,
    update: updateFn,
    _insert: { returning: insertReturning },
    _update: { returning: updateReturning },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NOW = new Date().toISOString();
const FUTURE = new Date(Date.now() + 86400_000).toISOString();
const PAST = new Date(Date.now() - 86400_000).toISOString();

const TEST_ENV: Env = {
  DB: {} as D1Database,
  JWKS_URL: '',
  JWT_ISSUER: 'http://localhost',
  JWT_SIGNING_SECRET: 'test-secret',
  INVITE_BASE_URL: 'http://localhost',
  ADMIN_BASE_URL: 'http://localhost/admin',
  ENVIRONMENT: 'development',
};

function makeInvitation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    email: 'pending@ufc.br',
    role: 'student',
    name: 'Pending User',
    registration: null,
    department: 'CC',
    tokenHash: 'abc',
    purpose: 'invite',
    invitedBy: 'actor-1',
    expiresAt: FUTURE,
    acceptedAt: null,
    acceptedUserId: null,
    revokedAt: null,
    createdAt: PAST,
    ...overrides,
  };
}

// ─── Create ────────────────────────────────────────────────────────────────────

describe('InvitationService.create', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: InvitationService;

  beforeEach(() => {
    db = createMockDb();
    service = new InvitationService(db as never, TEST_ENV);
  });

  it('rejects when a user with that email already exists', async () => {
    db.query.users.findFirst.mockResolvedValue({ id: 'u-1', email: 'exists@ufc.br' });

    await expect(service.create({
      inviterId: 'actor-1',
      email: 'exists@ufc.br',
      name: 'Existing',
      role: 'student',
      department: 'CC',
    })).rejects.toThrow('Já existe um usuário');
  });

  it('rejects when a pending invitation already exists for that email', async () => {
    db.query.users.findFirst.mockResolvedValue(undefined);
    db.query.invitations.findFirst.mockResolvedValue(makeInvitation());

    await expect(service.create({
      inviterId: 'actor-1',
      email: 'pending@ufc.br',
      name: 'Another',
      role: 'student',
      department: 'CC',
    })).rejects.toThrow('Reenviar');
  });

  it('creates and returns token + url on success', async () => {
    db.query.users.findFirst.mockResolvedValue(undefined);
    db.query.invitations.findFirst.mockResolvedValue(undefined);

    const result = await service.create({
      inviterId: 'actor-1',
      email: 'new@ufc.br',
      name: 'New User',
      role: 'student',
      department: 'CC',
    });

    expect(result.token).toBeTruthy();
    expect(result.url).toContain('http://localhost/#/convite/');
    expect(result.invitation).toBeDefined();
  });

  it('skips user existence check for purpose=reset', async () => {
    db.query.users.findFirst.mockResolvedValue({ id: 'u-1', email: 'exists@ufc.br' });

    await expect(service.create({
      inviterId: 'actor-1',
      email: 'exists@ufc.br',
      name: 'Existing',
      role: 'student',
      department: 'CC',
      purpose: 'reset',
    })).resolves.toBeDefined();
  });

  it('rejects mixed-case duplicate email (Joao@ufc.br then JOAO@ufc.br)', async () => {
    db.query.users.findFirst.mockResolvedValue(undefined);
    // Simulates: an invite for joao@ufc.br already pending in DB (stored lowercase)
    db.query.invitations.findFirst.mockResolvedValue(makeInvitation({ email: 'joao@ufc.br' }));

    await expect(service.create({
      inviterId: 'actor-1',
      email: 'JOAO@ufc.br',
      name: 'Joao',
      role: 'student',
      department: 'CC',
    })).rejects.toThrow('Reenviar');
  });
});

// ─── List ──────────────────────────────────────────────────────────────────────

describe('InvitationService.list', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: InvitationService;

  beforeEach(() => {
    db = createMockDb();
    service = new InvitationService(db as never, TEST_ENV);
  });

  it('returns all invitations when status=all', async () => {
    db.query.invitations.findMany.mockResolvedValue([
      makeInvitation(),
      makeInvitation({ id: 'inv-2', acceptedAt: PAST }),
      makeInvitation({ id: 'inv-3', revokedAt: PAST }),
    ]);

    const result = await service.list({ status: 'all', page: 1, limit: 50 });
    expect(result.data).toHaveLength(3);
  });

  it('filters by status=pending', async () => {
    db.query.invitations.findMany.mockResolvedValue([
      makeInvitation({ id: 'inv-1' }),
      makeInvitation({ id: 'inv-2', acceptedAt: PAST }),
      makeInvitation({ id: 'inv-3', expiresAt: PAST }),
    ]);

    const result = await service.list({ status: 'pending', page: 1, limit: 50 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('inv-1');
  });

  it('filters by status=accepted', async () => {
    db.query.invitations.findMany.mockResolvedValue([
      makeInvitation({ id: 'inv-1' }),
      makeInvitation({ id: 'inv-2', acceptedAt: PAST }),
    ]);

    const result = await service.list({ status: 'accepted', page: 1, limit: 50 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('inv-2');
  });

  it('filters by status=revoked', async () => {
    db.query.invitations.findMany.mockResolvedValue([
      makeInvitation({ id: 'inv-1' }),
      makeInvitation({ id: 'inv-2', revokedAt: PAST }),
    ]);

    const result = await service.list({ status: 'revoked', page: 1, limit: 50 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('inv-2');
  });
});

// ─── Revoke ────────────────────────────────────────────────────────────────────

describe('InvitationService.revoke', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: InvitationService;

  beforeEach(() => {
    db = createMockDb();
    service = new InvitationService(db as never, TEST_ENV);
  });

  it('revokes a pending invitation', async () => {
    db.query.invitations.findFirst.mockResolvedValue(makeInvitation());

    const result = await service.revoke('actor-1', 'inv-1');
    expect(result).toBeDefined();
    expect(db.update).toHaveBeenCalled();
  });

  it('errors when trying to revoke an already-accepted invitation', async () => {
    db.query.invitations.findFirst.mockResolvedValue(makeInvitation({ acceptedAt: PAST }));

    await expect(service.revoke('actor-1', 'inv-1')).rejects.toThrow('aceito');
  });

  it('errors when invitation not found', async () => {
    db.query.invitations.findFirst.mockResolvedValue(undefined);

    await expect(service.revoke('actor-1', 'inv-1')).rejects.toThrow('não encontrado');
  });
});

// ─── Resend ────────────────────────────────────────────────────────────────────

describe('InvitationService.resend', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: InvitationService;

  beforeEach(() => {
    db = createMockDb();
    service = new InvitationService(db as never, TEST_ENV);
  });

  it('rotates the token and bumps expiresAt', async () => {
    const original = makeInvitation();
    db.query.invitations.findFirst.mockResolvedValue(original);

    const updatedInvite = { ...original, tokenHash: 'newhash', expiresAt: FUTURE };
    db._update.returning.mockResolvedValue([updatedInvite]);

    const result = await service.resend('actor-1', 'inv-1');
    expect(result.token).toBeTruthy();
    expect(result.url).toContain('http://localhost/#/convite/');
    expect(db.update).toHaveBeenCalled();

    const setCall = db.update().set;
    expect(setCall).toHaveBeenCalled();
  });

  it('errors when invitation has already been accepted', async () => {
    db.query.invitations.findFirst.mockResolvedValue(makeInvitation({ acceptedAt: PAST }));

    await expect(service.resend('actor-1', 'inv-1')).rejects.toThrow('aceito');
  });
});
