# UFCIM — Technical Design Document (TDD)

> **Project:** UFCIM — Federal University of Ceará Infrastructure Manager
> **Author:** Abner Augusto
> **Status:** In Progress
> **Last Updated:** 2026-03-31
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
| 1.1 | Project scaffolding (dirs, configs, deps) | ⬜ Not Started | |
| 1.2 | TypeScript + Wrangler configuration | ⬜ Not Started | |
| 1.3 | D1 database creation | ⬜ Not Started | |
| 1.4 | Drizzle schema definition | ⬜ Not Started | All 8 tables |
| 1.5 | Generate and apply initial migration | ⬜ Not Started | |
| 1.6 | Database client factory | ⬜ Not Started | D1 driver |
| 1.7 | Seed data script | ⬜ Not Started | |

### Phase 2: Middleware & Auth

| # | Task | Status | Notes |
|---|------|--------|-------|
| 2.1 | JWT auth middleware | ⬜ Not Started | JWKS verification |
| 2.2 | RBAC middleware | ⬜ Not Started | Role extraction from JWT |
| 2.3 | Zod validation middleware (body) | ⬜ Not Started | |
| 2.4 | Zod validation middleware (query) | ⬜ Not Started | |
| 2.5 | Global error handler | ⬜ Not Started | Custom error classes |
| 2.6 | CORS configuration | ⬜ Not Started | |

### Phase 3: Validation Schemas

| # | Task | Status | Notes |
|---|------|--------|-------|
| 3.1 | Common schemas (pagination, date, UUID) | ⬜ Not Started | |
| 3.2 | Reservation schemas | ⬜ Not Started | Including recurring |
| 3.3 | Space schemas | ⬜ Not Started | |
| 3.4 | Equipment schemas | ⬜ Not Started | |
| 3.5 | Blocking schemas | ⬜ Not Started | |

### Phase 4: Services (Business Logic)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 4.1 | User service (sync from JWT, CRUD) | ⬜ Not Started | |
| 4.2 | Space service (CRUD, availability) | ⬜ Not Started | Computed availability |
| 4.3 | Equipment service (CRUD, status) | ⬜ Not Started | |
| 4.4 | Reservation service (create, cancel, list) | ⬜ Not Started | Core business rules |
| 4.5 | Recurring reservation logic | ⬜ Not Started | Date generation, skip conflicts |
| 4.6 | Blocking service (create, remove, cascade) | ⬜ Not Started | Cancels conflicting reservations |
| 4.7 | Notification service (create, list, read) | ⬜ Not Started | |
| 4.8 | Audit log service | ⬜ Not Started | |

### Phase 5: Routes

| # | Task | Status | Notes |
|---|------|--------|-------|
| 5.1 | App definition + health check | ⬜ Not Started | |
| 5.2 | Workers entry point | ⬜ Not Started | |
| 5.3 | User routes | ⬜ Not Started | |
| 5.4 | Space routes | ⬜ Not Started | |
| 5.5 | Equipment routes | ⬜ Not Started | |
| 5.6 | Reservation routes | ⬜ Not Started | |
| 5.7 | Blocking routes | ⬜ Not Started | |
| 5.8 | Notification routes | ⬜ Not Started | |
| 5.9 | Log routes | ⬜ Not Started | |

### Phase 6: Testing & Deployment

| # | Task | Status | Notes |
|---|------|--------|-------|
| 6.1 | Local dev testing with `wrangler dev` | ⬜ Not Started | |
| 6.2 | Seed data applied and verified | ⬜ Not Started | |
| 6.3 | All endpoints tested with sample JWT | ⬜ Not Started | |
| 6.4 | Role/permission matrix fully enforced | ⬜ Not Started | |
| 6.5 | Deploy to Cloudflare Workers | ⬜ Not Started | |
| 6.6 | Remote D1 migration applied | ⬜ Not Started | |
| 6.7 | End-to-end smoke test on Workers | ⬜ Not Started | |

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