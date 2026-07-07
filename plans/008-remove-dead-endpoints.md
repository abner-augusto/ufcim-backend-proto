# Plan 008: Remove four authenticated endpoints with zero consumers

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 431ac33..HEAD -- src/routes/reservations.ts src/routes/equipment.ts src/routes/space-managers.ts src/app.ts`
> Also re-run the consumer check in Step 1 — a consumer may have appeared
> since planning.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW (removal of GET-only routes verified unused in both repos)
- **Category**: tech-debt
- **Depends on**: none
- **Planned at**: commit `431ac33`, 2026-07-02 (frontend cross-checked at `174c97b`)

## Why this matters

Four authenticated GET endpoints are exposed, maintained, and testable — but
nothing calls them: not the Vue SPA (`../UFCIM-FRONT3D/src/services/api.ts`
has no method for any of these paths), and not the backend's own HTMX admin
dashboard (it calls services in-process, not its own JSON API). They look like
an earlier design for data the frontend now gets embedded on
`GET /spaces/:id` responses. Dead API surface is attack/maintenance surface:
every schema change must consider endpoints nobody uses.

## Current state

The four routes (all verified mounted in `src/app.ts` and verified
consumer-less on 2026-07-02):

```ts
// src/routes/reservations.ts:134-142
reservationRoutes.get('/space/:spaceId', async (c) => {
  ...
  const data = await service.listBySpace(c.req.param('spaceId'), date);
  return c.json(data);
});

// src/routes/equipment.ts:133-139
equipmentRoutes.get('/space/:spaceId', async (c) => {
  ...
  const data = await service.listBySpace(c.req.param('spaceId'));
  return c.json(data);
});

// src/routes/space-managers.ts:45-51
spaceManagerRoutes.get('/:spaceId/managers', async (c) => {
  ...
  const managers = await service.listBySpace(c.req.param('spaceId'));
  return c.json(managers);
});

// src/routes/space-managers.ts:53-62
export const userManagedSpacesRoutes = new Hono<AppEnv>();
userManagedSpacesRoutes.get('/:userId/managed-spaces', async (c) => {
  ...
  const spaces = await service.listByUser(c.req.param('userId'));
  return c.json(spaces);
});
```

Known references that are NOT consumers:
- `tests/endpoints.http:156-157, 234-239` — a manual REST-client scratchpad;
  update it as part of this plan.
- `tests/unit/services/space-manager.service.test.ts` — tests the **service
  methods**, which may stay (see Step 2's caller analysis).
- Underlying service methods (`ReservationService.listBySpace`,
  `EquipmentService.listBySpace`, `SpaceManagerService.listBySpace/.listByUser`)
  may have OTHER callers (admin dashboard, other services) — the routes are
  confirmed dead; each service method must be checked individually before
  removal.

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npm run typecheck` | exit 0              |
| Tests     | `npm test`          | all pass            |

## Scope

**In scope**:
- The four route handlers above (delete)
- `src/app.ts` (only if a route file/export becomes empty and its mount is dead)
- Service methods **proven** caller-less in Step 2 (delete, with their tests)
- `tests/endpoints.http` (remove the dead requests)
- Route-level tests that exercised the removed endpoints

**Out of scope**:
- Any POST/DELETE handlers in the same files (e.g. space-manager
  assignment routes) — only the four GETs listed are dead.
- Service methods with surviving callers.
- The frontend repo.

## Git workflow

- Branch: `chore/remove-dead-endpoints` + PR to `main` (API-surface change →
  PR per convention). Conventional commit, e.g.
  `chore(api): remover endpoints sem consumidores`. No Co-Authored-By
  trailer. Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Re-verify the routes are still unconsumed

```
grep -rn "reservations/space\|equipment/space\|/managers\|managed-spaces" \
  ../UFCIM-FRONT3D/src ../UFCIM-FRONT3D/tests src/admin src/routes tests/unit
```

Expected: hits only in the four route definitions themselves,
`tests/endpoints.http`, and service-level tests. Any hit in
`../UFCIM-FRONT3D/src`, `src/admin`, or a route test that represents a real
HTTP call → STOP (a consumer appeared).

### Step 2: Map service-method callers

For each of `ReservationService.listBySpace`, `EquipmentService.listBySpace`,
`SpaceManagerService.listBySpace`, `SpaceManagerService.listByUser`:
`grep -rn "\.listBySpace\|\.listByUser" src/` and classify each hit. A method
is removable only if its ONLY caller is the route being deleted. Note:
`BlockingService` has its own unrelated `listBySpace`/`listByUser`
(`blocking.service.ts:144,155`) — don't confuse the classes; judge by which
service instance the call sits on.

**Verify**: a written list (in your report) of keep/remove per method with
the caller evidence.

### Step 3: Delete the four route handlers

Remove the handlers (and their now-unused imports). If
`userManagedSpacesRoutes` becomes an empty Hono instance, delete the export
and its mount in `src/app.ts`; same for any other emptied export. Do not
touch sibling handlers.

**Verify**: `npm run typecheck` → exit 0.

### Step 4: Delete orphaned service methods and their tests

Per the Step 2 list only. When removing a method, remove its cases from the
service test file too.

**Verify**: `npm run typecheck && npm test` → exit 0.

### Step 5: Clean the scratchpad

Remove the corresponding request blocks from `tests/endpoints.http`
(around lines 156-157 and 234-239).

**Verify**: `grep -n "reservations/space\|equipment/space" tests/endpoints.http` → no matches.

## Test plan

No new tests — removal only. Full suite green is the gate. Additionally,
smoke the dev server: `npm run dev`, `GET /api/v1/spaces` (with a dev token)
still works, and the removed paths now 404.

## Done criteria

- [ ] The four route paths return 404 on the dev server
- [ ] `npm run typecheck` and `npm test` exit 0
- [ ] Step 2 caller-analysis list included in the completion report
- [ ] `tests/endpoints.http` has no requests to removed paths
- [ ] `plans/README.md` status row updated

## STOP conditions

- Step 1 finds a real consumer — report it; the finding's premise is void.
- The operator/product owner has a near-term feature needing any of these
  (e.g. a space-manager assignment UI in the SPA) — if you have a channel to
  ask, ask before deleting; otherwise proceed (git history preserves them)
  but flag the possibility prominently in the PR description.
- A service method's caller analysis is ambiguous (dynamic dispatch, string
  building) — keep the method, remove only the route, and say so.

## Maintenance notes

- If space-manager management ever comes to the SPA, resurrect from git
  history (`431ac33`) rather than rewriting.
- Reviewer: confirm no POST/DELETE handler was removed — this plan is
  GET-only removal, and `space-managers.ts` mixes both kinds in one file.
