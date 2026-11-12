# Plan 007: Consistency sweep — error classes, route validation, and four duplicated maps/helpers

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. Each step is independent — if one hits a STOP condition, report
> it and continue with the others. When done, update the status row for this
> plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 431ac33..HEAD -- src/services/space.service.ts src/routes/spaces.ts src/middleware/rbac.ts src/lib/reservation-privacy.ts src/admin/ui.ts src/admin/views/users.view.ts src/services/report.service.ts src/validators/common.schema.ts src/lib/schedule.ts`
> On mismatch with an excerpt, treat that step (only) as a STOP.

## Status

- **Priority**: P2
- **Effort**: M (five small independent fixes)
- **Risk**: LOW
- **Category**: tech-debt
- **Depends on**: none
- **Planned at**: commit `431ac33`, 2026-07-02

## Why this matters

Five places where the codebase disagrees with its own conventions. Each is
small, but together they are the template future contributors copy: a service
throwing plain `Error` gets masked as a generic 500; one route file
hand-rolls validation every other route does through middleware; the pt-BR
role-label map exists four times (with case drift); the "department relation
or raw FK string?" dance is re-solved four times with `any` casts; and the
hourly-time regex exists in two files, written two different ways.

Background conventions (all verifiable in the code):
- **Errors**: services throw `AppError` subclasses (`NotFoundError`,
  `ConflictError`, `ForbiddenError`, …) from
  `src/middleware/error-handler.ts`; `globalErrorHandler` exposes an
  `AppError`'s message + status to the client and masks anything else as
  `"Erro interno do servidor"` 500 in production (`error-handler.ts:22-32`).
- **Validation**: routes use `validate()` / `validateQuery()` middleware with
  zod schemas from `src/validators/` — exemplar: `src/routes/logs.ts`
  (`validateQuery(logQuerySchema)` then `c.get('validatedQuery')`).

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npm run typecheck` | exit 0              |
| Tests     | `npm test`          | all pass            |

## Scope

**In scope**:
- `src/services/space.service.ts` (error classes; department helper call sites)
- `src/routes/spaces.ts` (validation middleware adoption)
- `src/lib/role-labels.ts` (create), `src/middleware/rbac.ts`,
  `src/lib/reservation-privacy.ts`, `src/admin/ui.ts`,
  `src/admin/views/users.view.ts` (role-label consolidation)
- `src/lib/department-name.ts` (create), `src/services/report.service.ts`
  (department helper call sites)
- `src/validators/common.schema.ts`, `src/lib/schedule.ts` (regex dedup)
- Test updates in `tests/unit/` where assertions encode the old behavior

**Out of scope**:
- `buildHourlyAvailability`'s interval-overlap algorithm — its migration to
  `occupancy_slots` is deferred (ROADMAP item 1, Phase 2b). You may NOT
  restructure the function; step 5 touches only regex constants.
- Response shapes of any route.
- `spaces.ts`'s audit-log call inside the availability handler.
- The admin dashboard's HTML/CSS.

## Git workflow

- Branch: `refactor/consistency-sweep` + PR to `main`. One commit per step
  (conventional commits, no Co-Authored-By trailer). Do NOT push or open a PR
  unless instructed.

## Steps

### Step 1: `ConflictError` instead of plain `Error` in space deletion

`src/services/space.service.ts:81` and `:90` currently:

```ts
throw new Error(`Não é possível remover: o espaço possui ${reservationCount} reserva(s) confirmada(s).`);
...
throw new Error(`Não é possível remover: o espaço possui ${blockingCount} bloqueio(s) ativo(s).`);
```

The file already imports `AppError, NotFoundError` from
`'@/middleware/error-handler'` (line 4). Add `ConflictError` to that import
and replace both `new Error(...)` with `new ConflictError(...)` (same
messages). Result: the public API returns 409 with the real message instead
of a masked 500, matching what the admin dashboard already shows.

**Verify**: `npm run typecheck && npm test` → exit 0. If a unit test asserted
the old generic-Error behavior, update it to expect `ConflictError` (list the
change in your report).

### Step 2: Route validation via middleware in `spaces.ts`

Two handlers hand-roll what `validateQuery` + `src/validators/common.schema.ts`
already provide:

```ts
// src/routes/spaces.ts:56-60 (availability)
const date = c.req.query('date');
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  return c.json({ error: 'O parâmetro de consulta "date" é obrigatório (YYYY-MM-DD)', code: 'VALIDATION_ERROR' }, 400);
}
```

```ts
// src/routes/spaces.ts:104-117 (report) — also a redundant manual 401 guard
const user = c.get('user');
if (!user) { return c.json({ error: 'Autenticação obrigatória', code: 'UNAUTHORIZED' }, 401); }
...
if (!startDate || !endDate) { return c.json({ error: 'startDate e endDate são obrigatórios', code: 'MISSING_DATE_RANGE' }, 400); }
if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) { ... }
```

Replace with `validateQuery(z.object({ date: dateSchema }))` on the
availability route and `validateQuery(z.object({ startDate: dateSchema,
endDate: dateSchema }))` on the report route, reading via
`c.get('validatedQuery')` — copy the wiring shape from `src/routes/logs.ts`.
`dateSchema` already exists in `src/validators/common.schema.ts:12-19`.
Delete the manual `if (!user)` 401 guard on the report route: the route
already runs behind `rbac(['professor', 'staff', 'maintenance'])`
(`spaces.ts:100`), which guarantees an authenticated user. Keep the handler
bodies (including the audit-log call) otherwise identical.

Note the deliberate contract change: validation failures on these two routes
now return the standard `VALIDATION_ERROR` shape with a `details` array (like
every other validated route) instead of the ad-hoc messages/`MISSING_DATE_RANGE`
code. Check frontend exposure first:
`grep -rn "MISSING_DATE_RANGE" ../UFCIM-FRONT3D/src/` → expect no matches
(the frontend branches on `res.ok`, not these codes). If it matches → STOP.

**Verify**: `npm run typecheck && npm test` → exit 0; update route tests that
asserted the old error bodies (list them in your report).

### Step 3: One source of truth for pt-BR role labels

Four independent copies exist today:

1. `src/middleware/rbac.ts:12-17` — `ROLE_LABELS` lowercase
   (`'estudante'`, `'funcionário'`, …) used in 403 messages.
2. `src/lib/reservation-privacy.ts:3-8` — identical lowercase copy.
3. `src/admin/ui.ts:327-332` — capitalized (`'Estudante'`,
   `'Professor(a)'`, `'Funcionário'`, `'Manutenção'`) in `renderRoleBadge`.
4. `src/admin/views/users.view.ts:95` — the same capitalized map inlined in a
   template literal:
   `{student:'Estudante',professor:'Professor(a)',staff:'Funcionário',maintenance:'Manutenção'}[r] ?? r`.

Create `src/lib/role-labels.ts`:

```ts
import type { UserRole } from '@/types/auth';

/** Lowercase, for mid-sentence use (403 messages, privacy labels). */
export const ROLE_LABELS: Record<UserRole, string> = {
  student: 'estudante', professor: 'professor',
  staff: 'funcionário', maintenance: 'manutenção',
};

/** Title-case, for standalone display (admin badges, selects). */
export const ROLE_LABELS_TITLE: Record<UserRole, string> = {
  student: 'Estudante', professor: 'Professor(a)',
  staff: 'Funcionário', maintenance: 'Manutenção',
};
```

(Confirm `UserRole` lives at `@/types/auth`; if it's elsewhere, follow the
import used by `rbac.ts`.) Replace all four sites with imports. Keep each
site's existing `?? role` / `?? r` fallback behavior where present. Note the
capitalized copies are NOT just `capitalize(lowercase)` —
`professor` → `Professor(a)` — hence two explicit maps, not a helper.

**Verify**: `npm run typecheck && npm test` → exit 0;
`grep -rn "estudante'" src/ | grep -v role-labels` → no remaining literal maps
(hits inside test fixtures are fine — judge by file path and report them).

### Step 4: One `departmentName()` helper instead of four cast-dances

Four sites re-solve "is `department` the joined relation object or the raw FK
string?":

```ts
// src/services/space.service.ts:127
return { ...space, department: space.department?.name ?? space.department as unknown as string };
// src/services/space.service.ts:143 (inside list())
rows.map((s) => ({ ...s, department: s.department?.name ?? s.department as unknown as string }))
// src/services/report.service.ts:341-343 (and a near-identical block at :469-471)
const department = space.department && typeof space.department === 'object'
  ? (space.department as any).name ?? space.department
  : space.department as unknown as string;
```

Create `src/lib/department-name.ts`:

```ts
/** The `department` field is either the joined relation (with `.name`) or the
 *  raw FK slug, depending on whether the query used `with: { department }`. */
export function departmentName(dept: { name: string } | string | null | undefined): string {
  if (dept && typeof dept === 'object') return dept.name;
  return dept ?? '';
}
```

Replace the four call sites with `departmentName(...)`. If TypeScript narrows
a specific call site such that the union doesn't fit (Drizzle's inferred
relation types can be strict), adjust the parameter type of the helper — do
NOT re-introduce `as any` at call sites.

**Verify**: `npm run typecheck && npm test` → exit 0;
`grep -n "as unknown as string" src/services/space.service.ts src/services/report.service.ts` → no matches.

### Step 5: Deduplicate the hourly-time regexes

`src/lib/schedule.ts:3-4` defines the canonical constants:

```ts
export const HOURLY_TIME_REGEX = /^([01]\d|2[0-3]):00$/;
export const BOUNDARY_TIME_REGEX = /^(?:([01]\d|2[0-3]):00|24:00)$/;
```

`src/validators/common.schema.ts:20-27` restates both patterns inline — the
hourly one byte-identically, the boundary one as `/^([01]\d|2[0-4]):00$/`
(same accepted set, different spelling — proof the copies already diverged in
form). Change `common.schema.ts` to import and use the constants:

```ts
import { HOURLY_TIME_REGEX, BOUNDARY_TIME_REGEX } from '@/lib/schedule';
export const hourlyTimeSchema = z.string().regex(HOURLY_TIME_REGEX, '…same message…');
export const boundaryTimeSchema = z.string().regex(BOUNDARY_TIME_REGEX, '…same message…');
```

Check for an import cycle first: `grep -n "from '@/validators" src/lib/schedule.ts`
→ must be empty (it is at planning time; schedule.ts imports nothing from
validators).

**Verify**: `npm run typecheck && npm test` → exit 0 (validator unit tests in
`tests/unit/validators/` prove the accepted set didn't change).

## Test plan

Each step's verification runs the full suite; steps 1-2 additionally update
the specific tests that encoded old behavior (409-vs-500, error body shape).
No new test files are required, but if `tests/unit/validators/` lacks a case
for `24:00` acceptance on `boundaryTimeSchema`, add one in step 5 (it pins
the regex-set equivalence this step relies on).

## Done criteria

- [ ] `npm run typecheck` and `npm test` exit 0
- [ ] `grep -rn "throw new Error(" src/services/space.service.ts` → no matches
- [ ] `spaces.ts` contains no inline `\d{4}-\d{2}-\d{2}` regex and no manual 401 guard
- [ ] Exactly one lowercase and one title-case role-label map exist, in `src/lib/role-labels.ts`
- [ ] `departmentName()` used at all four former cast sites
- [ ] `common.schema.ts` contains no inline hour-regex literals
- [ ] `plans/README.md` status row updated (note any step individually stopped)

## STOP conditions

- (Step 2) `MISSING_DATE_RANGE` grep in the frontend matches — the ad-hoc
  code is a live contract; report before changing it.
- (Step 4) Drizzle's relation typing forces `any` back in — report the exact
  type error instead of shipping the cast.
- (Any step) more than ~3 test files need updating for that step — the blast
  radius is bigger than planned; report.

## Maintenance notes

- New routes should copy `logs.ts`, not old `spaces.ts` — with step 2 done,
  no route models the hand-rolled pattern anymore.
- If a role is ever added, `role-labels.ts` + the `UserRole` union are the
  only label/type sites; typecheck will surface every consumer.
- `common.schema.ts` still exports `uuidSchema`/`userRoleSchema` with zero
  importers (audit 2026-07-02) — left in place as intentional validator
  vocabulary; delete only if a future sweep confirms they stay unused.
