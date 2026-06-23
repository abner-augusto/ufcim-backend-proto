# Plan 004: Hourly occupancy grid — DB-enforced reservation/blocking non-overlap

> ⛔ **TRIGGER-GATED — do not execute until a trigger fires.** This plan is the
> Stage 2 "real fix" from `docs/adr/0001-reservation-overlap-enforcement.md`.
> Execute it **only** when *either*:
> - **(a)** a second department with real (non-test) reservation-creating users
>   goes live **on Cloudflare D1**, or
> - **(b)** an actual double-booking is observed in production.
>
> **Off-ramp**: if a committed, scheduled migration to Postgres lands before (a)
> or (b), **abandon this plan** and implement Stage 3 instead (a single
> `EXCLUDE USING gist` constraint — see ADR 0001). Building this grid only to
> demolish it at the Postgres migration is the exact waste this gate prevents.
>
> **Executor instructions**: Follow step by step. Run every verification command
> and confirm the expected result before moving on. If a STOP condition occurs,
> stop and report — do not improvise. When done, update the status row in
> `plans/README.md`.
>
> **Drift check (run first — this plan may be months stale)**:
> `git diff --stat ad08a7d..HEAD -- src/db/schema.ts src/services/reservation.service.ts src/services/blocking.service.ts src/lib/schedule.ts`
> If any in-scope file changed since `ad08a7d`, re-read it in full and reconcile
> the "Current state" excerpts before proceeding; on a material mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P2 — **deferred / trigger-gated** (not part of the POC backlog)
- **Effort**: L (multi-day)
- **Risk**: MED-HIGH (new core table + rewrite of every reservation/blocking mutation)
- **Depends on**: `plans/003` should already be live (it's the POC stopgap this supersedes). On execution, the Plan 003 partial index is replaced by this grid.
- **Category**: bug / tech-debt (atomicity)
- **Planned at**: commit `ad08a7d`, 2026-06-23
- **Decision record**: `docs/adr/0001-reservation-overlap-enforcement.md`

## Why this matters

`ReservationService.create` (and `createRecurring`) and `BlockingService.create`
do **check-then-act** with no transaction and no DB constraint
(`reservation.service.ts:66` reads, `:79` inserts). Concurrent requests can both
pass the read-side check and both write — double-booking, including *partial*
overlaps (`08:00–12:00` vs `09:00–11:00`) that no plain unique index can express.

This plan makes non-overlap a **database guarantee** by normalizing the
write-side onto the hourly grid the read-side already assumes
(`buildHourlyAvailability`, `schedule.ts:81`), via a shared occupancy table whose
composite primary key makes overlap a constraint violation. Correctness stops
depending on the app-level check.

## Design (decided in ADR 0001 — do not re-litigate)

- `reservations` and `blockings` stay as **two separate parent tables**, with all
  their existing columns, statuses, RBAC, and services. **Do NOT merge them.**
- A new **shared child** table `occupancy_slots` carries the guarantee.
  **Presence-based**: a row exists only while a slot is actively held; releasing
  deletes the row. No status column (parents own history).
- A new **`OccupancyService` is the ONLY code allowed to write `occupancy_slots`.**
- Every mutation executes as a **single `db.batch([...])`** (atomic on D1). A
  racing duplicate makes the whole batch fail; translate to `ConflictError`.
- Blocking override = **atomic evict-then-claim** inside the batch.
- Single-occupancy is permanent (divisible rooms → separate spaces); the
  composite PK encodes it.

### Hour decomposition

Times are whole hours `HH:00` (end up to `24:00`). A booking occupies integer
hours `[startHour, endHour)`: `08:00–12:00` → `[8, 9, 10, 11]`;
`22:00–24:00` → `[22, 23]`. Compute with `timeToMinutes(t) / 60`
(`src/lib/schedule.ts:6`).

### Target table

```ts
// src/db/schema.ts
export const occupancySlots = sqliteTable('occupancy_slots', {
  spaceId: text('space_id').notNull().references(() => spaces.id),
  date: text('date').notNull(),        // YYYY-MM-DD
  hour: integer('hour').notNull(),     // 0..23
  kind: text('kind').notNull(),        // 'reservation' | 'blocking'
  refId: text('ref_id').notNull(),     // parent reservations.id / blockings.id
}, (t) => ({
  pk: primaryKey({ columns: [t.spaceId, t.date, t.hour] }), // THE guarantee
  refIdx: index('occupancy_slots_ref_idx').on(t.kind, t.refId), // for release-by-parent
}));
```

No FK on `ref_id` (SQLite can't target two tables from one column); integrity is
owned by `OccupancyService`. `primaryKey` and `index` import from
`drizzle-orm/sqlite-core` (already imported in `schema.ts:1`).

## Current state

- `src/services/reservation.service.ts` — `create()` (line 56), `createRecurring()`
  (115), `cancel()` (181), `cancelSeries()` (224). The insert at `:79-95` is not
  batched; cancels at `:197`/`:249` only update parent status.
- `src/services/blocking.service.ts` — `create()` (35) inserts the blocking then
  loops `update(... status: 'overridden' ...)` over conflicting reservations
  (`:83-103`), all separate awaits; `remove()` (116) updates status only.
- `src/services/auth.service.ts:116-129` — **exemplar of `this.db.batch([...])`**
  in this repo. Match its style for atomic multi-statement writes.
- `src/lib/schedule.ts` — `timeToMinutes` (6), `intervalsOverlap` (46, half-open),
  `buildHourlyAvailability` (81). Reads stay on ranges in this plan (see Scope).

## Commands you will need

| Purpose            | Command                                   | Expected |
|--------------------|-------------------------------------------|----------|
| Typecheck          | `npm run typecheck`                       | exit 0   |
| Tests              | `npm test`                                | all pass |
| Generate migration | `npm run db:generate`                     | new `migrations/NNNN_*.sql`, exit 0 |
| Rebuild local DB   | see Step 6 (wipe `.wrangler` + reapply)   | seeds load clean |

## Scope

**In scope**:
- `src/db/schema.ts` — add `occupancySlots` + relations
- `migrations/` — generated migration (tool-written)
- `src/services/occupancy.service.ts` — **new**, sole writer of the table
- `src/services/reservation.service.ts` — route create/recurring/cancel/cancelSeries through `OccupancyService`, batched
- `src/services/blocking.service.ts` — route create (evict-then-claim) / remove (release) through `OccupancyService`
- `tests/unit/services/occupancy.service.test.ts` — **new**
- `tests/unit/services/reservation.service.test.ts`, `blocking.service.test.ts` — adjust/extend

**Out of scope** (do NOT touch):
- **Read paths** — `buildHourlyAvailability`, `checkSlotAvailability`'s overlap
  pre-check, `report.service`, admin views. They keep reading ranges; the
  chokepoint keeps ranges and slots consistent. Read migration is a **separate**
  follow-up (ROADMAP item 1, Phase 2b). Keep the app-level pre-check — it now
  exists only for the friendly error message, not for correctness.
- Merging `reservations`/`blockings`; any capacity/seat-level model; the Postgres
  exclusion constraint (that's the off-ramp, not this plan).

## Git workflow

- Branch: `feat/occupancy-grid`
- Commit per logical unit; conventional style, e.g.
  `feat(occupancy): add shared occupancy_slots table and OccupancyService`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add the `occupancy_slots` table and generate the migration

Add the table from the Design section to `src/db/schema.ts` (plus a relation if
the repo's relation style benefits it — optional). Run `npm run db:generate`.

**Verify**: `npm run typecheck` → exit 0; `grep -rn "occupancy_slots" migrations/`
shows a `CREATE TABLE` with the composite primary key; the migration diff adds
*only* this table.

### Step 2: Create `OccupancyService` — the sole writer

New file `src/services/occupancy.service.ts`. It does not execute writes itself;
it **returns prepared `db.batch` statements** so callers compose one atomic batch.
Provide:

- `slotInserts(kind, refId, spaceId, date, startTime, endTime)` → array of
  `db.insert(occupancySlots).values(...)` statements, one per hour in
  `[startHour, endHour)`.
- `slotDeletesByRef(kind, refId)` → a `db.delete(occupancySlots).where(and(eq(kind), eq(refId)))`
  statement (release on cancel/remove).
- `slotDeletesForReservationsInRange(spaceId, date, startTime, endTime)` →
  delete statement(s) for reservation-kind slots overlapping the given hours (for
  the blocking evict step).
- A helper `isUniqueViolation(err)` = `err instanceof Error && /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(err.message)`.

Callers wrap `db.batch([...])` in try/catch and translate `isUniqueViolation` to
`ConflictError('Esta faixa de horário conflita com uma reserva existente')`.

**Verify**: `npm run typecheck` → exit 0.

### Step 3: Route reservation mutations through the batch

- `create()`: replace the standalone insert with
  `await this.db.batch([ insert(reservations)…, ...occupancy.slotInserts('reservation', id, …) ])`,
  wrapped in try/catch → `ConflictError` on unique violation. Keep the existing
  `checkSlotAvailability` pre-check before the batch (UX message). Audit/notify
  may stay outside the batch.
- `createRecurring()`: each per-date occurrence becomes its own batch; a unique
  violation is caught and the date pushed to `skipped` (the loop already
  `try/catch`es — fold the slot inserts into that batch).
- `cancel()` / `cancelSeries()`: add `occupancy.slotDeletesByRef('reservation', id)`
  to the same batch as the parent status update, so releasing the slot and
  marking the parent `canceled` are atomic.

**Verify**: `npm run typecheck` → exit 0.

### Step 4: Route blocking mutations through the batch (evict-then-claim)

- `create()`: in one batch — delete reservation-kind occupancy rows overlapping
  the blocking's hours, set those parent reservations to `overridden`, insert the
  blocking parent, insert blocking-kind occupancy rows. Notifications/audit for
  overridden reservations may follow the batch (read the overlapping reservations
  *before* the batch to know whom to notify). A blocking-vs-blocking collision on
  the composite PK → `ConflictError`.
- `remove()`: add `occupancy.slotDeletesByRef('blocking', id)` to the status-update
  batch.

**Verify**: `npm run typecheck` → exit 0.

### Step 5: Tests

- New `tests/unit/services/occupancy.service.test.ts`: hour decomposition
  (`08:00–12:00` → 4 inserts at hours 8–11; `22:00–24:00` → hours 22,23),
  `isUniqueViolation` matching, release-by-ref builds the right delete.
- Extend reservation tests: `create` builds a batch including N slot inserts; a
  rejected batch (`db.batch` mock rejecting with a UNIQUE error) → `ConflictError`.
- Extend blocking tests: override evicts overlapping reservation slots and marks
  parents `overridden` within the batch.
- The mock in `tests/unit/helpers/mock-db.ts` has no `batch` yet — add a
  `batch: vi.fn().mockResolvedValue([])` to the mock and expose it as `_batch`.

**Verify**: `npm test` → all pass, including the new suite.

### Step 6: Clean DB rebuild (testing-phase shortcut)

Per ADR 0001, this is done in the testing phase with little data, so **rebuild
local DB from scratch** rather than backfilling: delete `.wrangler/state/v3/d1`,
re-apply `migrations/` then `scripts/seed.sql` + `scripts/seed_dev.sql` to
`ufcim-db-dev --local --env dev` (see `README.md` / `docs/ARCHITECTURE.md`).
Confirm seeds load with the new constraint in place.

**Verify**: seed scripts apply with exit 0 (no constraint violations). If they
fail on a UNIQUE collision, the seed data itself contains overlaps → STOP.

## Done criteria

ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0; new `occupancy.service.test.ts` exists and passes
- [ ] `grep -rln "occupancy_slots" src/services/` shows only `occupancy.service.ts` (reservation/blocking services go through it, not the table directly)
- [ ] A concurrent-duplicate insert path is covered by a test asserting `ConflictError` (via a rejecting `db.batch` mock)
- [ ] Local DB rebuilds clean with seeds (Step 6)
- [ ] No read-path file modified (`buildHourlyAvailability`, `report.service`, admin views) — `git status`
- [ ] `plans/README.md` status row for 004 updated; ADR 0001 status note updated if appropriate

## STOP conditions

Stop and report (do not improvise) if:

- **The trigger has not actually fired** — re-confirm (a) or (b) before any work.
- **The off-ramp applies** — Postgres migration is scheduled/committed → do Stage 3 instead.
- **Real production data exists** — Step 6's wipe is unacceptable; you need a
  careful backfill that resolves pre-existing overlaps first. That is a different,
  larger migration → report and re-plan.
- `db.batch` is not atomic in the current Drizzle/D1 version, or its API changed
  from the `auth.service.ts:116` exemplar.
- Any "Current state" excerpt no longer matches the live code after the drift check.
- You find a reservation/blocking write path this plan didn't enumerate.

## Maintenance notes

- The dual-write invariant (parent range ↔ occupancy rows) lives in exactly one
  place: `OccupancyService` + the batches that call it. **Never** write
  `occupancy_slots` from anywhere else; a reviewer must reject any such change.
- Phase 2b (ROADMAP) migrates reads to `occupancy_slots`, after which the
  range-based overlap math in `schedule.ts` can be retired.
- At the Postgres migration (Stage 3, ADR 0001), `occupancy_slots` becomes
  redundant — the `EXCLUDE` constraint subsumes it; plan its removal then.
- Flip-to-Option-A signal: if an "edit reservation hours" feature or per-hour
  reporting lands, the dual-write cost rises and a single-source "reservation is
  one hour" model may become preferable — revisit ADR 0001.
