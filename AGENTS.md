# UFCIM backend — project notes

## Check, hook, tracker
- **Check**: `bash scripts/check` defines green: typecheck, Vitest (with the architecture test), the collector's pytest, `tropa quality`. It runs offline against local test doubles.
- **Hook**: `scripts/git-hooks/pre-push` reruns the check unless it already passed on the pushed tree. A new clone enables it with `git config core.hooksPath scripts/git-hooks`.
- **Tracker**: GitHub Issues of the front repository (`abner-augusto/UFCIM-FRONT3D`); read `docs/agents/issue-tracker.md` before creating or closing one. Tropa config: `docs/agents/tropa.toml`.
- **Deploys and remote D1** (`npm run deploy`, `wrangler deploy`, `wrangler secret`, `wrangler d1` without `--local`) need the user's approval each time.

## Closed POC scope: IAUD only
The current closed test covers a single department. **All test users and the master
admin live in IAUD.** Other departments still exist as reference data.

- **Department slugs are short codes** (the `departments.id` PK, used as the FK in
  `users.department`, `spaces.department`, `invitations.department`). The slug is
  capped at 50 chars by the space/invitation validators, so it must stay short:
  - `iaud` — Instituto de Arquitetura, Urbanismo e Design (Benfica)
  - `dc`   — Departamento de Computação (Pici)
  - `adm`  — Departamento de Administração (Benfica)
  - `si`   — Superintendência de Infraestrutura (Pici)
  The readable full name lives in `departments.name`. Some admin views display the
  raw slug, so keep codes meaningful.
- To re-slug a department, use the non-destructive pattern in
  `scripts/shorten-department-slugs.sql` (create new dept row → repoint FK columns →
  drop old); D1 enforces FKs, so you can't just `UPDATE departments.id`.

## Accounts

Test and admin accounts are described in the machine-local `AGENTS.local.md`, which is never committed.

## Databases
Separate D1 per env (binding `DB` in both): dev = `ufcim-db-dev`, prod = `ufcim-db`.
Rebuild local from scratch: wipe `.wrangler/state/v3/d1`, then
`wrangler d1 migrations apply ufcim-db-dev --local --env dev`, then apply
`scripts/seed.sql` → `seed_test_users.sql` → `seed_master_admin.sql`.

## RBAC: department restriction on reservations/blockings
Traced in `src/services/reservation.service.ts` and `blocking.service.ts`:

- **Reservations**: `assertDepartmentAccess()` confines **students and professors** to
  spaces of their own department (`reservation.service.ts`); applied in both `create()`
  and `createRecurring()`. **Staff (funcionário) are exempt** — they may reserve any
  department's spaces. Maintenance cannot reserve at all (active limit `0`).
- **Blockings**: `BlockingService.create()` has **no department check**; route allows
  `professor`, `staff`, `maintenance` — so any of them can block a space in any
  department (maintenance included).

## Issues

This repository has no tracker of its own. Backend work is tracked in the front repository's GitHub Issues (`gh issue list -R abner-augusto/UFCIM-FRONT3D`); its `docs/agents/issue-tracker.md` defines the issue shape and labels.

## Git

Push only with the user's explicit authorization: UFCIM has users running it.
