import { describe, it, expect } from 'vitest';
import { signAccessToken, verifyAccessToken } from '@/lib/jwt';

const BASE_INPUT = {
  userId: 'user-123',
  email: 'test@ufc.br',
  name: 'Test User',
  registration: '2023001',
  department: 'CC',
  role: 'professor' as const,
  isMasterAdmin: false,
  issuer: 'http://localhost:8787',
  secret: 'test-secret-abc',
};

describe('signAccessToken / verifyAccessToken', () => {
  it('roundtrips and returns the original payload fields', async () => {
    const token = await signAccessToken(BASE_INPUT);
    const payload = await verifyAccessToken(token, BASE_INPUT.issuer, BASE_INPUT.secret);

    expect(payload.sub).toBe(BASE_INPUT.userId);
    expect(payload.email).toBe(BASE_INPUT.email);
    expect(payload.name).toBe(BASE_INPUT.name);
    expect(payload.registration).toBe(BASE_INPUT.registration);
    expect(payload.department).toBe(BASE_INPUT.department);
    expect(payload.realm_access?.roles).toContain('ufcim-professor');
  });

  it('fails verification with a different secret', async () => {
    const token = await signAccessToken(BASE_INPUT);
    await expect(verifyAccessToken(token, BASE_INPUT.issuer, 'wrong-secret')).rejects.toThrow();
  });

  it('fails verification with a wrong issuer', async () => {
    const token = await signAccessToken(BASE_INPUT);
    await expect(verifyAccessToken(token, 'http://wrong-issuer', BASE_INPUT.secret)).rejects.toThrow();
  });

  it('fails verification for an expired token', async () => {
    const token = await signAccessToken({ ...BASE_INPUT, ttlSeconds: -1 });
    await expect(verifyAccessToken(token, BASE_INPUT.issuer, BASE_INPUT.secret)).rejects.toThrow();
  });

  it('includes ufcim-master-admin in roles when isMasterAdmin is true', async () => {
    const token = await signAccessToken({ ...BASE_INPUT, isMasterAdmin: true });
    const payload = await verifyAccessToken(token, BASE_INPUT.issuer, BASE_INPUT.secret);
    expect(payload.realm_access?.roles).toContain('ufcim-master-admin');
  });

  it('does not include ufcim-master-admin in roles when isMasterAdmin is false', async () => {
    const token = await signAccessToken({ ...BASE_INPUT, isMasterAdmin: false });
    const payload = await verifyAccessToken(token, BASE_INPUT.issuer, BASE_INPUT.secret);
    expect(payload.realm_access?.roles).not.toContain('ufcim-master-admin');
  });

  it('falls back preferred_username to email when registration is null', async () => {
    const token = await signAccessToken({ ...BASE_INPUT, registration: null });
    const payload = await verifyAccessToken(token, BASE_INPUT.issuer, BASE_INPUT.secret);
    expect(payload.preferred_username).toBe(BASE_INPUT.email);
  });
});
