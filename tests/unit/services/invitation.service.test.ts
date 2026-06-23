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

  const selectWhere = vi.fn().mockResolvedValue([{ total: 0 }]);
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const selectFn = vi.fn().mockReturnValue({ from: selectFrom });

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
    select: selectFn,
    _insert: { returning: insertReturning },
    _update: { returning: updateReturning },
    _select: { where: selectWhere },
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

// ─── Domain allow-list ───────────────────────────────────────────────────────────

describe('InvitationService.create — domain allow-list', () => {
  const ENV_WITH_DOMAINS: Env = { ...TEST_ENV, ALLOWED_EMAIL_DOMAINS: 'ufc.br,alu.ufc.br' };

  it('rejects an e-mail outside the allow-list', async () => {
    const db = createMockDb();
    const service = new InvitationService(db as never, ENV_WITH_DOMAINS);

    await expect(service.create({
      inviterId: 'actor-1',
      email: 'someone@gmail.com',
      name: 'Outsider',
      role: 'student',
      department: 'CC',
    })).rejects.toThrow('não é permitido');
  });

  it('accepts an e-mail inside the allow-list', async () => {
    const db = createMockDb();
    const service = new InvitationService(db as never, ENV_WITH_DOMAINS);

    await expect(service.create({
      inviterId: 'actor-1',
      email: 'aluno@alu.ufc.br',
      name: 'Aluno',
      role: 'student',
      department: 'CC',
    })).resolves.toBeDefined();
  });

  it('imposes no restriction when ALLOWED_EMAIL_DOMAINS is unset', async () => {
    const db = createMockDb();
    const service = new InvitationService(db as never, TEST_ENV);

    await expect(service.create({
      inviterId: 'actor-1',
      email: 'anyone@example.com',
      name: 'Anyone',
      role: 'student',
      department: 'CC',
    })).resolves.toBeDefined();
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

  it('returns pending invitations using SQL status condition, limit, and offset', async () => {
    const invitation = makeInvitation({ id: 'inv-1' });
    db.query.invitations.findMany.mockResolvedValue([invitation]);
    db._select.where.mockResolvedValueOnce([{ total: 1 }]);

    const result = await service.list({ status: 'pending', page: 2, limit: 10 });

    expect(result).toEqual({
      data: [invitation],
      pagination: { page: 2, limit: 10, total: 1, totalPages: 1 },
    });

    const args = db.query.invitations.findMany.mock.calls[0][0];
    expect(args.where).toBeDefined();
    expect(args.limit).toBe(10);
    expect(args.offset).toBe(10);
    expect(db._select.where).toHaveBeenCalledWith(args.where);
  });

  it('returns all invitations without a SQL status condition', async () => {
    const invitations = [makeInvitation(), makeInvitation({ id: 'inv-2', acceptedAt: PAST })];
    db.query.invitations.findMany.mockResolvedValue(invitations);
    db._select.where.mockResolvedValueOnce([{ total: 2 }]);

    const result = await service.list({ status: 'all', page: 1, limit: 50 });

    expect(result).toEqual({
      data: invitations,
      pagination: { page: 1, limit: 50, total: 2, totalPages: 1 },
    });

    expect(db.query.invitations.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: undefined,
      limit: 50,
      offset: 0,
    }));
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
