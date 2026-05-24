# ufcim-backend-proto

API REST do sistema **UFCIM** (Gerenciador de Infraestrutura da UFC), construída para gerenciar reservas de espaços, bloqueios, equipamentos e usuários nos campi da Universidade Federal do Ceará.

> **Escopo atual:** MVP focado no departamento IAUD, campus Benfica.

---

## Stack Tecnológica

| Camada | Tecnologia |
|---|---|
| Runtime | Cloudflare Workers (V8 isolate) |
| Framework HTTP | [Hono](https://hono.dev/) v4 |
| ORM | [Drizzle ORM](https://orm.drizzle.team/) |
| Banco de dados | Cloudflare D1 (SQLite) |
| Validação | Zod v4 |
| Auth (produção) | Keycloak JWT (RS256, JWKS) |
| Auth (dev) | `devAuthMiddleware` — tokens RSA locais |
| Testes | Vitest |
| Deploy | `wrangler deploy` |

---

## Arquitetura

```
src/
├── index.ts              # Entry point de produção
├── index.dev.ts          # Entry point de desenvolvimento (injeta devAuthMiddleware + devRoutes)
├── app.ts                # Composição da aplicação (rotas, middlewares, CORS, admin shell)
│
├── db/
│   ├── schema.ts         # Definição completa do schema Drizzle (todas as tabelas)
│   └── client.ts         # Factory createDb(d1) — instancia o ORM por requisição
│
├── routes/               # Handlers HTTP — uma instância Hono por recurso
│   ├── auth.ts           # Login, refresh, logout, convites
│   ├── bootstrap.ts      # Seed inicial do sistema
│   ├── users.ts          # CRUD de usuários
│   ├── spaces.ts         # CRUD de espaços
│   ├── space-managers.ts # Vínculos coordenador/mantenedor por espaço
│   ├── equipment.ts      # Equipamentos vinculados a espaços
│   ├── reservations.ts   # Criação, cancelamento e listagem de reservas
│   ├── blockings.ts      # Bloqueios de espaço com cancelamento em cascata
│   ├── notifications.ts  # Notificações in-app
│   ├── departments.ts    # Gerenciamento de departamentos
│   ├── stats.ts          # Dashboard de estatísticas (staff only)
│   ├── logs.ts           # Audit log (staff only)
│   └── admin.ts          # Partials HTMX para o admin shell
│
├── services/             # Lógica de negócio — chamada pelas rotas
│   ├── auth.service.ts
│   ├── user.service.ts
│   ├── space.service.ts
│   ├── reservation.service.ts
│   ├── blocking.service.ts
│   ├── equipment.service.ts
│   ├── notification.service.ts
│   ├── audit-log.service.ts
│   ├── stats.service.ts
│   └── department.service.ts
│
├── middleware/
│   ├── auth.ts           # Verificação JWT via JWKS (jose)
│   ├── rbac.ts           # Controle de acesso por papel (extractRole, rbac(), requireMasterAdmin())
│   ├── validation.ts     # validate() e validateQuery() com Zod
│   └── error-handler.ts  # Handler global + classes de erro tipadas
│
├── lib/
│   └── schedule.ts       # buildHourlyAvailability(), intervalsOverlap(), overlapsClosedHours()
│
├── validators/           # Schemas Zod reutilizáveis
│   ├── reservation.schema.ts
│   └── common.schema.ts
│
├── types/
│   ├── auth.ts           # JwtPayload, UserRole
│   └── env.ts            # Env (bindings do Worker), AppVariables, AppEnv
│
└── admin/                # Admin shell — HTML gerado server-side (HTMX)
    ├── admin-shell.ts
    └── admin-login.ts
```

---

## Modelo de Dados

### Tabelas principais

```
departments          – Departamentos da UFC (id slug, campus, nome)
users                – Usuários sincronizados do Keycloak (roles: student | professor | staff | maintenance)
spaces               – Espaços físicos (salas, auditórios, etc.)
  └── closedFrom/closedTo  – Horários de fechamento
  └── modelId              – Vínculo com pino 3D no frontend
equipment            – Equipamentos vinculados a espaços
space_managers       – Vínculo usuário ↔ espaço (roles: coordinator | maintainer)
reservations         – Reservas confirmadas/canceladas
  └── startTime/endTime    – Formato "HH:00" (horários cheios)
  └── timeSlot             – Campo legado derivado (mantido para compatibilidade)
recurrences          – Cabeçalhos de séries recorrentes
blockings            – Bloqueios administrativos de espaço
notifications        – Notificações in-app (lida/não lida)
audit_logs           – Registro imutável de ações do sistema
refresh_tokens       – Tokens opacos de refresh (chain revocation)
invitations          – Convites de cadastro via link
```

### Modelo de agendamento

Reservas e bloqueios utilizam `startTime`/`endTime` como strings `"HH:00"` (ex: `"08:00"`, `"12:00"`). A disponibilidade horária de um espaço é calculada dinamicamente pela função `buildHourlyAvailability()` em `src/lib/schedule.ts` — o campo `status` **nunca** é armazenado no banco.

**Regra crítica:** Ao criar um bloqueio, o serviço automaticamente cancela e notifica todas as reservas confirmadas que conflitem no mesmo espaço/data/horário.

---

## Rotas da API

Todas as rotas autenticadas ficam sob `/api/v1/`. O middleware `authMiddleware` e `syncUserMiddleware` são aplicados em toda a sub-app.

| Método | Rota | Roles permitidos |
|---|---|---|
| `GET` | `/api/v1/spaces` | Todos |
| `POST` | `/api/v1/spaces` | staff |
| `GET` | `/api/v1/spaces/:id/availability` | Todos |
| `POST` | `/api/v1/reservations` | student, professor, staff |
| `POST` | `/api/v1/reservations/recurring` | professor, staff |
| `PATCH` | `/api/v1/reservations/:id/cancel` | Dono ou staff |
| `POST` | `/api/v1/blockings` | coordinator, staff |
| `GET` | `/api/v1/stats` | staff |
| `GET` | `/api/v1/logs` | staff |
| `POST` | `/api/v1/departments` | staff |
| `GET` | `/api/v1/notifications` | Todos |
| `POST` | `/auth/login` | — |
| `POST` | `/auth/refresh` | — |
| `POST` | `/auth/logout` | — |

### Admin shell

As páginas em `/admin/*` servem esqueletos HTML estáticos carregados via HTMX. As partials são protegidas por `requireMasterAdmin()`.

---

## Autenticação & Autorização

### Fluxo JWT

1. O frontend envia `Authorization: Bearer <token>`.
2. `authMiddleware` valida a assinatura RS256 contra o JWKS configurado em `JWKS_URL`.
3. O payload JWT é armazenado em `c.get('user')` (tipo `JwtPayload`).
4. `syncUserMiddleware` upserta o usuário na tabela `users` a partir das claims do token.
5. Rotas individuais usam `rbac(['professor', 'staff'])` para restringir acesso por papel.

### Mapeamento de papéis (Keycloak → App)

| Realm role Keycloak | Papel no app |
|---|---|
| `ufcim-student` | `student` |
| `ufcim-professor` | `professor` |
| `ufcim-staff` | `staff` |
| `ufcim-maintenance` | `maintenance` |
| `ufcim-master-admin` | flag `isMasterAdmin` |

### Dev auth

Em desenvolvimento (`src/index.dev.ts`), o `devAuthMiddleware` aceita tokens RSA gerados localmente via `scripts/generate-test-token.mjs`. Tokens de teste com UUIDs fixos estão documentados em `tests/endpoints.http`.

---

## Ambientes

O projeto usa dois entry points separados para isolar a superfície de dev em produção:

| Arquivo | Ambiente |
|---|---|
| `src/index.ts` | Produção — apenas `authMiddleware` real |
| `src/index.dev.ts` | Desenvolvimento — injeta `devAuthMiddleware` e rotas `/dev/*` |

Variáveis de ambiente são declaradas em `wrangler.toml` (não sensíveis) e em `.dev.vars` (segredos — não commitado).

```toml
# wrangler.toml (resumo)
[env.dev]
vars = { ENVIRONMENT = "development", JWKS_URL = "http://localhost:8787/dev/jwks", ... }

[env.production]
vars = { ENVIRONMENT = "production", JWT_ISSUER = "ufcim-prototype", ... }
```

---

## Como rodar localmente

### Pré-requisitos
- Node.js 18+
- `wrangler` CLI

### Instalação

```bash
npm install
cp .dev.vars.example .dev.vars   # preencha os segredos
```

### Banco de dados local

```bash
# Aplicar migration
npx wrangler d1 execute ufcim-db --local --file=migrations/0000_lazy_wallow.sql

# Popular com seed de desenvolvimento
npx wrangler d1 execute ufcim-db --local --file=scripts/seed.sql
```

### Servidor de desenvolvimento

```bash
npm run dev   # wrangler dev --env dev
```

### Testes

```bash
npm test          # vitest run
npm run test:watch
```

### Drizzle Studio (inspeção do banco)

```bash
npm run db:studio
```

---

## Deploy

```bash
npm run deploy   # wrangler deploy --env production
```

> **Migração futura:** O projeto está preparado para migrar do Cloudflare Workers + D1 para um servidor universitário. Apenas três arquivos precisam mudar: `drizzle.config.ts` (dialect `sqlite` → `postgresql`), `src/db/client.ts` (driver D1 → node-postgres/libsql) e o entry point.

---

## Segurança

- **CORS** restrito a origens conhecidas por ambiente (`localhost:5173` em dev, `ufcim.pages.dev` em produção).
- **Atomicidade de conflitos:** índices únicos parciais no banco previnem condições de corrida em reservas concorrentes — a verificação não é apenas na camada de aplicação.
- **Secrets** fora do `wrangler.toml` — armazenados via `wrangler secret` em produção.
- **JWKS caching** para evitar chamadas repetidas ao Keycloak.
- **Admin gate** via middleware `requireMasterAdmin()` separado do RBAC de rotas.

---

## Limites de reservas por papel

| Papel | Máx. reservas ativas |
|---|---|
| `student` | 5 |
| `professor` | 10 |
| `staff` | ilimitado |
| `maintenance` | 0 (não pode reservar) |

---

## Estrutura de testes

```
tests/
├── unit/
│   ├── middleware/rbac.test.ts
│   └── lib/schedule.test.ts
└── endpoints.http     # Testes manuais com VS Code REST Client / IntelliJ
```

---

## Roadmap

- [ ] Integração completa com Keycloak JWT em produção
- [ ] Visibilidade de espaços por escopo (atualmente todos os usuários veem todos os espaços)
- [ ] Expansão para outros departamentos e campi além do IAUD/Benfica
- [ ] Integração com monitoramento ambiental IoT (Zigbee2MQTT + Raspberry Pi)
