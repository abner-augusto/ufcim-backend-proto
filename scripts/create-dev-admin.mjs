/**
 * Creates (or reuses) a deterministic master-admin account for local dev and
 * prints a fresh access token ready to paste into the admin dashboard.
 *
 * Prerequisites:
 *   1. Copy .dev.vars.example → .dev.vars
 *   2. Start the worker: npm run dev
 *
 * Usage:
 *   node scripts/create-dev-admin.mjs
 *
 * ⚠️  DEV ONLY — never use these credentials in production.
 */

const BASE_URL = 'http://localhost:8787';
const BOOTSTRAP_TOKEN = 'dev-bootstrap-token';

const ADMIN = {
  email: 'admin@ufcim.dev',
  name: 'Master Admin',
  department: 'Administração',
  password: 'Admin@dev1234',
};

async function createAdmin() {
  const res = await fetch(`${BASE_URL}/bootstrap/master-admin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Bootstrap-Token': BOOTSTRAP_TOKEN,
    },
    body: JSON.stringify(ADMIN),
  });

  if (res.ok) {
    const { userId } = await res.json();
    console.log(`✓ Master admin criado (id: ${userId})`);
    return;
  }

  if (res.status === 409) {
    console.log('✓ Master admin já existe — usando conta existente');
    return;
  }

  const body = await res.text();
  throw new Error(`Falha ao criar master admin (${res.status}): ${body}`);
}

async function login() {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN.email, password: ADMIN.password }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Falha no login (${res.status}): ${body}`);
  }

  const { accessToken } = await res.json();
  return accessToken;
}

async function main() {
  await createAdmin();
  const token = await login();

  console.log('\n── MASTER ADMIN (válido 15 min) ──');
  console.log(`Email:    ${ADMIN.email}`);
  console.log(`Senha:    ${ADMIN.password}`);
  console.log(`\nAccess token:\n${token}`);
  console.log(`\nUsage:\n  Authorization: Bearer ${token.slice(0, 40)}…`);
  console.log(`\nAdmin dashboard: ${BASE_URL}/admin`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
