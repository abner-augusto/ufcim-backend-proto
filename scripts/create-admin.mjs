/**
 * Bootstraps the first master-admin account and prints a fresh access token
 * ready to log into the admin dashboard. Works against any environment — local
 * `wrangler dev` or the deployed worker — by reading its target from env vars.
 *
 * It only calls public HTTP endpoints (POST /bootstrap/master-admin → POST
 * /auth/login), so it never touches the database directly. Production uses the
 * same HS256 token flow as local (src/middleware/auth-local.ts), so the token
 * this prints is accepted by the deployed admin dashboard.
 *
 * Config (env vars; CLI defaults target local dev):
 *   UFCIM_BASE_URL          default http://localhost:8787
 *   UFCIM_BOOTSTRAP_TOKEN   default dev-bootstrap-token   (must match the worker secret)
 *   UFCIM_ADMIN_EMAIL       default admin@ufcim.dev
 *   UFCIM_ADMIN_PASSWORD    default Admin@dev1234         (min 8 chars, ≥1 letter + ≥1 digit)
 *   UFCIM_ADMIN_NAME        default Master Admin
 *   UFCIM_ADMIN_DEPARTMENT  default iaud  (MUST be an existing departments.id slug)
 *
 * Local:
 *   npm run dev:admin
 *
 * Deployed (one-time, after `wrangler secret put JWT_SIGNING_SECRET/BOOTSTRAP_TOKEN`
 * and seeding departments into the remote D1):
 *   UFCIM_BASE_URL=https://ufcim-production.abner-hey.workers.dev \
 *   UFCIM_BOOTSTRAP_TOKEN=<the secret you set> \
 *   UFCIM_ADMIN_EMAIL=you@ufc.br UFCIM_ADMIN_PASSWORD='a-strong-password-10+' \
 *   node scripts/create-admin.mjs
 *
 * ⚠️  The bootstrap endpoint only works once per environment (it refuses if a
 *     master admin already exists). Delete BOOTSTRAP_TOKEN afterwards.
 */

const DEV_DEFAULTS = {
  baseUrl: 'http://localhost:8787',
  bootstrapToken: 'dev-bootstrap-token',
  password: 'Admin@dev1234',
};

const config = {
  baseUrl: (process.env.UFCIM_BASE_URL ?? DEV_DEFAULTS.baseUrl).replace(/\/$/, ''),
  bootstrapToken: process.env.UFCIM_BOOTSTRAP_TOKEN ?? DEV_DEFAULTS.bootstrapToken,
  admin: {
    email: process.env.UFCIM_ADMIN_EMAIL ?? 'admin@ufcim.dev',
    name: process.env.UFCIM_ADMIN_NAME ?? 'Master Admin',
    department: process.env.UFCIM_ADMIN_DEPARTMENT ?? 'iaud',
    password: process.env.UFCIM_ADMIN_PASSWORD ?? DEV_DEFAULTS.password,
  },
};

function isLocal(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

/** Refuse to ship dev-default credentials/tokens to a remote host. */
function guardRemote() {
  if (isLocal(config.baseUrl)) return;

  const problems = [];
  if (config.bootstrapToken === DEV_DEFAULTS.bootstrapToken) {
    problems.push('UFCIM_BOOTSTRAP_TOKEN is still the dev default — set it to the worker secret.');
  }
  if (config.admin.password === DEV_DEFAULTS.password) {
    problems.push('UFCIM_ADMIN_PASSWORD is still the dev default — set a strong password.');
  }
  if (problems.length > 0) {
    console.error(`Refusing to target a remote host (${config.baseUrl}) with dev defaults:`);
    for (const p of problems) console.error(`  • ${p}`);
    process.exit(1);
  }
}

async function createAdmin() {
  const res = await fetch(`${config.baseUrl}/bootstrap/master-admin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Bootstrap-Token': config.bootstrapToken,
    },
    body: JSON.stringify(config.admin),
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
  const res = await fetch(`${config.baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: config.admin.email, password: config.admin.password }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Falha no login (${res.status}): ${body}`);
  }

  const { accessToken } = await res.json();
  return accessToken;
}

async function main() {
  guardRemote();
  console.log(`Target: ${config.baseUrl}${isLocal(config.baseUrl) ? ' (local)' : ''}`);

  await createAdmin();
  const token = await login();

  console.log('\n── MASTER ADMIN (token válido 15 min) ──');
  console.log(`Email:    ${config.admin.email}`);
  if (config.admin.password === DEV_DEFAULTS.password) {
    console.log(`Senha:    ${config.admin.password}`);
  }
  console.log(`\nAccess token:\n${token}`);
  console.log(`\nAdmin dashboard: ${config.baseUrl}/admin`);
  console.log('(Faça login pelo formulário; o token acima é para chamadas diretas à API.)');
}

main().catch((err) => { console.error(err.message); process.exit(1); });
