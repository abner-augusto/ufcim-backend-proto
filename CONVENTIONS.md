# CONVENTIONS.md

> Code style, patterns, and anti-patterns for the UFCIM codebase. Follow these consistently.

---

## TypeScript

### Strict Mode

`tsconfig.json` has `"strict": true`. Never use `any`. If a type is genuinely unknown, use `unknown` and narrow it.

### Imports

Use path aliases. Prefer named imports over default imports for non-component modules.

```typescript
// Good
import { ReservationService } from '@/services/reservation.service';
import { eq, and } from 'drizzle-orm';
import type { Env } from '@/types/env';

// Bad
import ReservationService from '../../../services/reservation.service';
```

### Type-Only Imports

Use `import type` when importing only types. This produces no runtime code.

```typescript
import type { Database } from '@/db/client';
import type { JwtPayload } from '@/middleware/auth';
```

### Error Handling

Never swallow errors silently. Use custom error classes from `@/middleware/error-handler`.

```typescript
// Good
if (!reservation) throw new NotFoundError('Reservation');
if (conflict) throw new ConflictError('Time slot already reserved');

// Bad
if (!reservation) return null;  // Caller has no idea why
if (conflict) return { error: 'conflict' };  // Untyped ad-hoc error
```

---

## Hono Routes

### Pattern

Every route handler follows this exact structure:

```typescript
routeGroup.method(
  '/path',
  ...middleware,  // rbac, validate, etc.
  async (c) => {
    // 1. Get DB and create service
    const db = createDb(c.env.DB);
    const service = new SomeService(db);

    // 2. Extract auth context
    const user = c.get('user');

    // 3. Get validated data (if applicable)
    const body = c.get('validatedBody');

    // 4. Call service (one call, not multiple)
    const result = await service.doSomething(user.sub, body);

    // 5. Return response with correct status code
    return c.json(result, 201);
  }
);
```

### Status Codes

- `200` — GET success, PATCH/PUT success
- `201` — POST success (resource created)
- `400` — Validation error, business rule violation
- `401` — No/invalid JWT
- `403` — Wrong role
- `404` — Resource not found
- `409` — Conflict (double booking, duplicate)
- `500` — Unhandled error (caught by global handler)

### Route Grouping

One file per resource. Each file exports a Hono instance.

```typescript
// src/routes/reservations.ts
export const reservationRoutes = new Hono<{ Bindings: Env }>();
reservationRoutes.post('/', ...);
reservationRoutes.get('/mine', ...);
```

Mounted in `app.ts` under `/api/v1`:

```typescript
api.route('/reservations', reservationRoutes);
```

---

## Services

### Constructor Pattern

Services take a `Database` instance in the constructor. They are instantiated per-request in route handlers (stateless, no caching).

```typescript
export class ReservationService {
  constructor(private db: Database) {}

  async create(userId: string, role: string, input: CreateReservationInput) {
    // ...
  }
}
```

### Method Signatures

- First parameter is always the acting user's ID (from JWT `sub`)
- Second parameter is the user's role (when needed for authorization)
- Last parameter is the validated input data
- Return the created/updated entity, not a response object

```typescript
// Good
async create(userId: string, role: string, input: CreateReservationInput): Promise<Reservation>

// Bad
async create(req: Request): Promise<Response>  // Services don't know about HTTP
```

### Side Effects

When a mutation has side effects (notifications, audit logs), handle them in the same service method. Don't rely on the route handler to coordinate multiple service calls.

```typescript
async create(userId: string, role: string, input: CreateReservationInput) {
  // 1. Validate business rules
  // 2. Insert record
  // 3. Create audit log  <-- side effect
  // 4. Create notification <-- side effect
  // 5. Return created record
}
```

### Private Helpers

Prefix with no access modifier (TypeScript private). Use for shared validation logic within a service.

```typescript
private async checkSlotAvailability(spaceId: string, date: string, timeSlot: string) { ... }
private async enforceStudentLimit(userId: string) { ... }
```

---

## Drizzle ORM

### Schema

All tables defined in `src/db/schema.ts`. Never create ad-hoc tables elsewhere.

```typescript
// All text, no dialect-specific types
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  role: text('role').notNull(),  // Enum validated by Zod, not DB
  createdAt: text('created_at').notNull(),
});
```

### Queries

Use Drizzle's query builder. Prefer `db.query.*` (relational) for reads, `db.insert/update/delete` for writes.

```typescript
// Read with relations
const result = await this.db.query.reservations.findMany({
  where: eq(reservations.spaceId, spaceId),
  with: { user: true, space: true },
  orderBy: (r, { desc }) => [desc(r.date)],
  limit: 20,
});

// Write
const [created] = await this.db.insert(reservations)
  .values({ id, spaceId, userId, ... })
  .returning();
```

### Timestamps

Always generate in the service layer, never in the schema with defaults.

```typescript
const now = new Date().toISOString();
await this.db.insert(reservations).values({
  // ...
  createdAt: now,
  updatedAt: now,
});
```

### UUIDs

Generate in the service layer.

```typescript
const id = crypto.randomUUID();
```

---

## Zod Validation

### Schema Files

One file per resource in `src/validators/`. Export named schemas.

```typescript
// src/validators/reservation.schema.ts
export const createReservationSchema = z.object({ ... });
export const updateReservationSchema = z.object({ ... });
```

### Reuse Common Schemas

Import shared schemas from `common.schema.ts`.

```typescript
import { uuidSchema, timeSlotSchema, futureDateSchema } from './common.schema';
```

### Naming

- `create<Resource>Schema` — for POST bodies
- `update<Resource>Schema` — for PUT/PATCH bodies (usually `.partial()`)
- `<resource>QuerySchema` — for GET query parameters
- `<field>Schema` — for reusable field validators

---

## Error Messages

### User-Facing

Clear, actionable. No stack traces, no internal identifiers.

```typescript
// Good
"This time slot is already reserved"
"Students can only have one active reservation at a time"
"Only professors and staff can create recurring reservations"

// Bad
"UNIQUE constraint failed: reservations.space_id"
"Error in ReservationService.create at line 47"
```

### Audit Log Details

Include enough context to reconstruct what happened.

```typescript
await this.auditLog.log(
  userId,
  'cancel_reservation',
  reservationId,
  'reservation',
  `Canceled reservation for space ${spaceId} on ${date} (${timeSlot})`
);
```

---

## File Organization

```
src/
├── app.ts                    # Hono app (framework glue only)
├── index.ts                  # Workers entry (1 line)
├── index.node.ts             # Node entry (3 lines)
├── routes/                   # HTTP layer (thin)
│   └── <resource>.ts
├── services/                 # Business logic (fat)
│   └── <resource>.service.ts
├── middleware/                # Cross-cutting concerns
│   └── <concern>.ts
├── validators/               # Zod schemas
│   └── <resource>.schema.ts
├── db/
│   ├── schema.ts             # THE schema
│   ├── client.ts             # THE connection
│   └── seed.ts
└── types/
    └── <domain>.ts
```

### Rules

- One service per resource, one route file per resource, one validator file per resource
- No `utils/` or `helpers/` folders — find a proper home or inline it
- No barrel files (`index.ts` re-exports) — import directly from the source file
- No circular imports — services can depend on other services, but routes never import routes

---

## Git Conventions

### Commit Messages

```
feat(reservations): add recurring reservation support
fix(auth): handle expired JWKS cache
refactor(services): extract slot availability check
docs: update TDD progress tracker
chore: bump drizzle-orm to 0.35
```

Prefixes: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`
Scope: the module or resource name in parentheses

### Branch Names

```
feat/recurring-reservations
fix/student-limit-check
refactor/service-error-handling
```