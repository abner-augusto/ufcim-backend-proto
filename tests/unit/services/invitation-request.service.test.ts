import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InvitationRequestService } from '@/services/invitation-request.service';
import type { Env } from '@/types/env';

const NOW = new Date().toISOString();
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

function createMockDb() {
  const insertReturning = vi.fn().mockResolvedValue([
    { id: 'req-new', name: 'New', email: 'new@ufc.br', status: 'pending', createdAt: NOW, reviewedAt: null, reviewedBy: null, invitationId: null },
  ]);
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
  const insertFn = vi.fn().mockReturnValue({ values: insertValues });

  const updateReturning = vi.fn().mockResolvedValue([
    { id: 'req-1', name: 'Pending', email: 'pending@ufc.br', status: 'rejected', createdAt: NOW, reviewedAt: NOW, reviewedBy: 'actor-1', invitationId: null },
  ]);
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });

  return {
    query: {
      users: { findFirst: vi.fn().mockResolvedValue(undefined) },
      invitations: { findFirst: vi.fn().mockResolvedValue(undefined) },
      invitationRequests: {
        findFirst: vi.fn().mockResolvedValue(undefined),
        findMany: vi.fn().mockResolvedValue([]),
      },
      departments: { findFirst: vi.fn().mockResolvedValue({ id: 'cc', name: 'CC', campus: 'Pici' }) },
    },
    insert: insertFn,
    update: updateFn,
    _insert: { returning: insertReturning },
    _update: { returning: updateReturning },
  };
}

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    name: 'Pending Person',
    email: 'pending@ufc.br',
    status: 'pending',
    createdAt: NOW,
    reviewedAt: null,
    reviewedBy: null,
    invitationId: null,
    ...overrides,
  };
}

describe('InvitationRequestService.request', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: InvitationRequestService;

  beforeEach(() => {
    db = createMockDb();
    service = new InvitationRequestService(db as never, TEST_ENV);
  });

  it('rejects when a user with that email already exists', async () => {
    db.query.users.findFirst.mockResolvedValue({ id: 'u-1', email: 'exists@ufc.br' });
    await expect(service.request({ name: 'Someone', email: 'exists@ufc.br' }))
      .rejects.toThrow('Já existe uma conta');
  });

  it('rejects when a pending request already exists', async () => {
    db.query.invitationRequests.findFirst.mockResolvedValue(makeRequest());
    await expect(service.request({ name: 'Someone', email: 'pending@ufc.br' }))
      .rejects.toThrow('solicitação pendente');
  });

  it('rejects an e-mail outside the configured allow-list', async () => {
    const service2 = new InvitationRequestService(db as never, { ...TEST_ENV, ALLOWED_EMAIL_DOMAINS: 'ufc.br' });
    await expect(service2.request({ name: 'Someone', email: 'someone@gmail.com' }))
      .rejects.toThrow('não é permitido');
  });

  it('creates a pending request on success', async () => {
    const result = await service.request({ name: 'New', email: 'new@ufc.br' });
    expect(result.status).toBe('pending');
    expect(db.insert).toHaveBeenCalled();
  });

  it('sends a Telegram notification when configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    const service2 = new InvitationRequestService(db as never, {
      ...TEST_ENV,
      TELEGRAM_BOT_TOKEN: 'bot-token',
      TELEGRAM_CHAT_ID: '12345',
    });
    await service2.request({ name: 'New', email: 'new@ufc.br' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/botbot-token/sendMessage');
    expect(JSON.parse(init.body as string)).toMatchObject({ chat_id: '12345' });

    vi.unstubAllGlobals();
  });

  it('still succeeds when the Telegram notification fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const service2 = new InvitationRequestService(db as never, {
      ...TEST_ENV,
      TELEGRAM_BOT_TOKEN: 'bot-token',
      TELEGRAM_CHAT_ID: '12345',
    });
    const result = await service2.request({ name: 'New', email: 'new@ufc.br' });
    expect(result.status).toBe('pending');

    vi.unstubAllGlobals();
  });

  it('skips the Telegram call when not configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await service.request({ name: 'New', email: 'new@ufc.br' });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

describe('InvitationRequestService.reject', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: InvitationRequestService;

  beforeEach(() => {
    db = createMockDb();
    service = new InvitationRequestService(db as never, TEST_ENV);
  });

  it('marks a pending request as rejected', async () => {
    db.query.invitationRequests.findFirst.mockResolvedValue(makeRequest());
    const result = await service.reject('actor-1', 'req-1');
    expect(result.status).toBe('rejected');
    expect(db.update).toHaveBeenCalled();
  });

  it('errors when the request was already reviewed', async () => {
    db.query.invitationRequests.findFirst.mockResolvedValue(makeRequest({ status: 'approved' }));
    await expect(service.reject('actor-1', 'req-1')).rejects.toThrow('já foi revisada');
  });

  it('errors when the request does not exist', async () => {
    db.query.invitationRequests.findFirst.mockResolvedValue(undefined);
    await expect(service.reject('actor-1', 'missing')).rejects.toThrow('não encontrad');
  });
});

describe('InvitationRequestService.approve', () => {
  it('creates an invitation and marks the request approved', async () => {
    const db = createMockDb();
    db.query.invitationRequests.findFirst.mockResolvedValue(makeRequest());
    // InvitationService.create inserts the invitation; return one with an id.
    db._insert.returning.mockResolvedValue([
      { id: 'inv-x', email: 'pending@ufc.br', role: 'student', name: 'Pending Person', department: 'cc', purpose: 'invite' },
    ]);
    db._update.returning.mockResolvedValue([makeRequest({ status: 'approved', invitationId: 'inv-x' })]);

    const service = new InvitationRequestService(db as never, TEST_ENV);
    const result = await service.approve('actor-1', 'req-1', { role: 'student', department: 'cc' });

    expect(result.request.status).toBe('approved');
    expect(result.url).toContain('http://localhost/#/convite/');
    expect(result.email.sent).toBe(false); // no RESEND_API_KEY in tests
  });
});
