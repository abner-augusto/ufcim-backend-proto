# CLAUDE.md

> This file is read automatically by Claude Code. It provides project context, conventions, and guardrails.

## Project

UFCIM (Federal University of Ceará Infrastructure Manager) — a space reservation and management API for UFC campus infrastructure.

## Stack

- **Runtime:** Cloudflare Workers (prototype) → Node.js (production)
- **Framework:** Hono
- **ORM:** Drizzle ORM (D1 driver now, postgres-js driver later)
- **Database:** Cloudflare D1 (SQLite) now, PostgreSQL later
- **Validation:** Zod
- **Auth:** JWT verification via JWKS (jose library)
- **Language:** TypeScript (strict mode)

## Key Files

- `src/app.ts` — Hono app with all routes mounted (shared between runtimes)
- `src/index.ts` — Workers entry point (`export default app`)
- `src/index.node.ts` — Node.js entry point (future production)
- `src/db/schema.ts` — Single source of truth for all database tables
- `src/db/client.ts` — Database connection factory (swap this file for migration)
- `wrangler.toml` — Cloudflare Workers config
- `drizzle.config.ts` — Drizzle Kit config (dialect switches between sqlite/postgresql)

## Architecture Rules

1. **Routes are thin.** They parse input, call a service, return output. No business logic in route handlers.
2. **Services own business logic.** Each service receives a `Database` instance and validated data. Services never touch `c.req` or `c.json`.
3. **Validation happens in middleware.** Zod schemas validate before the handler runs. Access validated data via `c.get('validatedBody')` or `c.get('validatedQuery')`.
4. **Auth is stateless.** JWT verified per-request via JWKS. No sessions, no cookies.
5. **No PostgreSQL-specific features.** The schema must work on both D1 (SQLite) and PostgreSQL. No native ENUMs, no PostgreSQL arrays, no `SERIAL` types.

## Database Conventions

- Primary keys: UUID as `text`, generated with `crypto.randomUUID()`
- Timestamps: ISO 8601 strings as `text` (not Date objects, not Unix epochs)
- Booleans: `integer('col', { mode: 'boolean' })` for D1 compatibility
- Enums: Store as `text`, validate with Zod at the service layer
- Soft deletes: Use `status` fields (`canceled`, `removed`), never hard delete
- The `spaces` table has **no `status` column** — availability is computed from reservations + blockings

## Naming

- Files: `kebab-case.ts` (e.g., `reservation.service.ts`)
- Tables: `snake_case` (e.g., `audit_logs`)
- Columns: `snake_case` in DB, `camelCase` in TypeScript (Drizzle handles mapping)
- Routes: `kebab-case` URL paths (e.g., `/api/v1/reservations/read-all`)
- Types/Interfaces: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`

## Commands

```bash
# Development
npx wrangler dev                              # Start local dev server
npx wrangler d1 execute ufcim-db --local --file=migrations/<file>.sql  # Apply migration locally

# Database
npx drizzle-kit generate                      # Generate migration from schema changes
npx drizzle-kit studio                        # Open Drizzle Studio (DB browser)

# Deploy
npx wrangler deploy                           # Deploy to Cloudflare Workers
npx wrangler d1 execute ufcim-db --remote --file=migrations/<file>.sql  # Apply migration remotely

# Type checking
npx tsc --noEmit                              # Type check without emitting
```

## Testing Approach

- Use `wrangler dev` for local integration testing
- Test with curl or httpie against `http://localhost:8787`
- For JWT testing, generate tokens with a test JWKS keypair
- Seed data uses deterministic UUIDs (`00000000-0000-0000-0000-00000000000X`)

## Guardrails

- **Never** put business logic in route handlers — always delegate to a service
- **Never** use PostgreSQL-specific SQL or Drizzle types
- **Never** hard delete records — use status fields
- **Never** store derived state (like space availability) as a column
- **Always** create an audit log entry for every mutation
- **Always** validate input with Zod before processing
- **Always** check role permissions via RBAC middleware on protected routes
- **Always** return proper HTTP status codes (201 for creation, 409 for conflicts, etc.)

## Reference Docs

- `UFCIM_Build_Guide.md` — Step-by-step build instructions with code examples
- `UFCIM_TDD.md` — Technical design document with progress tracker
- `CONVENTIONS.md` — Detailed code style and patterns

## Current Phase

Phase 2: Middleware & Auth (JWT verification, RBAC, Zod middleware, error handling, CORS)
