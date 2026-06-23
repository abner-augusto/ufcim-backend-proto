# Plan 001: Recurring reservations are explicitly exempt from the active-reservation cap

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ad08a7d..HEAD -- src/services/reservation.service.ts tests/unit/services/reservation.service.test.ts`
> If either in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `ad08a7d`, 2026-06-23

## Why this matters

`ReservationService.createRecurring` calls `enforceActiveLimit(userId, userRole)`
**once**, before its insert loop, then inserts one confirmed reservation per
recurring date with no further limit check. The product decision is that
**recurring series are exempt** from the per-role active-reservation cap (a
semester-long weekly class is legitimately many reservations). The current code
contradicts that intent in a harmful way: a professor who already holds 10
active reservations (the cap) is *blocked from creating any series at all* by
the up-front check, even though the series itself is supposed to be exempt.
Meanwhile the check provides no real cap (the loop is unbounded). The check is
therefore both wrong (blocks legitimate exempt usage) and useless (doesn't cap
the series). Removing it makes the code match the decided policy.

## Current state

- `src/services/reservation.service.ts` — `createRecurring()` begins at line 115.
  The role gate (line 116-118) and the up-front limit check (line 120) look like
  this today:

```ts
async createRecurring(userId: string, userRole: string, userDept: string, input: CreateRecurringInput) {
  if (!['professor', 'staff'].includes(userRole)) {
    throw new ForbiddenError('Apenas professores e funcionários podem criar reservas recorrentes');
  }

  await this.enforceActiveLimit(userId, userRole);   // ← line 120, REMOVE THIS

  const space = await this.db.query.spaces.findFirst({ where: eq(spaces.id, input.spaceId) });
  if (!space) throw new NotFoundError('Space');

  this.assertDepartmentAccess(userRole, userDept, space.department);
  // ... loop that inserts one reservation per date ...
}
```

- `enforceActiveLimit` (line 376) is **still used** by the single-reservation
  path `create()` (line 74) — do NOT delete the method itself, only its call
  inside `createRecurring`.
- The role gate at line 116 already prevents `student` and `maintenance` from
  reaching this code, so removing the limit call does not open recurring
  creation to roles that shouldn't have it.

### Repo conventions to follow

- Tests live under `tests/unit/services/` and use the Drizzle mock in
  `tests/unit/helpers/mock-db.ts`. Study the existing
  `describe('ReservationService.createRecurring', ...)` block in
  `tests/unit/services/reservation.service.test.ts:234-346` and match its style.
- In that mock, the active-limit count query resolves through
  `db._select.where` (see `reservation.service.test.ts:96` for an example of
  `db._select.where.mockResolvedValueOnce([{ total: 10 }])`).
- Commit messages follow Conventional Commits, e.g. `fix(reservations): ...`
  (see `git log`).

## Commands you will need

| Purpose   | Command            | Expected on success |
|-----------|--------------------|---------------------|
| Typecheck | `npm run typecheck`| exit 0, no errors   |
| Tests     | `npm test`         | all pass            |

## Scope

**In scope** (the only files you should modify):
- `src/services/reservation.service.ts`
- `tests/unit/services/reservation.service.test.ts`

**Out of scope** (do NOT touch, even though they look related):
- `enforceActiveLimit` method body and its call in `create()` — the
  single-reservation cap stays exactly as is.
- `src/routes/reservations.ts` — the route already gates roles correctly.
- The README reservation-limits table — it describes single reservations and
  remains accurate.

## Git workflow

- Branch: `fix/recurring-active-limit`
- One commit; message style: `fix(reservations): exempt recurring series from the active-reservation cap`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Remove the up-front limit call from `createRecurring`

In `src/services/reservation.service.ts`, delete this single line (currently
line 120) and the blank line it leaves behind:

```ts
    await this.enforceActiveLimit(userId, userRole);
```

Leave the role gate (lines 116-118), the space lookup, and the rest of the
method untouched.

**Verify**: `npm run typecheck` → exit 0. Then
`grep -n "enforceActiveLimit" src/services/reservation.service.ts` → returns
exactly two lines: the call inside `create()` and the method definition
(`private async enforceActiveLimit`). It must NOT appear inside
`createRecurring`.

### Step 2: Add a regression test proving the exemption

In `tests/unit/services/reservation.service.test.ts`, inside the existing
`describe('ReservationService.createRecurring', ...)` block, add a test that a
professor already at the active cap can still create a series. Model it on the
existing "skips conflicting dates" test (line 304):

```ts
it('allows a professor at the active-reservation cap to still create a series', async () => {
  db.query.spaces.findFirst.mockResolvedValue(SEED.space);
  db.query.reservations.findMany.mockResolvedValue([]); // all slots free
  db.query.blockings.findMany.mockResolvedValue([]);
  // Simulate the user already holding the cap. If createRecurring still called
  // enforceActiveLimit, this would surface as a RESERVATION_LIMIT error.
  db._select.where.mockResolvedValue([{ total: 10 }]);

  const result = await service.createRecurring(OTHER_USER_ID, 'professor', SEED.space.department, {
    spaceId: SPACE_ID,
    startDate: '2099-06-02', // Monday
    endDate: '2099-06-16',   // 3 Mondays
    dayOfWeek: 1,
    startTime: START_TIME,
    endTime: END_TIME,
    description: 'Weekly lecture',
  });

  expect(result.created.length).toBeGreaterThan(0);
  expect(result.skipped).toHaveLength(0);
});
```

**Verify**: `npm test` → all pass, including the new test. Confirm the test
count increased by 1 versus the pre-change run (was 310).

## Test plan

- New test: a professor at the cap (`{ total: 10 }`) still creates a full
  series — proves the exemption and guards against re-introducing the check.
- Existing `createRecurring` tests (role gates, department gate, skip-on-
  conflict) must continue to pass unchanged.
- Verification: `npm test` → all pass (311 tests).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0; the new "at the active-reservation cap" test exists and passes
- [ ] `grep -n "enforceActiveLimit" src/services/reservation.service.ts` shows it only in `create()` and the method definition — not in `createRecurring`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for plan 001 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `createRecurring` in the live code no longer matches the "Current state"
  excerpt (it has been refactored since this plan was written).
- Removing the call causes any existing test to fail (it should not — that would
  mean a test was asserting the now-removed behavior, which needs a human
  decision).
- You find a second active-limit enforcement point inside the recurring loop
  that this plan didn't account for.

## Maintenance notes

- If a future product decision reverses this (recurring should be capped), the
  fix is to enforce the limit *per insert inside the loop* and stop early /
  report skipped-for-limit dates — not to restore the single up-front check,
  which never actually capped anything.
- A reviewer should confirm the single-reservation path `create()` still
  enforces the cap (its `enforceActiveLimit` call at line 74 is untouched).
</content>
</invoke>
