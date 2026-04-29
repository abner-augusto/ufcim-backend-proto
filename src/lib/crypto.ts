// Format: "pbkdf2$<iterations>$<saltB64>$<hashB64>"
// 100_000 iterations of PBKDF2-SHA-256, 16-byte salt, 32-byte derived key.
// Note: Cloudflare Workers limits PBKDF2 to 100,000 iterations.
export async function hashPassword(plaintext: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(plaintext),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 },
    keyMaterial,
    256
  );

  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(derived)));
  return `pbkdf2$100000$${saltB64}$${hashB64}`;
}

// Constant-time verification. Parses the encoded string, derives with the same params, compares.
// Returns false (not throws) on malformed input.
export async function verifyPassword(plaintext: string, encoded: string): Promise<boolean> {
  try {
    const parts = encoded.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

    const iterations = parseInt(parts[1], 10);
    if (!Number.isFinite(iterations) || iterations <= 0) return false;

    const saltBytes = Uint8Array.from(atob(parts[2]), (c) => c.charCodeAt(0));
    const expectedHashBytes = Uint8Array.from(atob(parts[3]), (c) => c.charCodeAt(0));

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(plaintext),
      'PBKDF2',
      false,
      ['deriveBits']
    );

    const derived = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
      keyMaterial,
      expectedHashBytes.length * 8
    );

    const derivedHex = toHex(new Uint8Array(derived));
    const expectedHex = toHex(expectedHashBytes);
    return constantTimeEqual(derivedHex, expectedHex);
  } catch {
    return false;
  }
}

// Cryptographically secure random opaque token, base64url-encoded (no padding), 32 bytes.
// Used for refresh tokens and invite tokens.
export function generateOpaqueToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// SHA-256 hex digest of the input.
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return toHex(new Uint8Array(digest));
}

// Constant-time string compare. Both inputs must be hex (or any equal-length ASCII).
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
