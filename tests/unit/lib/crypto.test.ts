import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  generateOpaqueToken,
  sha256Hex,
  constantTimeEqual,
} from '@/lib/crypto';

describe('hashPassword', () => {
  it('produces a pbkdf2 encoded string with 600000 iterations', async () => {
    const hash = await hashPassword('mysecretpassword');
    expect(hash).toMatch(/^pbkdf2\$600000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  it('produces different outputs for the same plaintext (unique salts)', async () => {
    const hash1 = await hashPassword('samepassword');
    const hash2 = await hashPassword('samepassword');
    expect(hash1).not.toBe(hash2);
  });
});

describe('verifyPassword', () => {
  it('returns true for the correct plaintext', async () => {
    const hash = await hashPassword('correctpassword');
    expect(await verifyPassword('correctpassword', hash)).toBe(true);
  });

  it('returns false for a wrong plaintext', async () => {
    const hash = await hashPassword('correctpassword');
    expect(await verifyPassword('wrongpassword', hash)).toBe(false);
  });

  it('returns false for an empty string encoded value', async () => {
    expect(await verifyPassword('anything', '')).toBe(false);
  });

  it('returns false for "foo"', async () => {
    expect(await verifyPassword('anything', 'foo')).toBe(false);
  });

  it('returns false for "pbkdf2$$$"', async () => {
    expect(await verifyPassword('anything', 'pbkdf2$$$')).toBe(false);
  });

  it('returns false for "argon2$1$abc$def"', async () => {
    expect(await verifyPassword('anything', 'argon2$1$abc$def')).toBe(false);
  });
});

describe('generateOpaqueToken', () => {
  it('produces a URL-safe string of at least 40 characters', () => {
    const token = generateOpaqueToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(token).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('produces distinct tokens across 100 calls', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateOpaqueToken()));
    expect(tokens.size).toBe(100);
  });
});

describe('sha256Hex', () => {
  it('matches a known vector for "abc"', async () => {
    const result = await sha256Hex('abc');
    expect(result).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('constantTimeEqual', () => {
  it('returns true for equal strings', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('', '')).toBe(true);
  });

  it('returns false for strings of different length', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', 'a')).toBe(false);
  });

  it('returns false for same-length but different content', () => {
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('aaa', 'bbb')).toBe(false);
  });
});
