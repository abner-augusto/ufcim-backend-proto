# Plan 009: Reject same-day reservations whose time slot already passed (BUG-005)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 09fe163..HEAD -- src/services/reservation.service.ts src/validators/common.schema.ts src/lib/ tests/unit/services/reservation.service.test.ts tests/unit/validators/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (additive check + one refine change; SEED test dates are in 2099 so existing tests are unaffected)
- **Category**: bug
- **Depends on**: none
- **Planned at**: commit `09fe163`, 2026-07-07
- **Source**: QA kanban card **BUG-005** ("Backend aceita reserva em horário já vencido no mesmo dia", validated 08/06: `POST` for today 07:00–08:00 at ~15h returned 201)

## Why this matters

The backend rejects reservations for **past dates** (`futureDateSchema`) but
never validates the **hour** when the date is today — a direct POST for
today 07:00–08:00 at 15h returns 201. The frontend already disables past
hours in its grid, but the backend is the declared source of truth
(frontend `AGENTS.md`: "Frontend checks are UX only; the backend is the
source of truth"), so anyone bypassing the UI can book slots that already
happened. There is also a latent timezone hole: "today" is computed in UTC,
but the campus is in Fortaleza (UTC−3, no DST), so between 21:00 and 24:00
local time the UTC date is already *tomorrow* and `futureDateSchema` wrongly
rejects reservations for the still-current local day. This plan fixes both
with one campus-clock helper.

## Current state

- `src/services/reservation.service.ts` — `checkSlotAvailability` (lines
  359-391) checks closed hours, reservation overlaps, and blocking overlaps —
  no clock check anywhere:

```ts
// src/services/reservation.service.ts:359-368
private async checkSlotAvailability(
  space: { closedFrom: string; closedTo: string },
  spaceId: string,
  date: string,
  startTime: string,
  endTime: string
) {
  if (overlapsClosedHours(startTime, endTime, space.closedFrom, space.closedTo)) {
    throw new ConflictError('Esta faixa de horário está dentro do período em que o espaço permanece fechado');
  }
  // ... then overlap checks against reservations and blockings
```

  Both `create()` (line 65) and `createRecurring()` (line 150) call it.
  `createRecurring` wraps each date in `try { checkSlotAvailability; insert }
  catch { skipped.push(...) }` (lines 148-174), so a throw for one date just
  skips that occurrence — desired behavior for a series that includes today
  with an already-past hour.

- `src/validators/common.schema.ts:17-20` — the date-only validator, UTC-based:

```ts
export const futureDateSchema = dateSchema.refine(
  (d) => new Date(d) >= new Date(new Date().toISOString().split('T')[0]),
  'A data não pode ser no passado'
);
```

- `src/lib/schedule.ts` — pure time-string helpers; `timeToMinutes(time)`
  (line 6) converts `"HH:MM"` to minutes since midnight. There is currently
  **no clock/timezone code anywhere in `src/`** (verified by grep for
  `Fortaleza|timeZone|getTimezoneOffset`).

- **Frontend semantics to match** (`../UFCIM-FRONT3D/src/composables/useAvailabilitySelection.ts:66-68`):
  a slot is "past" only when its **end** has passed —
  `new Date(\`${date}T${slot.endTime}:00\`).getTime() <= now`. The in-progress
  hour (started but not finished) is deliberately still bookable
  (`useDateTimeFilter.ts:43-45`: "The in-progress hour stays reservable (it
  ends later)"). The backend rule must not be stricter than the UI, or users
  clicking an allowed slot would get errors. Since reservations are hourly
  (`hourlyTimeSchema`), "the first hour of the range has already ended" ⟺
  `timeToMinutes(startTime) + 60 <= nowMinutes`.

- Error convention: services throw `AppError` subclasses from
  `@/middleware/error-handler` (`ConflictError` → 409). Exemplar: the
  closed-hours throw at `reservation.service.ts:366-368`. Match it.

- Test convention: `tests/unit/services/reservation.service.test.ts` uses
  `createMockDb()` + `SEED` from `tests/unit/helpers/mock-db` (SEED dates are
  `2099-06-15`, so they never collide with "today"). Vitest is available;
  use `vi.useFakeTimers()` + `vi.setSystemTime()` to pin the clock.

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Install   | `npm install`       | exit 0 (only needed in a fresh worktree) |
| Typecheck | `npm run typecheck` | exit 0              |
| Tests     | `npm test`          | all pass (337+ before this plan) |
| Single file | `npx vitest run tests/unit/services/reservation.service.test.ts` | pass |

## Scope

**In scope**:
- `src/lib/clock.ts` (create)
- `src/services/reservation.service.ts` (only `checkSlotAvailability` + imports)
- `src/validators/common.schema.ts` (only `futureDateSchema`)
- `tests/unit/services/reservation.service.test.ts` (add cases)
- `tests/unit/validators/` (add/extend the common-schema test file there)

**Out of scope**:
- `BlockingService` and `blocking.schema.ts` behavior beyond what the shared
  `futureDateSchema` change implies — do NOT add an hour check to blockings
  (staff may legitimately register a block for an hour in progress; the
  kanban issue is scoped to reservations).
- The frontend repo.
- `updateReservationSchema` / update flows.
- Any change to `buildHourlyAvailability` or the availability endpoint.

## Git workflow

- Branch: `fix/reject-past-hour-reservation` + PR to `main`. Conventional
  commit, e.g. `fix(reservations): rejeitar horário já vencido no mesmo dia`
  (history exemplar: `f6f9f67` merge of `fix/pending-reports-pagination`).
  No Co-Authored-By trailer. Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Create the campus clock helper

Create `src/lib/clock.ts`:

```ts
/**
 * Campus-local clock. The campus is in Fortaleza (America/Fortaleza, UTC-3,
 * no DST) while Workers run in UTC — date/hour comparisons for "today" must
 * use campus time, or they drift by 3 hours (and by a whole day between
 * 21:00 and 24:00 local).
 */
const CAMPUS_TIME_ZONE = 'America/Fortaleza';

function campusParts(now: Date): { date: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAMPUS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Today's date in campus time, as "YYYY-MM-DD". */
export function campusToday(now = new Date()): string {
  return campusParts(now).date;
}

/** Minutes since campus-local midnight. */
export function campusNowMinutes(now = new Date()): number {
  return campusParts(now).minutes;
}
```

(`en-CA` + `formatToParts` yields zero-padded numeric parts; `hourCycle:
'h23'` avoids the `"24"` hour edge. `Intl` with named time zones is
available on Cloudflare Workers and Node 18+.)

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Reject already-ended slots for today in `checkSlotAvailability`

In `src/services/reservation.service.ts`, add to the imports
`import { campusToday, campusNowMinutes } from '@/lib/clock';`
(and note `timeToMinutes` is already exported from `@/lib/schedule` — extend
that existing import). Then add as the **first** check inside
`checkSlotAvailability` (before the closed-hours check, line 366):

```ts
// Reject slots that already ended today (campus time). The in-progress hour
// stays bookable — the frontend grid allows it (its cells only become "past"
// when the hour ENDS), and the backend must not be stricter than the UI.
if (date === campusToday() && timeToMinutes(startTime) + 60 <= campusNowMinutes()) {
  throw new ConflictError('Esta faixa de horário já passou');
}
```

Placing it in `checkSlotAvailability` covers both `create()` and
`createRecurring()`; in the recurring loop the throw is caught and the
occurrence lands in `skipped` (existing behavior at lines 171-173) — that is
intended.

**Verify**: `npm run typecheck && npm test` → exit 0, all existing tests
still pass (SEED dates are 2099-06-15, never "today").

### Step 3: Align `futureDateSchema`'s "today" to campus time

In `src/validators/common.schema.ts`, import `campusToday` and replace the
refine:

```ts
import { campusToday } from '@/lib/clock';

export const futureDateSchema = dateSchema.refine(
  (d) => d >= campusToday(),
  'A data não pode ser no passado'
);
```

(String comparison is valid — both sides are `YYYY-MM-DD`.) This fixes the
21:00–24:00 local window where the UTC date is already tomorrow and
reservations/blockings for the still-current local day were wrongly rejected.

**Verify**: `npm run typecheck && npm test` → exit 0.

### Step 4: Tests

In `tests/unit/services/reservation.service.test.ts` (same harness as the
existing `ReservationService.create` describe block), add a describe
`'create — same-day past hour (BUG-005)'` using fake timers. Pin the clock so
campus time is unambiguous, e.g. `2099-06-15T18:30:00Z` = **15:30 campus
time** on `2099-06-15` (same date as `SEED.reservation.date`):

```ts
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2099-06-15T18:30:00Z')); // 15:30 in Fortaleza
});
afterEach(() => vi.useRealTimers());
```

Cases (all with `db.query.spaces.findFirst.mockResolvedValue(...)` returning
a reservable space in the user's department, and empty
reservation/blocking lists, as the existing tests do):

1. **Rejects an ended slot today**: `date: '2099-06-15', startTime: '14:00',
   endTime: '15:00'` → rejects with `ConflictError` (14:00+60 = 15:00 ≤ 15:30).
2. **Allows the in-progress hour**: `startTime: '15:00', endTime: '16:00'`
   → resolves (15:00+60 = 16:00 > 15:30).
3. **Allows a future hour today**: `startTime: '16:00', endTime: '17:00'` → resolves.
4. **Ignores the clock for future dates**: `date: '2099-06-16', startTime:
   '07:00'` → resolves.

In `tests/unit/validators/` (extend the existing common/reservation schema
test file there; if none covers `futureDateSchema`, create
`common.schema.test.ts` modeled on the other validator tests), with the same
fake-timer pattern:

5. **Night-window regression**: system time `2099-06-16T01:00:00Z` (= 22:00
   on 2099-06-15 in Fortaleza): `futureDateSchema.safeParse('2099-06-15').success`
   → `true` (the old UTC code returned `false`); `'2099-06-14'` → `false`;
   `'2099-06-16'` → `true`.

**Verify**: `npx vitest run tests/unit/services/reservation.service.test.ts`
→ all pass. Then temporarily comment out the Step 2 check and confirm case 1
fails (proves the test bites); restore it.

### Step 5: Full gate

**Verify**: `npm run typecheck && npm test` → exit 0, all pass.

## Test plan

Covered in Step 4 (5 cases; case 1 is the regression proof for the QA
finding, case 5 for the timezone hole). Model structure and mocking on the
existing `ReservationService.create` describe block in the same file.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0, including ≥4 new service cases and the validator case
- [ ] `grep -n "campusToday" src/services/reservation.service.ts src/validators/common.schema.ts` → one match in each
- [ ] `grep -n "toISOString().split" src/validators/common.schema.ts` → no matches
- [ ] Reverting Step 2 makes test case 1 fail (verified once, then re-applied)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `checkSlotAvailability` or `futureDateSchema` no longer match the excerpts
  (drifted since `09fe163`).
- `Intl.DateTimeFormat` with `timeZone: 'America/Fortaleza'` fails in the
  test environment (e.g. ICU-less Node build) — report; do NOT fall back to
  a hardcoded `-3` offset without approval.
- More than 3 existing tests break on Step 2 or 3 — the blast radius is
  bigger than planned (something else depends on UTC "today").
- You are tempted to add the hour check to `BlockingService` — that is out of
  scope; note it in your report instead.

## Maintenance notes

- If reservation granularity ever changes from hourly slots, the `+ 60` grace
  in Step 2 must become "duration of the first slot".
- The frontend's `isPastSlot` (frontend repo,
  `src/composables/useAvailabilitySelection.ts:66-68`) and this check encode
  the same rule on the two sides; if one changes, change the other.
- Reviewer: confirm the check uses `ConflictError` (409), not a 400 —
  the admin dashboard and SPA both surface `AppError` messages verbatim.
- Deferred: campus timezone is a constant; if a second campus in another
  timezone ever onboards, `clock.ts` needs a per-campus zone lookup.
