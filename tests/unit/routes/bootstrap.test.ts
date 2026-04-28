import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, Env } from '@/types/env';
import { globalErrorHandler } from '@/middleware/error-handler';

// ─── Mock DB factory ──────────────────────────────────────────────────────────

const mockFindFirst = vi.fn().mockResolvedValue(undefined);
const mockBatch = vi.fn().mockResolvedValue([]);

vi.mock('@/db/client', () => ({
  createDb: vi.fn(() => ({
    query: {
      users: { findFirst: mockFindFirst },
    },
  })),
}));

// ─── Import after mock is set up ──────────────────────────────────────────────

const { bootstrapRoutes } = await import('@/routes/bootstrap');

// ─── Env helpers ──────────────────────────────────────────────────────────────

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({}),
      }),
      batch: mockBatch,
    } as unknown as D1Database,
    JWKS_URL: '',
    JWT_ISSUER: 'http://localhost',
    JWT_SIGNING_SECRET: 'test-secret',
    INVITE_BASE_URL: '',
    ADMIN_BASE_URL: '',
    BOOTSTRAP_TOKEN: 'correct-bootstrap-token',
    ENVIRONMENT: 'development',
    ...overrides,
  };
}

function makeApp() {
  const app = new Hono<AppEnv>();
  app.onError(globalErrorHandler);
  app.route('/bootstrap', bootstrapRoutes);
  return app;
}

const VALID_BODY = JSON.stringify({
  email: 'admin@ufc.br',
  name: 'Admin User',
  department: 'IAUD',
  password: 'AdminPass123',
});

const VALID_HEADERS = {
  'Content-Type': 'application/json',
  'X-Bootstrap-Token': 'correct-bootstrap-token',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /bootstrap/master-admin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindFirst.mockResolvedValue(undefined);
    mockBatch.mockResolvedValue([]);
  });

  it('returns 401 when X-Bootstrap-Token header is missing', async () => {
    const app = makeApp();
    const res = await app.request(
      'http://localhost/bootstrap/master-admin',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: VALID_BODY },
      makeEnv()
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 when X-Bootstrap-Token is wrong', async () => {
    const app = makeApp();
    const res = await app.request(
      'http://localhost/bootstrap/master-admin',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Bootstrap-Token': 'wrong-token' },
        body: VALID_BODY,
      },
      makeEnv()
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 when BOOTSTRAP_TOKEN env var is not set', async () => {
    const app = makeApp();
    const res = await app.request(
      'http://localhost/bootstrap/master-admin',
      { method: 'POST', headers: VALID_HEADERS, body: VALID_BODY },
      makeEnv({ BOOTSTRAP_TOKEN: undefined })
    );
    expect(res.status).toBe(401);
  });

  it('returns 200 and creates master admin when token is correct and no admin exists', async () => {
    const app = makeApp();
    const res = await app.request(
      'http://localhost/bootstrap/master-admin',
      { method: 'POST', headers: VALID_HEADERS, body: VALID_BODY },
      makeEnv()
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; userId: string };
    expect(body.ok).toBe(true);
    expect(body.userId).toBeTruthy();
    expect(mockBatch).toHaveBeenCalled();
  });

  it('returns 409 when master admin already exists', async () => {
    mockFindFirst.mockResolvedValue({ id: 'existing-admin', isMasterAdmin: true });
    const app = makeApp();
    const res = await app.request(
      'http://localhost/bootstrap/master-admin',
      { method: 'POST', headers: VALID_HEADERS, body: VALID_BODY },
      makeEnv()
    );
    expect(res.status).toBe(409);
  });

  it('returns 400 for a weak password', async () => {
    const app = makeApp();
    const weakBody = JSON.stringify({
      email: 'admin@ufc.br',
      name: 'Admin',
      department: 'IAUD',
      password: 'weak',
    });
    const res = await app.request(
      'http://localhost/bootstrap/master-admin',
      { method: 'POST', headers: VALID_HEADERS, body: weakBody },
      makeEnv()
    );
    expect(res.status).toBe(400);
  });

  it('normalizes mixed-case email to lowercase before storing', async () => {
    const mockBind = vi.fn().mockReturnValue({});
    const mockPrepare = vi.fn().mockReturnValue({ bind: mockBind });
    const app = makeApp();
    const mixedBody = JSON.stringify({
      email: 'Admin@UFC.br',
      name: 'Admin User',
      department: 'IAUD',
      password: 'AdminPass123',
    });
    const res = await app.request(
      'http://localhost/bootstrap/master-admin',
      { method: 'POST', headers: VALID_HEADERS, body: mixedBody },
      makeEnv({
        DB: { prepare: mockPrepare, batch: mockBatch } as unknown as D1Database,
      })
    );
    expect(res.status).toBe(200);
    // All bind() calls should use lowercase email only
    const allBindArgs = mockBind.mock.calls.flat();
    expect(allBindArgs).toContain('admin@ufc.br');
    expect(allBindArgs).not.toContain('Admin@UFC.br');
  });
});
