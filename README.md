# ufcim-backend-proto

API REST do sistema **UFCIM** (Gerenciador de Infraestrutura da UFC): reservas de
espaços, bloqueios, equipamentos e usuários nos campi da Universidade Federal do
Ceará. Construída em Cloudflare Workers + Hono + Drizzle + D1.

> **Escopo atual:** MVP focado no departamento **IAUD**, campus Benfica.

---

## Documentação

Este README é só visão geral + quickstart. O detalhe vive em `docs/`:

- **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** — stack, estrutura de pastas,
  modelo de dados, rotas, autenticação/RBAC, ambientes e postura de segurança.
- **[`docs/ROADMAP.md`](docs/ROADMAP.md)** — trabalho futuro e itens sob gatilho.
- **[`docs/adr/`](docs/adr/)** — registros de decisão de arquitetura (ADRs).
- **[`CLAUDE.md`](CLAUDE.md)** — notas operacionais do POC (contas, bancos, slugs).
- **[`plans/`](plans/)** — planos de implementação prontos para execução.

## Stack

Cloudflare Workers (V8) · [Hono](https://hono.dev/) v4 · [Drizzle ORM](https://orm.drizzle.team/)
· Cloudflare D1 (SQLite) · Zod v4 · Vitest · deploy via `wrangler`.
Auth: Keycloak JWT (RS256/JWKS) em produção; `devAuthMiddleware` em dev.

## Quickstart

Pré-requisitos: Node.js 18+ (o `wrangler` vem como devDependency).

```bash
npm install
cp .dev.vars.example .dev.vars   # preencha os segredos (JWT_SIGNING_SECRET é obrigatório)
```

### Banco local (D1)

O binding `DB` é declarado por ambiente em `wrangler.toml`, então **toda chamada
precisa de `--env dev`** (ou `--env production`). Dev usa `ufcim-db-dev`;
produção usa `ufcim-db` — instâncias D1 distintas.

```bash
# 1) migration consolidada
npx wrangler d1 execute ufcim-db-dev --local --env dev --file=migrations/0000_init.sql
# 2a) seed baseline (departments + spaces + equipment do IAUD) — seguro em prod
npx wrangler d1 execute ufcim-db-dev --local --env dev --file=scripts/seed.sql
# 2b) seed dev-only (usuários de teste + reservas/blockings de exemplo) — NÃO em prod
npx wrangler d1 execute ufcim-db-dev --local --env dev --file=scripts/seed_dev.sql
```

Para resetar: apague `.wrangler/` e reaplique migration + seeds. Para uma
migration nova, edite `src/db/schema.ts` e rode `npm run db:generate`.

### Servidor de dev, testes, deploy

```bash
npm run dev          # wrangler dev --env dev (http://localhost:8787)
npm test             # vitest run
npm run typecheck    # tsc --noEmit
npm run deploy       # wrangler deploy --env production
```

Em dev, `devAuthMiddleware` injeta um usuário staff em requisições sem
`Authorization`. Para outros papéis:
`node scripts/generate-test-token.mjs professor` e envie `Authorization: Bearer <token>`.
Detalhes de auth, rotas e modelo de dados em
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
