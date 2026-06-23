# Arquitetura — UFCIM backend

Documento de referência da arquitetura, modelo de dados e convenções do
`ufcim-backend-proto`. O `README.md` na raiz é só visão geral + quickstart; o
detalhe vive aqui. Decisões com trade-offs ficam em `docs/adr/`; o que ainda
não foi construído fica em `docs/ROADMAP.md`.

> **Escopo atual:** MVP focado no departamento **IAUD**, campus Benfica.
> Veja as notas de POC em `CLAUDE.md`.

---

## Stack tecnológica

| Camada | Tecnologia |
|---|---|
| Runtime | Cloudflare Workers (isolate V8) |
| Framework HTTP | [Hono](https://hono.dev/) v4 |
| ORM | [Drizzle ORM](https://orm.drizzle.team/) |
| Banco de dados | Cloudflare D1 (SQLite) |
| Validação | Zod v4 |
| Auth (produção) | Keycloak JWT (RS256, JWKS) |
| Auth (dev) | `devAuthMiddleware` — tokens RSA locais |
| E-mail | Resend (HTTP) — `EmailService` |
| Captcha | Cloudflare Turnstile — `TurnstileService` |
| Testes | Vitest |
| Deploy | `wrangler deploy --env production` |

## Estrutura de pastas

```
src/
├── index.ts / index.dev.ts / index.node.ts   # entry points (prod / dev / node)
├── app.ts                # composição: rotas, CORS, middlewares, admin shell
├── db/
│   ├── schema.ts         # schema Drizzle (todas as tabelas)
│   ├── client.ts         # createDb(d1) — ORM por requisição
│   └── seed.ts
├── routes/               # handlers HTTP — uma instância Hono por recurso
├── services/             # lógica de negócio — chamada pelas rotas
├── middleware/           # auth (JWKS), auth-dev, auth-local, rbac, validation,
│                         #   error-handler, rate-limit
├── lib/                  # schedule, crypto, jwt, email-domain, cleanup, etc.
├── validators/           # schemas Zod reutilizáveis
├── types/                # auth.ts (JwtPayload, UserRole), env.ts (bindings)
└── admin/                # admin shell server-side (HTMX) + views/
```

## Modelo de dados

Definido em `src/db/schema.ts`. Tabelas principais:

```
departments        – slug (PK), nome, campus
users              – sincronizados do Keycloak; roles: student|professor|staff|maintenance
spaces             – espaços físicos; closedFrom/closedTo; modelId (pino 3D)
equipment          – equipamentos vinculados a espaços
equipment_reports  – reportes de equipamentos (pending/acknowledged/resolved/dismissed)
space_managers     – vínculo usuário↔espaço (coordinator|maintainer)
reservations       – reservas; startTime/endTime "HH:00"; timeSlot legado derivado
recurrences        – cabeçalhos de séries recorrentes
blockings          – bloqueios administrativos; cancelam reservas em conflito
notifications      – notificações in-app
audit_logs         – registro imutável de ações
user_credentials   – hash de senha (pbkdf2), failedAttempts, lockedUntil
invitations        – convites/reset via link (tokenHash SHA-256)
invitation_requests– self-service: guest pede acesso, admin aprova
refresh_tokens     – tokens opacos de refresh (chain revocation)
rate_limit_buckets – janelas de rate limit por IP
```

### Modelo de agendamento (grade horária)

Reservas e bloqueios usam `startTime`/`endTime` como strings `"HH:00"` (fim até
`"24:00"`). A disponibilidade é calculada **dinamicamente** por
`buildHourlyAvailability()` em `src/lib/schedule.ts` — o `status` por hora
(`available`/`reserved`/`blocked`/`closed`) **nunca** é persistido. A
sobreposição é semiaberta (`intervalsOverlap`): horários adjacentes não colidem.

**Regra crítica:** ao criar um bloqueio, o serviço cancela e notifica
automaticamente as reservas confirmadas que conflitem no mesmo
espaço/data/horário (status → `overridden`).

**Invariante de ocupação:** reserva é sempre do **espaço inteiro**
(single-occupancy). Espaço divisível é modelado como **espaços distintos**.
Como a não-sobreposição é hoje garantida só na camada de aplicação, veja
`docs/adr/0001-reservation-overlap-enforcement.md` para a estratégia de
enforcement (índice de duplicata exata agora; grade de ocupação sob gatilho;
restrição de exclusão no Postgres).

## Rotas da API

Tudo autenticado fica sob `/api/v1/`, com `authMiddleware` + `syncUserMiddleware`
aplicados em toda a sub-app (`src/app.ts`).

| Método | Rota | Roles |
|---|---|---|
| `GET` | `/api/v1/spaces` | todos |
| `POST` | `/api/v1/spaces` | staff |
| `GET` | `/api/v1/spaces/:id/availability` | todos |
| `POST` | `/api/v1/reservations` | student, professor, staff |
| `POST` | `/api/v1/reservations/recurring` | professor, staff |
| `PATCH` | `/api/v1/reservations/:id/cancel` | dono ou staff |
| `POST` | `/api/v1/blockings` | professor, staff, maintenance |
| `GET` | `/api/v1/reports/occupancy` | professor, staff, maintenance |
| `GET` | `/api/v1/stats` · `/logs` | staff |
| `POST` | `/api/v1/departments` | staff |
| `GET` | `/api/v1/notifications` | todos |
| `POST` | `/auth/login` · `/refresh` · `/logout` | — |
| `POST` | `/auth/request-invitation` | — (Turnstile + rate limit) |
| `*` | `/auth/invitations/:token[...]` | — (preview/accept) |

Páginas `/admin/*` servem esqueletos HTML carregados via HTMX; as partials são
protegidas por `requireMasterAdmin()`.

## Autenticação & autorização

1. Frontend envia `Authorization: Bearer <token>`.
2. `authMiddleware` valida a assinatura RS256 contra o JWKS (`JWKS_URL`).
3. Payload em `c.get('user')` (`JwtPayload`).
4. `syncUserMiddleware` faz upsert do usuário a partir das claims.
5. Rotas usam `rbac(['professor','staff'])`; `requireMasterAdmin()` é um portão
   separado para o admin shell.

Mapeamento Keycloak → app: `ufcim-student|professor|staff|maintenance` →
`student|professor|staff|maintenance`; `ufcim-master-admin` → flag
`isMasterAdmin`. Em dev, `devAuthMiddleware` aceita tokens RSA locais
(`scripts/generate-test-token.mjs`); ver `tests/endpoints.http`.

### RBAC: restrição por departamento

- **Reservas**: `assertDepartmentAccess()` confina **estudantes e professores**
  aos espaços do próprio departamento (`reservation.service.ts`), em `create()` e
  `createRecurring()`. **Staff é isento**; manutenção não reserva (limite `0`).
- **Bloqueios**: `BlockingService.create()` **não** tem checagem de
  departamento; a rota permite `professor`, `staff`, `maintenance`.

### Limites de reservas ativas por papel

| Papel | Máx. ativas |
|---|---|
| student | 5 |
| professor | 10 |
| staff | ilimitado |
| maintenance | 0 |

Séries recorrentes são **isentas** do limite (decisão de produto, 2026-06-23 —
ver `plans/001-recurring-active-limit-exempt.md`).

## Ambientes

Dois entry points isolam a superfície de dev em produção:

| Arquivo | Ambiente |
|---|---|
| `src/index.ts` | produção — só `authMiddleware` real |
| `src/index.dev.ts` | dev — injeta `devAuthMiddleware` + rotas `/dev/*` |

Vars não sensíveis em `wrangler.toml`; segredos via `wrangler secret` (prod) e
`.dev.vars` (local, não commitado). Bancos D1 separados: dev = `ufcim-db-dev`,
prod = `ufcim-db` — toda chamada exige `--env`.

## Postura de segurança

- **CORS** restrito a origens conhecidas por ambiente (`src/app.ts`).
- **Senhas**: pbkdf2 (`src/lib/crypto.ts`); lockout após 5 tentativas por 15 min.
- **Refresh tokens** opacos com hash SHA-256 e revogação em cadeia
  (reuse-detection → revoga a cadeia).
- **Rate limit** por IP em login/refresh/convites (`middleware/rate-limit.ts`).
- **Turnstile** no fluxo público de solicitação de convite.
- **Atomicidade de conflitos**: hoje na camada de aplicação + (após
  `plans/003`) índice único parcial contra duplicata exata. Sobreposição
  *parcial* concorrente ainda não é bloqueada pelo banco — ver ADR 0001.
- **Secrets** nunca em `wrangler.toml`; nunca reproduzidos em docs/planos.

## Como rodar

Quickstart no `README.md`. Resumo: `npm install`, aplicar
`migrations/0000_init.sql` + seeds (`scripts/seed.sql`, `scripts/seed_dev.sql`)
no `ufcim-db-dev --local --env dev`, `npm run dev`. Testes: `npm test`.
Typecheck: `npm run typecheck`.
</content>
