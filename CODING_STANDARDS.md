# Coding standards

Judgement calls a reviewer applies in this repository, beyond what `bash scripts/check` enforces. Each line names where the repository decided it.

- **Errors**: a service throws an `AppError` subclass from `src/middleware/error-handler.ts` (`NotFoundError`, `ConflictError`, `ForbiddenError`, `UnauthorizedError`). `globalErrorHandler` shows an `AppError`'s message and status to the client and masks anything else as a generic 500 in production. (`docs/archive/plans/007-consistency-sweep.md`)
- **Validation**: a route validates input through the `validate()` / `validateQuery()` middleware with a Zod schema from `src/validators/`; `src/routes/logs.ts` is the exemplar. (`docs/archive/plans/007-consistency-sweep.md`)
- **Campus time**: "today" and "now" come from `campusToday()` / `campusNowMinutes()` in `src/lib/clock.ts`. Workers run in UTC and the campus is UTC-3, so a raw `new Date()` comparison drifts by a day between 21:00 and 24:00 local. (commit `c12e8f9`)
- **List endpoints**: filter in SQL, then paginate. Filtering in memory after a paginated query drops rows. (`docs/archive/plans/005-equipment-report-pagination-fix.md`, also 002 and 006)
- **Availability is derived**: the per-slot status (`available` / `reserved` / `blocked` / `closed`) is computed by `buildAvailability()` and never persisted. A divisible room is modelled as distinct spaces. (`docs/ARCHITECTURE.md`, "Modelo de agendamento")
- **Secrets**: none in `wrangler.toml`, docs or plans; they live in `wrangler secret` (production) and `.dev.vars` (local). (`docs/ARCHITECTURE.md`, "Postura de segurança")
