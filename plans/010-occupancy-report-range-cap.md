# Plan 010: Cap the `/occupancy` report date range (ROADMAP 5)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 09fe163..HEAD -- src/services/report.service.ts src/validators/report.schema.ts tests/unit/services/report.service.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (additive guard mirroring an existing one; extracts a magic
  number into a named constant used by both report functions)
- **Category**: bug / hardening
- **Depends on**: none (independent of Plan 009 — different files)
- **Planned at**: commit `21a9860`, 2026-07-08
- **Source**: ROADMAP item 5 / `plans/README.md` "Findings considered".
  `getSpaceReport` caps its range at 90 days (`report.service.ts:123-126`);
  the `/occupancy` endpoint does **not**, so any authenticated
  professor/staff/maintenance can request `startDate=2020-01-01&endDate=2099-12-31`
  and force `getOccupancyReport` to build a ~29,000-day `dateRange` × every
  space × 24 hourly slots entirely in memory — a Worker CPU/RAM blowup.

## Why this matters

`getOccupancyReport` (`report.service.ts:370`) expands the requested range with
`dateRange(startDate, endDate)` (line 436) and then loops
`spaceList × dates × buildHourlyAvailability(...)` in memory (lines 443-460),
with **no upper bound on the span**. The route's validator
(`occupancyQuerySchema`) only checks `endDate >= startDate`
(`report.schema.ts:11-14`) — there is no maximum. Its sibling `getSpaceReport`
already guards this exact class of abuse with a 90-day cap; this plan brings
`getOccupancyReport` to parity and removes the duplicated magic `90` by
extracting a shared constant.

## Current state

- `src/services/report.service.ts:1-9` — imports; `AppError` is already
  imported (line 4). No module-level range constant exists yet.

- `src/services/report.service.ts:108-127` — `getSpaceReport` validates the
  range with a hardcoded `90`:

```ts
// src/services/report.service.ts:111-126
// Validate date range
const startMs = new Date(startDate + 'T00:00:00').getTime();
const endMs = new Date(endDate + 'T00:00:00').getTime();

if (isNaN(startMs) || isNaN(endMs)) {
  throw new AppError(400, 'Datas inválidas. Use o formato AAAA-MM-DD.', 'INVALID_DATE');
}

if (startMs > endMs) {
  throw new AppError(400, 'startDate não pode ser posterior a endDate', 'INVALID_DATE_RANGE');
}

const diffDays = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1;
if (diffDays > 90) {
  throw new AppError(400, 'O período máximo permitido é de 90 dias', 'RANGE_TOO_LARGE');
}
```

- `src/services/report.service.ts:370-378` — `getOccupancyReport` starts by
  destructuring `filters` and immediately builds `spaceConditions` — **no date
  validation at all** (it trusts the schema, which does not cap the span):

```ts
// src/services/report.service.ts:370-380
async getOccupancyReport(filters: {
  startDate: string;
  endDate: string;
  campus?: string;
  department?: string;
  spaceId?: string;
  groupBy?: 'day' | 'week' | 'month';
}) {
  const { startDate, endDate, campus, department, spaceId } = filters;

  const spaceConditions: any[] = [];
```

- `tests/unit/services/report.service.test.ts` — uses `createMockDb()` + `SEED`
  from `../helpers/mock-db`; imports `{ NotFoundError, AppError }` already.
  Has a `describe('ReportService.getSpaceReport')` block whose 90-day test is
  the exemplar to copy (lines 53-63). There is **no** `getOccupancyReport`
  describe block yet. Note `getOccupancyReport` reads spaces via
  `db.query.spaces.findMany` (not `findFirst`).

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npm run typecheck` | exit 0              |
| Tests     | `npm test`          | all pass (342 before this plan) |
| Single file | `npx vitest run tests/unit/services/report.service.test.ts` | pass |

## Scope

**In scope**:
- `src/services/report.service.ts` — add the `MAX_REPORT_RANGE_DAYS` constant;
  apply the range guard in `getOccupancyReport`; refactor `getSpaceReport` to
  use the constant.
- `tests/unit/services/report.service.test.ts` — add a `getOccupancyReport`
  describe block with the cap cases.

**Out of scope**:
- `occupancyQuerySchema` / `report.schema.ts` — the guard lives in the service,
  mirroring `getSpaceReport`; do NOT move validation into the schema.
- `getSpaceReport`'s behavior beyond swapping the literal `90` for the constant
  (message text must stay identical).
- Any change to `buildHourlyAvailability`, `dateRange`, or the report shape.
- The frontend repo.

## Git workflow

- Branch: `fix/occupancy-range-cap` + PR to `main`. Conventional commit, e.g.
  `fix(reports): limitar intervalo do relatório de ocupação a 90 dias`.
  No Co-Authored-By trailer. Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Extract the shared constant

In `src/services/report.service.ts`, add after the imports (below line 8,
before the `SpaceReportInput` interface):

```ts
/** Maximum span (inclusive, in days) accepted by the report endpoints. */
const MAX_REPORT_RANGE_DAYS = 90;
```

Then in `getSpaceReport`, replace the hardcoded check:

```ts
const diffDays = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1;
if (diffDays > MAX_REPORT_RANGE_DAYS) {
  throw new AppError(400, `O período máximo permitido é de ${MAX_REPORT_RANGE_DAYS} dias`, 'RANGE_TOO_LARGE');
}
```

(The template literal yields the identical string `"O período máximo permitido
é de 90 dias"`, so existing behavior and any message assertions are unchanged.)

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Guard `getOccupancyReport`

In `getOccupancyReport`, immediately after
`const { startDate, endDate, campus, department, spaceId } = filters;` and
before `const spaceConditions: any[] = [];`, add the same validation block as
`getSpaceReport` (the service is called directly by tests, so it must not
assume the schema ran):

```ts
const startMs = new Date(startDate + 'T00:00:00').getTime();
const endMs = new Date(endDate + 'T00:00:00').getTime();
if (isNaN(startMs) || isNaN(endMs)) {
  throw new AppError(400, 'Datas inválidas. Use o formato AAAA-MM-DD.', 'INVALID_DATE');
}
if (startMs > endMs) {
  throw new AppError(400, 'startDate não pode ser posterior a endDate', 'INVALID_DATE_RANGE');
}
const diffDays = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1;
if (diffDays > MAX_REPORT_RANGE_DAYS) {
  throw new AppError(400, `O período máximo permitido é de ${MAX_REPORT_RANGE_DAYS} dias`, 'RANGE_TOO_LARGE');
}
```

**Verify**: `npm run typecheck && npm test` → exit 0, all existing tests pass
(existing occupancy-report tests, if any, use ≤90-day ranges).

### Step 3: Tests

In `tests/unit/services/report.service.test.ts`, add a new top-level describe
`ReportService.getOccupancyReport` modeled on the `getSpaceReport` block. In
`beforeEach`, mock the DB reads that `getOccupancyReport` performs:

```ts
db.query.spaces.findMany.mockResolvedValue([
  { ...SEED.space, department: { id: 'iaud', name: 'IAUD' } },
]);
db.query.reservations.findMany.mockResolvedValue([]);
db.query.blockings.findMany.mockResolvedValue([]);
```

Cases:

1. **Rejects a range over 90 days**: `startDate: '2026-01-01', endDate:
   '2026-05-01'` (~121 days) → `rejects.toThrow(AppError)`.
2. **Rejects end before start**: `startDate: '2026-06-10', endDate:
   '2026-06-01'` → `rejects.toThrow(AppError)`.
3. **Allows exactly 90 days**: `startDate: '2026-01-01', endDate: '2026-03-31'`
   (90 inclusive) → resolves; assert the result has a `spaces` array and a
   `totalOccupancyRate` number.
4. **Allows a small range**: `startDate: '2026-06-01', endDate: '2026-06-07'`
   → resolves.

**Verify**: `npx vitest run tests/unit/services/report.service.test.ts` → all
pass. Then temporarily comment out the Step 2 guard and confirm case 1 fails
(proves the test bites); restore it.

### Step 4: Full gate

**Verify**: `npm run typecheck && npm test` → exit 0, all pass.

## Test plan

Covered in Step 3 (4 cases; case 1 is the regression proof for the finding).
Model structure and mocking on the existing `getSpaceReport` describe block in
the same file.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0, including ≥3 new `getOccupancyReport` cases
- [ ] `grep -n "MAX_REPORT_RANGE_DAYS" src/services/report.service.ts` → 3
      matches (1 definition + 2 uses)
- [ ] `grep -n "diffDays > 90" src/services/report.service.ts` → no matches
- [ ] Reverting the Step 2 guard makes occupancy test case 1 fail (verified
      once, then re-applied)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `getSpaceReport`'s validation block or `getOccupancyReport`'s opening lines
  no longer match the excerpts (drifted since `09fe163`).
- More than 3 existing tests break on Step 1 or 2 — the blast radius is bigger
  than planned (something asserts the old literal or an uncapped range).
- You are tempted to move the guard into `occupancyQuerySchema` — that is out
  of scope (keep parity with `getSpaceReport`); note it in your report instead.

## Maintenance notes

- The 90-day limit is now one constant; if the product wants a different cap
  for occupancy vs. single-space reports, split the constant then.
- `getSpaceReport` and `getOccupancyReport` now share the same range-validation
  block verbatim; if a third report path appears, extract a helper.
