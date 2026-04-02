# UFCIM — Technical Design Document (TDD)

> **Project:** UFCIM — Federal University of Ceará Infrastructure Manager
> **Author:** Abner Augusto
> **Status:** In Progress
> **Last Updated:** 2026-04-02 (Phase 6)
> **Version:** 1.0

---

## 1. Executive Summary

UFCIM is a web application for managing and reserving physical spaces (classrooms, study rooms, auditoriums) at UFC. It provides role-based access for students, professors, administrative staff, and maintenance personnel.

The system is built as a **portable API** using Hono + Drizzle ORM, prototyped on **Cloudflare Workers + D1**, and designed for zero-rewrite migration to a **university server running Node.js + PostgreSQL**.

---

## 2. Architecture Overview

### 2.1 System Diagram

```
┌──────────────────────────────────────────────────────────┐
│                     CLIENT LAYER                         │
│  ┌─────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │ Admin SPA   │  │ End-User SPA    │  │ Mobile App  │  │
│  │ (HTMX/React)│  │ (Future)        │  │ (Future)    │  │
│  └──────┬──────┘  └───────┬─────────┘  └──────┬──────┘  │
└─────────┼─────────────────┼────────────────────┼─────────┘
          │                 │                    │
          ▼                 ▼                    ▼
┌──────────────────────────────────────────────────────────┐
│                   API GATEWAY LAYER                      │
│  ┌────────────────────────────────────────────────────┐  │
│  │              Hono Router (/api/v1/*)                │  │
│  │  ┌──────┐  ┌──────┐  ┌──────────┐  ┌───────────┐  │  │
│  │  │ CORS │→ │Logger│→ │JWT Auth  │→ │RBAC Guard │  │  │
│  │  └──────┘  └──────┘  └──────────┘  └───────────┘  │  │
│  └────────────────────────┬───────────────────────────┘  │
└───────────────────────────┼──────────────────────────────┘
                            │
┌───────────────────────────┼──────────────────────────────┐
│                   SERVICE LAYER                          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐  │
│  │ Reservation  │ │   Space      │ │   Blocking       │  │
│  │ Service      │ │   Service    │ │   Service        │  │
│  ├──────────────┤ ├──────────────┤ ├──────────────────┤  │
│  │ Equipment    │ │ Notification │ │   Audit Log      │  │
│  │ Service      │ │ Service      │ │   Service        │  │
│  ├──────────────┤ ├──────────────┤ ├──────────────────┤  │
│  │   User       │ │              │ │                  │  │
│  │   Service    │ │              │ │                  │  │
│  └──────┬───────┘ └──────┬───────┘ └───────┬──────────┘  │
└─────────┼────────────────┼─────────────────┼─────────────┘
          │                │                 │
          ▼                ▼                 ▼
┌──────────────────────────────────────────────────────────┐
│                   DATA LAYER                             │
│  ┌────────────────────────────────────────────────────┐  │
│  │            Drizzle ORM (Schema + Queries)          │  │
│  └────────────────────────┬───────────────────────────┘  │
│                           │                              │
│  ┌────────────────────────┴───────────────────────────┐  │
│  │  Cloudflare D1 (SQLite)  │  PostgreSQL (Prod)      │  │
│  │  ← prototype             │  ← university server    │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 2.2 Runtime Targets

| Aspect | Prototype | Production |
|--------|-----------|------------|
| Runtime | Cloudflare Workers (V8) | Node.js 20+ (Docker) |
| Database | D1 (SQLite) | PostgreSQL 15+ |
| Auth | Stateless JWT (JWKS) | Keycloak + LDAP + JWT |
| Email | Deferred (web UI only) | SMTP via nodemailer |
| Entry point | `src/index.ts` (Workers) | `src/index.node.ts` (Node) |
| DB driver | `drizzle-orm/d1` | `drizzle-orm/postgres-js` |

### 2.3 Migration Strategy

The codebase is designed so that migrating from Workers to the university server requires changes to exactly **3 files**:

1. `drizzle.config.ts` — change dialect from `sqlite` to `postgresql`
2. `src/db/client.ts` — swap D1 driver for postgres-js driver
3. Entry point — use `src/index.node.ts` instead of `src/index.ts`

All routes, services, middleware, validators, and schema definitions remain untouched.

---

## 3. Data Model

### 3.1 Entity-Relationship Summary

```
users ──< reservations >── spaces
users ──< blockings >───── spaces
users ──< notifications
users ──< audit_logs
spaces ──< equipment
recurrences ──< reservations
```

### 3.2 Tables

| Table | Primary Key | Key Fields | Notes |
|-------|-------------|------------|-------|
| `users` | UUID | registration (unique), email (unique), role | Synced from Keycloak JWT on first login |
| `spaces` | UUID | number, type, block, campus, department, capacity | No `status` column — derived from reservations/blockings |
| `equipment` | UUID | space_id (FK), name, type, status | Status updated by staff/maintenance only |
| `reservations` | UUID | space_id (FK), user_id (FK), date, time_slot, status | Unique on (space, date, slot, status=confirmed) |
| `recurrences` | UUID | description, created_by (FK) | Groups recurring reservations |
| `blockings` | UUID | space_id (FK), date, time_slot, block_type, status | Cancels conflicting reservations on creation |
| `notifications` | UUID | user_id (FK), title, message, type, read | Web UI display; email deferred to production |
| `audit_logs` | UUID | user_id (FK), action_type, reference_id, reference_type | Immutable append-only log |

### 3.3 Design Decisions

| Decision | Rationale |
|----------|-----------|
| No `status` column on `spaces` | Derived data is a sync bug magnet — compute from reservations/blockings instead |
| `reference_type` on `audit_logs` | Discriminator column makes polymorphic `reference_id` queryable |
| Enums as `text` with app validation | D1 (SQLite) has no native ENUM — validate via Zod at service layer |
| ISO text timestamps | Portable across SQLite and PostgreSQL without driver-specific handling |
| Soft delete via `status` fields | Reservations use `canceled`; blockings use `removed`; never hard delete |

---

## 4. Role & Permission Matrix

| Action | Student | Professor | Staff | Maintenance |
|--------|---------|-----------|-------|-------------|
| Reserve spaces | ✅ (1 active max) | ✅ | ✅ | ❌ |
| Cancel own reservations | ✅ | ✅ | ✅ | ❌ |
| Cancel others' reservations | ❌ | ✅ | ✅ | ❌ |
| Create recurring reservations | ❌ | ✅ | ✅ | ❌ |
| Block spaces | ❌ | ✅ (admin) | ✅ (admin) | ✅ (maintenance) |
| Remove blockings | ❌ | ✅ | ✅ | ✅ |
| Manage equipment status | ❌ | ❌ | ✅ | ✅ |
| View all reservations | ✅ | ✅ | ✅ | ✅ |
| View audit logs | ❌ | ❌ | ✅ | ❌ |
| Manage users | ❌ | ❌ | ✅ | ❌ |

---

## 5. API Design

### 5.1 Base URL

- Prototype: `https://ufcim.<account>.workers.dev/api/v1`
- Production: `https://ufcim.ufc.br/api/v1`

### 5.2 Authentication

All endpoints except `GET /health` require `Authorization: Bearer <jwt>`.

### 5.3 Endpoints

| # | Method | Path | Auth | Roles | Description |
|---|--------|------|------|-------|-------------|
| 1 | `GET` | `/health` | No | — | Health check |
| 2 | `GET` | `/users` | Yes | staff | List users (paginated) |
| 3 | `GET` | `/users/me` | Yes | Any | Current user profile |
| 4 | `POST` | `/spaces` | Yes | staff | Create space |
| 5 | `GET` | `/spaces` | Yes | Any | List spaces (filtered) |
| 6 | `GET` | `/spaces/:id` | Yes | Any | Space details + equipment |
| 7 | `GET` | `/spaces/:id/availability` | Yes | Any | Slot availability for date |
| 8 | `PUT` | `/spaces/:id` | Yes | staff | Update space |
| 9 | `POST` | `/equipment` | Yes | staff, maint. | Create equipment |
| 10 | `PATCH` | `/equipment/:id/status` | Yes | staff, maint. | Update equipment status |
| 11 | `GET` | `/equipment/space/:spaceId` | Yes | Any | Equipment for space |
| 12 | `POST` | `/reservations` | Yes | stu, prof, staff | Create reservation |
| 13 | `POST` | `/reservations/recurring` | Yes | prof, staff | Create recurring series |
| 14 | `PATCH` | `/reservations/:id/cancel` | Yes | stu, prof, staff | Cancel reservation |
| 15 | `GET` | `/reservations/space/:spaceId` | Yes | Any | Reservations for space |
| 16 | `GET` | `/reservations/mine` | Yes | Any | User's reservations |
| 17 | `POST` | `/blockings` | Yes | prof, staff, maint. | Create blocking |
| 18 | `PATCH` | `/blockings/:id/remove` | Yes | prof, staff, maint. | Remove blocking |
| 19 | `GET` | `/blockings/space/:spaceId` | Yes | Any | Blockings for space |
| 20 | `GET` | `/notifications` | Yes | Any | User's notifications |
| 21 | `PATCH` | `/notifications/:id/read` | Yes | Any | Mark as read |
| 22 | `PATCH` | `/notifications/read-all` | Yes | Any | Mark all read |
| 23 | `GET` | `/logs` | Yes | staff | Audit logs (filtered) |

### 5.4 Standard Response Format

**Success:**
```json
{
  "id": "uuid",
  "...": "..."
}
```

**List (paginated):**
```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 85
  }
}
```

**Error:**
```json
{
  "error": "Human-readable message",
  "code": "MACHINE_CODE",
  "details": [
    { "field": "date", "message": "Date cannot be in the past" }
  ]
}
```

### 5.5 HTTP Status Codes

| Code | Usage |
|------|-------|
| 200 | Success (GET, PATCH) |
| 201 | Created (POST) |
| 400 | Validation error / business rule violation |
| 401 | Missing or invalid JWT |
| 403 | Role not authorized |
| 404 | Resource not found |
| 409 | Conflict (slot taken, duplicate blocking) |
| 500 | Internal error |

---

## 6. Security

| Concern | Approach |
|---------|----------|
| Authentication | JWT verified via JWKS (RS256) on every request |
| Authorization | RBAC middleware checks role before handler executes |
| Input validation | Zod schemas validate all request bodies and query params |
| SQL injection | Drizzle ORM uses parameterized queries exclusively |
| CORS | Configured per-environment (restrictive in production) |
| Rate limiting | Cloudflare Workers built-in (prototype); nginx/Traefik (production) |
| Department scoping | Students can only interact with spaces in their department |
| Audit trail | All mutations logged to `audit_logs` table |

---

## 7. Monitoring & Operations

### 7.1 Prototype (Workers)

- Cloudflare Workers Analytics for request metrics
- `console.log` → Workers Logs
- D1 metrics via Cloudflare dashboard
- Health check endpoint for uptime monitoring

### 7.2 Production (University Server)

- Structured JSON logging to stdout (Docker best practice)
- Prometheus metrics endpoint (optional)
- PostgreSQL monitoring via `pg_stat_*` views
- Nightly `pg_dump` backups to mounted volume
- Container health checks in Docker Compose
- Reverse proxy (Traefik/Nginx) access logs

---

## 8. Progress Tracker

### Phase 1: Foundation

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1.1 | Project scaffolding (dirs, configs, deps) | ✅ Done | npm init, hono/drizzle-orm/zod/jose/wrangler |
| 1.2 | TypeScript + Wrangler configuration | ✅ Done | tsconfig.json, wrangler.toml, drizzle.config.ts |
| 1.3 | D1 database creation | ⬜ Not Started | Run `wrangler d1 create ufcim-db` and update wrangler.toml |
| 1.4 | Drizzle schema definition | ✅ Done | All 8 tables + relations in src/db/schema.ts |
| 1.5 | Generate and apply initial migration | ✅ Done | migrations/0000_lazy_wallow.sql generated |
| 1.6 | Database client factory | ✅ Done | src/db/client.ts with D1 driver |
| 1.7 | Seed data script | ✅ Done | src/db/seed.ts with 4 users, 3 spaces, 2 equipment |

### Phase 2: Middleware & Auth

| # | Task | Status | Notes |
|---|------|--------|-------|
| 2.1 | JWT auth middleware | ✅ Done | jose JWKS verification (RS256) |
| 2.2 | RBAC middleware | ✅ Done | Keycloak realm_access → app role |
| 2.3 | Zod validation middleware (body) | ✅ Done | validate() — Zod v4 .issues |
| 2.4 | Zod validation middleware (query) | ✅ Done | validateQuery() |
| 2.5 | Global error handler | ✅ Done | AppError, NotFoundError, ConflictError, ForbiddenError, UnauthorizedError |
| 2.6 | CORS configuration | ✅ Done | hono/cors + logger wired in app.ts |

### Phase 3: Validation Schemas

| # | Task | Status | Notes |
|---|------|--------|-------|
| 3.1 | Common schemas (pagination, date, UUID) | ✅ Done | uuidSchema, paginationSchema, timeSlotSchema, dateSchema, futureDateSchema |
| 3.2 | Reservation schemas | ✅ Done | create, createRecurring (with cross-field refine), update |
| 3.3 | Space schemas | ✅ Done | create, update (partial), spaceQuerySchema with filters |
| 3.4 | Equipment schemas | ✅ Done | create, updateStatus |
| 3.5 | Blocking schemas | ✅ Done | create (blockType enum) |

### Phase 4: Services (Business Logic)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 4.1 | User service (sync from JWT, CRUD) | ✅ Done | syncFromToken upserts via onConflictDoUpdate |
| 4.2 | Space service (CRUD, availability) | ✅ Done | getAvailability queries reservations + blockings |
| 4.3 | Equipment service (CRUD, status) | ✅ Done | updateStatus sets updatedBy |
| 4.4 | Reservation service (create, cancel, list) | ✅ Done | student limit, dept check, cascade notify |
| 4.5 | Recurring reservation logic | ✅ Done | generateRecurringDates, skips conflicts |
| 4.6 | Blocking service (create, remove, cascade) | ✅ Done | overrides confirmed reservations, notifies user |
| 4.7 | Notification service (create, list, read) | ✅ Done | markAsRead with ownership check |
| 4.8 | Audit log service | ✅ Done | append-only log, filterable list |

### Phase 5: Routes

| # | Task | Status | Notes |
|---|------|--------|-------|
| 5.1 | App definition + health check | ✅ Done | CORS, logger, globalErrorHandler, syncFromToken middleware |
| 5.2 | Workers entry point | ✅ Done | src/index.ts re-exports app |
| 5.3 | User routes | ✅ Done | GET /users (staff), GET /users/me |
| 5.4 | Space routes | ✅ Done | CRUD + GET /:id/availability (computed) |
| 5.5 | Equipment routes | ✅ Done | POST, PATCH /:id/status, GET /space/:spaceId |
| 5.6 | Reservation routes | ✅ Done | create, recurring, cancel, mine, by-space |
| 5.7 | Blocking routes | ✅ Done | create, remove, by-space |
| 5.8 | Notification routes | ✅ Done | list, read-all (static before /:id), mark-read |
| 5.9 | Log routes | ✅ Done | GET /logs (staff only, filterable) |

### Phase 6: Testing & Deployment

| # | Task | Status | Notes |
|---|------|--------|-------|
| 6.1 | Local dev testing with `wrangler dev` | ✅ Done | .dev.vars + GET /dev/jwks serves test JWKS |
| 6.2 | Seed data applied and verified | ✅ Done | scripts/seed.sql applied to local D1 |
| 6.3 | All endpoints tested with sample JWT | ✅ Done | tests/endpoints.http covers all 23 endpoints |
| 6.4 | Role/permission matrix fully enforced | ✅ Done | rbac() middleware on every protected route |
| 6.4b | Unit test suite (Vitest) | ✅ Done | 89 tests: middleware, validators, services — run with `npm test`. Every new feature must include tests. |
| 6.5 | Admin dashboard local dev setup | ✅ Done | Dev auth bypass, local D1 seed data, staff-only HTMX admin served from same Hono app |
| 6.6 | Deploy to Cloudflare Workers | ⬜ Not Started | Run: npx wrangler deploy |
| 6.7 | Remote D1 migration applied | ⬜ Not Started | Run: npx wrangler d1 execute ufcim-db --remote --file=migrations/0000_lazy_wallow.sql |
| 6.8 | End-to-end smoke test on Workers | ⬜ Not Started | Update JWKS_URL in wrangler.toml to real Keycloak before deploy |

### Phase 6.5: Admin Dashboard

| # | Task | Status | Notes |
|---|------|--------|-------|
| 6.5.1 | Local development auth bypass | ✅ Done | Development-only mock staff user injected when Authorization header is absent |
| 6.5.2 | Staff stats endpoint | ✅ Done | GET /api/v1/stats returns dashboard summary counts |
| 6.5.3 | Admin SPA shell served by Hono | ✅ Done | /admin and subviews render a Tailwind + HTMX + Alpine shell |
| 6.5.4 | Spaces management view | ✅ Done | List, detail, availability, create, and update flows |
| 6.5.5 | Reservations operations view | ✅ Done | Filterable table with grouped recurring series and cancel action |
| 6.5.6 | Blockings operations view | ✅ Done | Active list, create form, and remove action |
| 6.5.7 | Equipment operations view | ✅ Done | Grouped-by-space listing with inline status updates |
| 6.5.8 | Users and audit logs views | ✅ Done | Read-only users table and filterable paginated logs |

### Phase 7: Production Migration (Future)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 7.1 | Swap Drizzle dialect to PostgreSQL | ⬜ Not Started | |
| 7.2 | Swap DB client to postgres-js | ⬜ Not Started | |
| 7.3 | Node.js entry point | ⬜ Not Started | |
| 7.4 | PostgreSQL migrations generated & applied | ⬜ Not Started | |
| 7.5 | Data export from D1 + import to PostgreSQL | ⬜ Not Started | |
| 7.6 | Keycloak + LDAP integration | ⬜ Not Started | |
| 7.7 | SMTP notifications enabled | ⬜ Not Started | |
| 7.8 | Docker Compose + reverse proxy | ⬜ Not Started | |
| 7.9 | Backup strategy (pg_dump nightly) | ⬜ Not Started | |
| 7.10 | Production smoke test | ⬜ Not Started | |

---

## 9. Risk Register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| D1 → PostgreSQL data type mismatches | Medium | High | Use only portable types; test migration early with sample data |
| D1 row/size limits hit during prototype | Low | Low | Scale is ~200 users, well within D1 limits |
| Keycloak JWT claims don't include role/dept | Medium | Medium | Map claims in auth middleware; document required Keycloak config |
| Concurrent reservation conflicts | High | Medium | Database-level unique constraint on (space, date, slot, status) |
| Workers cold start latency | Low | Medium | Acceptable for internal university app; not user-facing at scale |
| Schema drift between D1 and PostgreSQL | Medium | Medium | Single Drizzle schema; test both dialects in CI |

---

## 10. Appendix

### A. Technology References

- Hono: https://hono.dev
- Drizzle ORM: https://orm.drizzle.team
- Cloudflare Workers: https://developers.cloudflare.com/workers
- Cloudflare D1: https://developers.cloudflare.com/d1
- Zod: https://zod.dev
- jose (JWT): https://github.com/panva/jose

### B. Related Documents

- `UFCIM_Build_Guide.md` — Step-by-step AI agent instructions
- Original Flask design doc — `design_md_-_UFCIM_Design_and_Architecture_Document.md`
- Database design — `requirements_md_-_UFCIM_Database_Design__English_.md`

### C. Glossary

| Term | Definition |
|------|-----------|
| D1 | Cloudflare's serverless SQLite database |
| Drizzle | TypeScript ORM supporting multiple SQL dialects |
| Hono | Lightweight web framework for Workers/Node.js/Deno/Bun |
| JWKS | JSON Web Key Set — public keys for JWT verification |
| RBAC | Role-Based Access Control |
| Time Slot | One of: morning, afternoon, evening |
| Recurrence | A group of reservations on the same weekday over a date range |
