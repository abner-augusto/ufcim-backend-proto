/**
 * Generates signed RS256 JWTs for local testing against `wrangler dev`.
 *
 * Prerequisites:
 *   1. Copy .dev.vars.example → .dev.vars
 *   2. Start the worker: npx wrangler dev
 *
 * Usage:
 *   node scripts/generate-test-token.mjs [role]
 *   role: student | professor | staff | maintenance (default: student)
 *
 * The tokens are valid for 24 hours and signed with the dev private key
 * whose public counterpart is served at GET /dev/jwks.
 *
 * ⚠️  DEV ONLY — never use these keys or tokens in production.
 */

import { SignJWT, importJWK } from 'jose';

// ── Dev-only private JWK (matches src/dev/test-jwks.ts public key) ───────────
const PRIVATE_JWK = {
  kty: 'RSA',
  kid: 'ufcim-dev-key-1',
  n: 'nsyMuWdrEm48RWiI3Zj3MA-eWDgyvA1YvzpQkJl_CmP6o5WrGvVmgPu0QDhIOJkbks7NB9DeHLzFXFRxprwrkRrM3Gps4z_QhC_TeFKkIJ7zBiyKKInUYM9Cga-544rR0XKsGZcx6OyYNvmC9IL_9r-_YcOxOim0RUal2LODRgIEAll6z5RtKnvbPr1WBI2nUFS1u8cH3eqIEGvEqwDzrSiKULBZOy1Ahaa0LMHDZOCik1PU5Tr7MRfiE4pUfzATZPiffsbo8coPj8pJ6pooFKh5GfO9C2nKt1zEdXMZZYOSF0ugizuwpz2-U5YZPTcNdCkHtWI_eBJ0uExmfY6ZFQ',
  e: 'AQAB',
  d: 'FXcTX51v3vwpJ_2vIHskkKnPzt971ikcsa6lhMJG5qXok5Ov3xNEYZOEhDjHZGUn0cKj-tY8K9jFectNWIsvfWwIvJOjN92gpzmaxXUwS9uIgLFlFIE7BMIHXKXfA_e4EG6GfmgOXkya77VvAvOxO06khUfRTUolXMbltKLhUAVPtqaiDqtF847zvqBAV1NF30nEu6Qi4EmxXsjq0bvXOe7tSiikTNeA5xNeFfaMGFJnjk32ap7MbxFHm2aYa4twV5fYZSLcgRkUUdKwLQL_k4SfEPA0FQho7zaIQH9Lxzm2wJak5EbV3Ab4BoDHLkjSv-Oj8RVC3-4JYeM4EJX3kQ',
  p: 'zRdWdSF559peyPxh897O7XGKQqMjgHeeOI575KWjbCUk17X-lcK78RA50QsWt0vorLupxBYoF8wTXfMOzpVREvaeVT3M5cUK-YCa5qAOdMoVvVv1Sz1bR39v3u5EDSYgwwwoDcmfRAaR4yLXO79A6_21M5TNtaKzRKkkhJyDGSU',
  q: 'xjeLmjxjQOUFOpzsYUVkagX8ozbIfSoozgm8GfFONvLWsJnB1tjYQJwtTL58huzKcxSLa5Fc93fWqD6AbS4YmT_5JlsXzVp9URYVkyP2PMmU0Z3AHGtDDqmArLa6D5PVVQUwYCpaOOss3qbZnpJ1DLcMwvoiAKKBuBHa1Z_v1TE',
  dp: 'qO5WOrjOTxniBS9OB7A5Rf_F4Mm7zm-5FeDXUCjXiZa22C-Ceh0i7Zdt6DB4D5cpGk6hsXCGqcNhGHvCcIsxcqtNE-2JvqElPwqdjOW9wplKeuUqEUWC0Eu5_CjKSQJk7gQvYdv3ofK_bBYgr4gDk98wyEIDh19yxlWETO8WVTk',
  dq: 'pzEM6NDM610B1xmr7LQqaZ-ZJFY-MA0SlA_0AHHghkq4ugdHUCBh78WMFDKMOQacEQugOeBH6VjEz-7ARtdd2k3yqt6lKgqMr4uQMSdhOI7TnyePdqkmy8Q_i-8o66DHjcotrr-qkF4V38wevTlNz6bK9d8kNSLdhdRRoGUiV9E',
  qi: 'K0RN4kaf-kVUIYwzmZX_1EzndaYCitk4HKLl8h-iJv6QMFuPuiai2NQNbaHeUxIoUFWRDkK9SwOKuZ8pBCKPVOMlqs0a_RZW5s_8gyKkIF1LnNDwK99YHzUTm7Ii9ZngXQEIm1b20ZRmXS6fJA-KvhCohf8KOk4pJxEsyiSXdxs',
};

// ── Seed user IDs (match src/db/seed.ts) ─────────────────────────────────────
const USERS = {
  student:     { sub: '00000000-0000-0000-0000-000000000001', name: 'João Silva',      email: 'joao.silva@alu.ufc.br',   registration: '2023001001', department: 'Ciência da Computação', role: 'ufcim-student' },
  professor:   { sub: '00000000-0000-0000-0000-000000000002', name: 'Dra. Maria Costa', email: 'maria.costa@ufc.br',       registration: '1998010001', department: 'Ciência da Computação', role: 'ufcim-professor' },
  staff:       { sub: '00000000-0000-0000-0000-000000000003', name: 'Carlos Oliveira',  email: 'carlos.oliveira@ufc.br',  registration: '2010005001', department: 'Administração',          role: 'ufcim-staff' },
  maintenance: { sub: '00000000-0000-0000-0000-000000000004', name: 'Pedro Santos',     email: 'pedro.santos@ufc.br',     registration: '2015002001', department: 'Manutenção',              role: 'ufcim-maintenance' },
};

const ISSUER = 'http://localhost:8787';

async function main() {
  const role = process.argv[2] ?? 'student';

  if (!USERS[role]) {
    console.error(`Unknown role "${role}". Valid roles: ${Object.keys(USERS).join(', ')}`);
    process.exit(1);
  }

  const user = USERS[role];
  const privateKey = await importJWK(PRIVATE_JWK, 'RS256');

  const token = await new SignJWT({
    sub: user.sub,
    name: user.name,
    email: user.email,
    preferred_username: user.registration,
    registration: user.registration,
    department: user.department,
    realm_access: { roles: [user.role] },
    iss: ISSUER,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'ufcim-dev-key-1' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setExpirationTime('24h')
    .sign(privateKey);

  console.log(`\n── ${role.toUpperCase()} token (valid 24h) ──`);
  console.log(token);
  console.log(`\nUsage:\n  Authorization: Bearer ${token.slice(0, 40)}…`);
}

main().catch((err) => { console.error(err); process.exit(1); });
