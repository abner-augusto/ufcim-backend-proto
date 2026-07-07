# Plan 006: Push audit-log list filtering & pagination into SQL

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 431ac33..HEAD -- src/services/audit-log.service.ts src/routes/logs.ts`
> On mismatch with the excerpts below, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (return shape unchanged; mechanical transform with a proven template)
- **Category**: perf
- **Depends on**: none
- **Planned at**: commit `431ac33`, 2026-07-02

## Why this matters

`AuditLogService.list()` loads the **entire** `audit_logs` table (with a
`user` join) into memory on every admin `/logs` page view, then filters and
slices in JS. This is the exact anti-pattern plan 002 (in this directory)
already eliminated from `reservation.service.ts`, `blocking.service.ts`, and
`invitation.service.ts` — but `audit-log.service.ts` was out of that plan's
scope. It's the worst table to leave unbounded: audit logs are append-only by
design, and the availability endpoint writes a row on **every** availability
view (`src/routes/spaces.ts:81-91`), so this table grows fastest of all.

## Current state

```ts
// src/services/audit-log.service.ts:6-14
interface ListAuditLogsFilters {
  userId?: string;
  actionType?: string;
  referenceType?: string;
  dateFrom?: string;   // "YYYY-MM-DD"
  dateTo?: string;     // "YYYY-MM-DD"
  page: number;
  limit: number;
}
```

```ts
// src/services/audit-log.service.ts:38-63
async list(filters: ListAuditLogsFilters) {
  const allLogs = await this.db.query.auditLogs.findMany({
    with: { user: true },
    orderBy: (l, { desc: d }) => [d(l.timestamp)],
  });

  const filtered = allLogs.filter((log) => {
    if (filters.userId && log.userId !== filters.userId) return false;
    if (filters.actionType && log.actionType !== filters.actionType) return false;
    if (filters.referenceType && log.referenceType !== filters.referenceType) return false;
    if (filters.dateFrom && log.timestamp.slice(0, 10) < filters.dateFrom) return false;
    if (filters.dateTo && log.timestamp.slice(0, 10) > filters.dateTo) return false;
    return true;
  });

  const start = (filters.page - 1) * filters.limit;
  return {
    data: filtered.slice(start, start + filters.limit),
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / filters.limit)),
    },
  };
}
```

`timestamp` is a full ISO string (`new Date().toISOString()` — see the `log()`
method at line 33), so lexicographic comparison against date prefixes is
valid: `timestamp >= dateFrom` matches the old `slice(0,10) >= dateFrom`
semantics, and the old `slice(0,10) <= dateTo` (inclusive end day) translates
to `timestamp < <day after dateTo>`.

Sole caller — return shape `{ data, pagination }` must not change:

```ts
// src/routes/logs.ts (staff-only, validateQuery'd)
const data = await service.list(filters);
return c.json(data);
```

**The template to imitate** (produced by plan 002, reviewed and merged):
`ReservationService.listForAdmin` at `src/services/reservation.service.ts:323-352`
— builds a `where` from conditions, then runs `findMany({ where, limit,
offset })` and a `count()` query, and assembles the same pagination object
with `totalPages: Math.max(1, Math.ceil(total / filters.limit))`. Read it
before writing code.

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npm run typecheck` | exit 0              |
| Tests     | `npm test`          | all pass            |
| Single file | `npx vitest run tests/unit/regressions/advisor-plans.test.ts` | pass |

## Scope

**In scope**:
- `src/services/audit-log.service.ts` (the `list` method; imports)
- A test file for the new behavior — extend
  `tests/unit/regressions/advisor-plans.test.ts` (the suite created for plan
  002's transforms) or, if a dedicated audit-log service test file exists by
  then, use that.

**Out of scope**:
- `src/routes/logs.ts` (contract unchanged).
- The `log()` / `getById()` methods.
- Adding DB indexes (D1/SQLite migration) — worth considering later; note it
  in your report if the table lacks an index on `timestamp`.

## Git workflow

- Branch: `perf/audit-log-sql-pagination` + PR to `main`. Conventional
  commit, e.g. `perf(logs): paginate audit logs in SQL` (matches `7759a95
  perf(admin): paginate admin lists in SQL`). Do NOT push or open a PR unless
  instructed.

## Steps

### Step 1: Transform `list()` to SQL filtering + pagination

Following the `listForAdmin` template:

```ts
import { eq, and, gte, lt, count, desc } from 'drizzle-orm';   // extend existing import

async list(filters: ListAuditLogsFilters) {
  const conditions = [];
  if (filters.userId) conditions.push(eq(auditLogs.userId, filters.userId));
  if (filters.actionType) conditions.push(eq(auditLogs.actionType, filters.actionType));
  if (filters.referenceType) conditions.push(eq(auditLogs.referenceType, filters.referenceType));
  if (filters.dateFrom) conditions.push(gte(auditLogs.timestamp, filters.dateFrom));
  if (filters.dateTo) conditions.push(lt(auditLogs.timestamp, nextDay(filters.dateTo)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const offset = (filters.page - 1) * filters.limit;
  const [data, [{ total }]] = await Promise.all([
    this.db.query.auditLogs.findMany({
      where, with: { user: true },
      orderBy: (l, { desc: d }) => [d(l.timestamp)],
      limit: filters.limit, offset,
    }),
    this.db.select({ total: count() }).from(auditLogs).where(where),
  ]);

  return {
    data,
    pagination: {
      page: filters.page, limit: filters.limit, total,
      totalPages: Math.max(1, Math.ceil(total / filters.limit)),
    },
  };
}
```

with a small module-local helper (UTC math, since timestamps are `toISOString()`):

```ts
function nextDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
```

Semantics check against the old code: `gte(timestamp, '2026-07-01')` ≡
`slice(0,10) >= '2026-07-01'` (ISO strings sort lexicographically);
`lt(timestamp, '2026-07-02')` ≡ `slice(0,10) <= '2026-07-01'`. Match the
exact structure/style of `listForAdmin` where this sketch and the template
disagree — the template is authoritative for this repo.

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Tests

Model on the plan-002 regression tests in
`tests/unit/regressions/advisor-plans.test.ts` (same harness). Cases:

1. Pagination: seed 5 logs, `{ page: 2, limit: 2 }` → 2 rows, `total: 5`,
   `totalPages: 3`, ordering by `timestamp` desc preserved.
2. Each filter individually: `userId`, `actionType`, `referenceType` — only
   matching rows, `total` reflects the filter (not the table size).
3. Date range: logs on 3 consecutive days; `{ dateFrom: day2, dateTo: day2 }`
   → only day-2 rows (proves `dateTo` stays inclusive).
4. Empty result: filters matching nothing → `data: []`, `total: 0`,
   `totalPages: 1`.
5. `data[i].user` still populated (the `with: { user: true }` join survived).

**Verify**: `npm test` → all pass, including the new cases.

## Test plan

Covered in Step 2. Additionally, eyeball the admin dashboard's logs view
(`npm run dev`, open `/admin`, Logs section, apply a date filter) if a local
DB is seeded — optional, the unit suite is the gate.

## Done criteria

- [ ] `grep -n "allLogs\|filtered.slice" src/services/audit-log.service.ts` → no matches
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with ≥5 new cases
- [ ] Return shape unchanged (`data` + `pagination{page,limit,total,totalPages}`) — route untouched
- [ ] `plans/README.md` status row updated

## STOP conditions

- The `list()` code doesn't match the excerpt (drifted since `431ac33`).
- `timestamp` turns out NOT to be a full ISO string for some historical rows
  in the test harness — the lexicographic date math breaks; report.
- The test harness used by `advisor-plans.test.ts` can't seed audit logs
  directly — report what it supports.

## Maintenance notes

- If `/logs` gains new filters, they must go into the `conditions` array —
  never post-filter after `findMany` with `limit` (that's the bug class plan
  005 fixes elsewhere).
- Follow-up worth filing: an index on `audit_logs(timestamp)` (and possibly
  `(user_id, timestamp)`) once the table is large enough to matter — needs a
  D1 migration, deliberately out of scope here.
