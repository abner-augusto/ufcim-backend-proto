# Plan 002: Push admin list filtering & pagination into SQL

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ad08a7d..HEAD -- src/services/reservation.service.ts src/services/blocking.service.ts src/services/invitation.service.ts`
> If any in-scope service changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `ad08a7d`, 2026-06-23

## Why this matters

Three admin-facing list methods load their **entire** table (with relational
joins) into memory on every request, then filter and paginate in JavaScript.
This means each admin page view materializes every reservation / blocking /
invitation that has ever existed, plus joined users/spaces, regardless of the
page or filters requested. On Cloudflare Workers this consumes CPU and memory
that scale with total row count, not page size — it will degrade and eventually
hit Worker limits as the dataset grows. Moving the `WHERE`, `ORDER BY`, `LIMIT`,
and `OFFSET` into the database query keeps per-request cost bounded by page size.

## Current state

All three follow the same anti-pattern: `findMany` with no `where`/`limit`,
then `.filter(...)` and `.slice(...)` in JS.

- `src/services/reservation.service.ts` — `listForAdmin()` at lines 300-328:

```ts
async listForAdmin(filters: ListReservationsFilters) {
  const allReservations = await this.db.query.reservations.findMany({
    with: { user: true, space: true, recurrence: true },
    orderBy: (r, { desc }) => [desc(r.date)],
  });

  const filtered = allReservations.filter((reservation) => {
    if (filters.spaceId && reservation.spaceId !== filters.spaceId) return false;
    if (filters.userId && reservation.userId !== filters.userId) return false;
    if (filters.status && reservation.status !== filters.status) return false;
    if (filters.dateFrom && reservation.date < filters.dateFrom) return false;
    if (filters.dateTo && reservation.date > filters.dateTo) return false;
    return true;
  });

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / filters.limit));
  const start = (filters.page - 1) * filters.limit;

  return {
    data: filtered.slice(start, start + filters.limit),
    pagination: { page: filters.page, limit: filters.limit, total, totalPages },
  };
}
```

- `src/services/blocking.service.ts` — `listActive()` at lines 167-194: same
  shape, filters on `status === 'active'`, `spaceId`, `dateFrom`, `dateTo`;
  joins `creator` and `space`; orders by `asc(date)`.
- `src/services/invitation.service.ts` — `list()` at lines 124-152: same shape.
  Its status filter is **derived**, not a column — `pending`/`accepted`/
  `expired`/`revoked`/`all` are computed from `acceptedAt`, `revokedAt`, and
  `expiresAt` vs `now` (see lines 134-142). Push what maps cleanly to SQL and
  keep the rest correct (see Step 3 for the exact mapping).

### Drizzle query conventions already used in this repo

`findMany` already supports SQL-level `where`, `limit`, `offset`, and `orderBy`
elsewhere in the same file — see `listByUser` in
`src/services/reservation.service.ts:290-298`:

```ts
return this.db.query.reservations.findMany({
  where: eq(reservations.userId, userId),
  with: { space: true },
  orderBy: (r, { desc }) => [desc(r.date)],
  limit,
  offset: (page - 1) * limit,
});
```

For the `total` count, use the `count()` aggregate exactly as
`enforceActiveLimit` does in the same file (lines 385-388):

```ts
const [row] = await this.db
  .select({ total: count() })
  .from(reservations)
  .where(/* same conditions */);
```

`count` is already imported in `reservation.service.ts` (line 8). For blocking
and invitation services you will need to add imports — see each step.

Build conditions as an array and combine with `and(...)`:

```ts
import { and, eq, gte, lte } from 'drizzle-orm';

const conditions = [];
if (filters.spaceId) conditions.push(eq(reservations.spaceId, filters.spaceId));
if (filters.status)  conditions.push(eq(reservations.status, filters.status));
if (filters.dateFrom) conditions.push(gte(reservations.date, filters.dateFrom));
if (filters.dateTo)   conditions.push(lte(reservations.date, filters.dateTo));
const where = conditions.length ? and(...conditions) : undefined;
```

ISO date strings (`YYYY-MM-DD`) sort and compare lexicographically, so
`gte`/`lte` on the `date` text column reproduce the existing `<`/`>` JS logic.

## Commands you will need

| Purpose   | Command            | Expected on success |
|-----------|--------------------|---------------------|
| Typecheck | `npm run typecheck`| exit 0, no errors   |
| Tests     | `npm test`         | all pass            |

## Scope

**In scope**:
- `src/services/reservation.service.ts` (method `listForAdmin` only)
- `src/services/blocking.service.ts` (method `listActive` only)
- `src/services/invitation.service.ts` (method `list` only)
- `tests/unit/services/reservation.service.test.ts` (add tests)
- `tests/unit/services/blocking.service.test.ts` (add tests)
- `tests/unit/services/invitation.service.test.ts` (add tests)

**Out of scope** (do NOT touch):
- The return shape `{ data, pagination: { page, limit, total, totalPages } }` —
  callers (admin views) depend on it. Keep it identical.
- `listByUser`, `listBySpace`, and any other method in these files.
- Route files and admin view files.

## Git workflow

- Branch: `perf/admin-list-sql-pagination`
- One commit per service is fine, or a single squashed commit; message style:
  `perf(reservations): paginate admin reservation list in SQL`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Rewrite `ReservationService.listForAdmin`

Replace the body so the `where` conditions, `orderBy`, `limit`, and `offset` run
in the `findMany`, and `total` comes from a `count()` query over the same
conditions. Preserve the exact return shape. Keep `with: { user, space, recurrence }`
and `orderBy desc(date)`.

Target shape:

```ts
async listForAdmin(filters: ListReservationsFilters) {
  const conditions = [];
  if (filters.spaceId) conditions.push(eq(reservations.spaceId, filters.spaceId));
  if (filters.userId)  conditions.push(eq(reservations.userId, filters.userId));
  if (filters.status)  conditions.push(eq(reservations.status, filters.status));
  if (filters.dateFrom) conditions.push(gte(reservations.date, filters.dateFrom));
  if (filters.dateTo)   conditions.push(lte(reservations.date, filters.dateTo));
  const where = conditions.length ? and(...conditions) : undefined;

  const [data, [countRow]] = await Promise.all([
    this.db.query.reservations.findMany({
      where,
      with: { user: true, space: true, recurrence: true },
      orderBy: (r, { desc }) => [desc(r.date)],
      limit: filters.limit,
      offset: (filters.page - 1) * filters.limit,
    }),
    this.db.select({ total: count() }).from(reservations).where(where),
  ]);

  const total = countRow?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / filters.limit));

  return {
    data,
    pagination: { page: filters.page, limit: filters.limit, total, totalPages },
  };
}
```

Ensure `lte` is added to the `drizzle-orm` import at the top of the file (it
currently imports `eq, and, gte`; `count` is already imported).

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Rewrite `BlockingService.listActive`

Same transformation. Conditions: always `eq(blockings.status, 'active')`, plus
optional `spaceId`, `dateFrom` (`gte`), `dateTo` (`lte`). Keep
`with: { creator: true, space: true }` and `orderBy asc(date)`. Use `count()`
for total.

Add the needed imports to `src/services/blocking.service.ts`: it currently
imports `eq, and` from `drizzle-orm` — add `gte, lte, count`.

**Verify**: `npm run typecheck` → exit 0.

### Step 3: Rewrite `InvitationService.list`

The status filter here is derived from columns, not a single column. Translate
each status to SQL predicates (use `now = new Date().toISOString()`):

- `accepted` → `isNotNull(invitations.acceptedAt)`
- `revoked`  → `isNotNull(invitations.revokedAt)`
- `expired`  → `and(lt(invitations.expiresAt, now), isNull(invitations.acceptedAt), isNull(invitations.revokedAt))`
- `pending`  → `and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gte(invitations.expiresAt, now))`
- `all` / undefined → no condition

`isNull`, `isNotNull`, `lt`, `gte`, `and` are already imported in
`src/services/invitation.service.ts` (line 1). Add `count`. Keep
`orderBy desc(createdAt)`, apply `limit`/`offset`, and compute `total` with a
`count()` query over the same `where`. Preserve the return shape.

**Verify**: `npm run typecheck` → exit 0.

### Step 4: Add tests for each rewritten method

For each service test file, add a small block that asserts (a) the conditions
and pagination are passed to the query, and (b) the returned shape is correct.
Because the mock `findMany` ignores the args and returns whatever you set, drive
the assertions off the mock call args and the `count` mock.

Pattern (reservation example) — model on existing tests in
`tests/unit/services/reservation.service.test.ts`:

```ts
describe('ReservationService.listForAdmin', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: ReservationService;

  beforeEach(() => {
    db = createMockDb();
    service = new ReservationService(db);
  });

  it('queries with pagination and returns the standard shape', async () => {
    db.query.reservations.findMany.mockResolvedValue([SEED.reservation]);
    db._select.where.mockResolvedValue([{ total: 1 }]);

    const result = await service.listForAdmin({ page: 1, limit: 20 });

    expect(result.data).toHaveLength(1);
    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    // pagination pushed into the query, not done in JS:
    const callArg = db.query.reservations.findMany.mock.calls[0][0];
    expect(callArg.limit).toBe(20);
    expect(callArg.offset).toBe(0);
  });

  it('passes a status filter into the where clause', async () => {
    db.query.reservations.findMany.mockResolvedValue([]);
    db._select.where.mockResolvedValue([{ total: 0 }]);

    await service.listForAdmin({ status: 'confirmed', page: 2, limit: 10 });

    const callArg = db.query.reservations.findMany.mock.calls[0][0];
    expect(callArg.offset).toBe(10); // (page-1)*limit
    expect(callArg.where).toBeDefined();
  });
});
```

Add equivalent blocks to `blocking.service.test.ts` (for `listActive`, where the
status='active' condition is always present) and `invitation.service.test.ts`
(for `list`, covering at least `pending` and `all`).

**Verify**: `npm test` → all pass, including the new tests.

## Test plan

- Reservation: standard shape + pagination args + a status filter passed to `where`.
- Blocking: standard shape + the always-on `active` condition + a `dateFrom` filter.
- Invitation: `pending` and `all` paths produce a query and the standard shape.
- All pre-existing tests in the three files continue to pass.
- Verification: `npm test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0; new `listForAdmin` / `listActive` / `list` tests exist and pass
- [ ] `grep -n "\.filter(" src/services/reservation.service.ts` no longer shows a `.filter(` inside `listForAdmin` (the method uses `where`, not JS filtering)
- [ ] `grep -n "findMany" src/services/blocking.service.ts` shows `listActive` calling `findMany` with `limit`/`offset` (not loading all rows)
- [ ] The returned object shape `{ data, pagination: { page, limit, total, totalPages } }` is unchanged in all three methods
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for plan 002 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any of the three methods no longer matches its "Current state" description.
- A caller (admin view) reads a field from the result that the new shape would
  drop — if so the shape would change, which is out of scope.
- The invitation status mapping in Step 3 cannot reproduce the existing JS
  semantics for a status (e.g. an edge case where `acceptedAt` and `revokedAt`
  are both set) — report the discrepancy rather than guessing.

## Maintenance notes

- If new filters are added to any of these list endpoints, add them as
  `conditions.push(...)` entries so they stay in SQL — do not reintroduce JS
  `.filter()` post-pass.
- A reviewer should confirm the `count()` query uses the **same** `where` as the
  data query (otherwise `total` and `data` disagree).
- The `invitations` table already has indexes on `email` and `expiresAt`
  (`schema.ts:217-218`); if filtering by `status`-derived predicates becomes hot,
  consider a covering index, but that is deferred out of this plan.
</content>
