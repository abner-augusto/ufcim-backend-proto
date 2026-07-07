# Plan 005: Fix `listPending` filtering after SQL pagination (silently dropped rows)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 431ac33..HEAD -- src/services/equipment-report.service.ts src/routes/equipment.ts tests/unit/services/equipment-report.service.test.ts`
> On mismatch with the excerpts below, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (single method, single route caller)
- **Category**: bug
- **Depends on**: none
- **Planned at**: commit `431ac33`, 2026-07-02

## Why this matters

`EquipmentReportService.listPending()` applies `limit`/`offset` **inside** the
SQL query, then filters the already-truncated page by `spaceId` in JS. When a
`spaceId` filter is set, a page can come back short or empty even though
matching rows exist beyond the SQL cut — data is silently dropped, which is
worse than being slow. The `spaceId` query param is live on
`GET /equipment/reports/pending` and the frontend client
(`UFCIM-FRONT3D/src/services/api.ts:299-300`) already accepts a `spaceId`
filter, so any UI adoption of that filter hits the bug immediately.

## Current state

```ts
// src/services/equipment-report.service.ts:217-242
async listPending(filters: ListPendingFilters) {
  const conditions: any[] = [];

  if (filters.status) {
    conditions.push(eq(equipmentReports.status, filters.status));
  }

  const results = await this.db.query.equipmentReports.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: (r, { desc }) => [desc(r.createdAt)],
    with: {
      equipment: { with: { space: { with: { department: true } } } },
      reporter: true,
      acknowledger: true,
    },
    limit: filters.limit,
    offset: (filters.page - 1) * filters.limit,
  });

  // Filter by spaceId if provided
  if (filters.spaceId) {
    return results.filter((r: any) => r.equipment?.spaceId === filters.spaceId);
  }

  return results;
}
```

```ts
// src/services/equipment-report.service.ts:22-27
interface ListPendingFilters {
  status?: string;
  spaceId?: string;
  page: number;
  limit: number;
}
```

The route caller (return shape is a **bare array** — keep it):

```ts
// src/routes/equipment.ts:38-42
const spaceId = c.req.query('spaceId');
...
const reports = await service.listPending({ status, spaceId, page, limit });
```

Schema facts (`src/db/schema.ts`): `equipmentReports.equipmentId` references
`equipment.id` (line 75); `equipment.spaceId` references `spaces.id`
(line 61). `spaceId` lives on `equipment`, not on `equipment_reports` — that
indirection is why the original author fell back to a JS filter.

Convention: services build Drizzle `conditions` arrays and push all filters
into SQL — exemplar: `ReservationService.listForAdmin`
(`src/services/reservation.service.ts:323-352`, the pattern established by
plan 002 in this directory).

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npm run typecheck` | exit 0              |
| Tests     | `npm test`          | all pass (310+)     |
| Single file | `npx vitest run tests/unit/services/equipment-report.service.test.ts` | pass |

## Scope

**In scope**:
- `src/services/equipment-report.service.ts` (the `listPending` method only)
- `tests/unit/services/equipment-report.service.test.ts` (add regression cases)

**Out of scope**:
- The route (`src/routes/equipment.ts`) — its contract (bare array) is
  unchanged.
- The response shape — do NOT add pagination metadata here (other
  `/pending` consumers expect an array).
- Other service methods (`listByUser`, `listBySpace`, …).

## Git workflow

- Branch: `fix/pending-reports-pagination` + PR to `main` (repo history uses
  conventional commits, e.g. `fix(reservations): prevent exact double-booking`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Push the `spaceId` filter into SQL

Resolve the equipment→space indirection with a subquery-style `inArray`
condition before the main query:

```ts
import { inArray } from 'drizzle-orm';   // add to the existing drizzle import

if (filters.spaceId) {
  const eqRows = await this.db
    .select({ id: equipment.id })
    .from(equipment)
    .where(eq(equipment.spaceId, filters.spaceId));
  if (eqRows.length === 0) return [];
  conditions.push(inArray(equipmentReports.equipmentId, eqRows.map((r) => r.id)));
}
```

Then delete the post-hoc JS filter block (`if (filters.spaceId) { return
results.filter(...) }`) entirely, returning `results` directly. Two queries is
acceptable on D1 for this admin path; per-space equipment counts are small.

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Regression tests

In `tests/unit/services/equipment-report.service.test.ts` (follow that file's
existing setup/fixtures — it already exercises `listPending`), add:

1. **The bug case**: seed 2 spaces; space A has equipment with 1 pending
   report, space B has equipment with 2 pending reports whose `createdAt`
   sorts them FIRST; call `listPending({ spaceId: A, page: 1, limit: 2 })`.
   Old code returns `[]` (the SQL page contained only B's rows); new code
   returns A's report.
2. `spaceId` + `status` combined: only reports matching both come back.
3. `spaceId` with no equipment in that space → `[]` (the early-return path).
4. No `spaceId` → behavior unchanged (existing tests should already cover
   this; confirm they still pass).

**Verify**: `npx vitest run tests/unit/services/equipment-report.service.test.ts`
→ all pass, including the new cases (and confirm case 1 FAILS if you
temporarily revert Step 1 — that proves the test bites).

### Step 3: Full gate

**Verify**: `npm run typecheck && npm test` → exit 0, all pass.

## Test plan

Covered in Step 2 (4 cases; case 1 is the regression proof). Model the test
structure on the existing tests in the same file.

## Done criteria

- [ ] `grep -n "results.filter" src/services/equipment-report.service.ts` → no matches
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0, including ≥3 new `listPending` cases
- [ ] Reverting the fix makes the Step 2 case-1 test fail (verified once, then re-applied)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The `listPending` code no longer matches the excerpt (drifted since
  `431ac33`).
- The existing test file's harness cannot seed two spaces with equipment —
  report what the harness supports instead of restructuring it.
- You find other methods in this service with the same filter-after-limit
  pattern — do NOT fix them here; list them in your report.

## Maintenance notes

- If pagination metadata (`{ data, pagination }`) is ever added to
  `/equipment/reports/pending`, compute `total` with a `count()` over the SAME
  conditions array — see `reservation.service.ts:323-352` for the shape.
- Reviewer: check the `eqRows.length === 0` early return — without it,
  `inArray(col, [])` generates invalid/degenerate SQL on some drivers.
