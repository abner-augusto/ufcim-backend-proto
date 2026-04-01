# UFCIM — AI Agent Build Guide

> **Purpose:** Step-by-step instructions for an AI coding agent to build UFCIM from scratch.
> Each section is a self-contained task with inputs, outputs, and acceptance criteria.
> Follow sections in order. Do not skip ahead.

---

## 0. Project Context

UFCIM (Federal University of Ceará Infrastructure Manager) is a web app for managing and reserving physical spaces at UFC. It supports students, professors, administrative staff, and maintenance personnel with role-based permissions.

**Architecture decision:** The prototype runs on **Cloudflare Workers** with **D1** (SQLite). The production version will run on a **university server** (Node.js + PostgreSQL). The codebase must be portable between both targets with minimal changes (entry point + DB driver only).

### Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Runtime | Cloudflare Workers (prototype) / Node.js (production) | Hono handles both |
| Framework | **Hono** | Lightweight, runtime-agnostic |
| ORM | **Drizzle ORM** | Supports D1 and PostgreSQL with same schema |
| Database | **Cloudflare D1** (prototype) / **PostgreSQL** (production) | SQLite semantics in prototype |
| Auth | **JWT validation** (prototype) / **Keycloak + LDAP** (production) | Stateless token verification |
| Validation | **Zod** | Schema validation for all inputs |
| Email | Deferred in prototype / **SMTP** in production | Use Cloudflare Queues when ready |
| Admin UI | Separate SPA (HTMX or React) | Not part of this build guide |

### Key Constraints

- No PostgreSQL-specific features in schema (no native ENUMs — use CHECK or app-level validation)
- All business logic in service layer, never in routes or DB layer
- Every endpoint requires JWT authentication
- UUIDs as primary keys (use `crypto.randomUUID()`)
- ISO 8601 dates everywhere
- API versioned under `/api/v1/`

---

## 1. Project Scaffolding

### 1.1 Initialize the Project

```bash
mkdir ufcim && cd ufcim
npm init -y
npm install hono drizzle-orm zod
npm install -D wrangler drizzle-kit typescript @types/node
```

### 1.2 Create Directory Structure

```
ufcim/
├── src/
│   ├── index.ts                  # Workers entry point
│   ├── index.node.ts             # Node.js entry point (production)
│   ├── app.ts                    # Hono app definition (shared)
│   ├── routes/
│   │   ├── users.ts
│   │   ├── spaces.ts
│   │   ├── equipment.ts
│   │   ├── reservations.ts
│   │   ├── blockings.ts
│   │   ├── notifications.ts
│   │   └── logs.ts
│   ├── middleware/
│   │   ├── auth.ts               # JWT verification
│   │   ├── rbac.ts               # Role-based access control
│   │   ├── error-handler.ts      # Global error handling
│   │   └── validation.ts         # Zod integration middleware
│   ├── services/
│   │   ├── user.service.ts
│   │   ├── space.service.ts
│   │   ├── equipment.service.ts
│   │   ├── reservation.service.ts
│   │   ├── blocking.service.ts
│   │   ├── notification.service.ts
│   │   └── audit-log.service.ts
│   ├── db/
│   │   ├── schema.ts             # Drizzle schema (single source of truth)
│   │   ├── client.ts             # DB connection factory
│   │   ├── client.d1.ts          # D1 driver (prototype)
│   │   ├── client.pg.ts          # PostgreSQL driver (production)
│   │   └── seed.ts               # Seed data for development
│   ├── validators/
│   │   ├── reservation.schema.ts # Zod schemas for reservations
│   │   ├── space.schema.ts
│   │   ├── equipment.schema.ts
│   │   ├── blocking.schema.ts
│   │   └── common.schema.ts      # Shared types (pagination, etc.)
│   └── types/
│       ├── env.ts                # Environment bindings type
│       ├── auth.ts               # JWT payload type
│       └── errors.ts             # Custom error classes
├── migrations/                   # Drizzle-generated SQL
├── wrangler.toml
├── drizzle.config.ts
├── tsconfig.json
└── package.json
```

### 1.3 Configuration Files

**`tsconfig.json`**
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "baseUrl": "src",
    "paths": {
      "@/*": ["./*"]
    },
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

**`wrangler.toml`**
```toml
name = "ufcim"
main = "src/index.ts"
compatibility_date = "2024-12-01"

[[d1_databases]]
binding = "DB"
database_name = "ufcim-db"
database_id = "<will be generated>"

[vars]
JWKS_URL = "https://your-keycloak/realms/ufc/protocol/openid-connect/certs"
JWT_ISSUER = "https://your-keycloak/realms/ufc"
```

**`drizzle.config.ts`**
```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'sqlite', // Change to 'postgresql' for production
});
```

### Acceptance Criteria
- [ ] `npm install` completes without errors
- [ ] All directories and config files exist
- [ ] `npx tsc --noEmit` passes with no type errors
- [ ] `wrangler d1 create ufcim-db` creates the D1 database

---

## 2. Database Schema

### 2.1 Drizzle Schema Definition

Create `src/db/schema.ts`. This is the **single source of truth** for the database.

**Design rules:**
- No SQLite/PostgreSQL-specific types — use portable Drizzle types
- UUIDs stored as `text` (D1 has no native UUID type)
- Enums enforced at application level via Zod, not DB constraints
- Timestamps as ISO 8601 text (portable across both DBs)
- No `status` column on `spaces` table — derive from reservations/blockings

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// ─── Users ───────────────────────────────────────────────────────────────────
export const users = sqliteTable('users', {
  id: text('id').primaryKey(), // UUID
  name: text('name').notNull(),
  registration: text('registration').notNull().unique(),
  role: text('role').notNull(), // 'student' | 'professor' | 'staff' | 'maintenance'
  department: text('department').notNull(),
  email: text('email').notNull().unique(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── Spaces (ambientes) ─────────────────────────────────────────────────────
export const spaces = sqliteTable('spaces', {
  id: text('id').primaryKey(),
  number: text('number').notNull(),
  type: text('type').notNull(), // 'classroom' | 'study_room' | 'meeting_room' | 'hall'
  block: text('block').notNull(),
  campus: text('campus').notNull(),
  department: text('department').notNull(),
  capacity: integer('capacity').notNull(),
  furniture: text('furniture'),
  lighting: text('lighting'),
  hvac: text('hvac'),
  multimedia: text('multimedia'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── Equipment (equipamentos) ───────────────────────────────────────────────
export const equipment = sqliteTable('equipment', {
  id: text('id').primaryKey(),
  spaceId: text('space_id').notNull().references(() => spaces.id),
  name: text('name').notNull(),
  type: text('type').notNull(),
  status: text('status').notNull(), // 'working' | 'broken' | 'under_repair' | 'replacement_scheduled'
  notes: text('notes'),
  updatedBy: text('updated_by').references(() => users.id),
  updatedAt: text('updated_at').notNull(),
});

// ─── Recurrences (recorrencias) ─────────────────────────────────────────────
export const recurrences = sqliteTable('recurrences', {
  id: text('id').primaryKey(),
  description: text('description').notNull(),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: text('created_at').notNull(),
});

// ─── Reservations (reservas) ────────────────────────────────────────────────
export const reservations = sqliteTable('reservations', {
  id: text('id').primaryKey(),
  spaceId: text('space_id').notNull().references(() => spaces.id),
  userId: text('user_id').notNull().references(() => users.id),
  date: text('date').notNull(), // ISO date: YYYY-MM-DD
  timeSlot: text('time_slot').notNull(), // 'morning' | 'afternoon' | 'evening'
  status: text('status').notNull(), // 'confirmed' | 'canceled' | 'modified' | 'overridden'
  recurrenceId: text('recurrence_id').references(() => recurrences.id),
  changeOrigin: text('change_origin'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── Blockings (bloqueios) ──────────────────────────────────────────────────
export const blockings = sqliteTable('blockings', {
  id: text('id').primaryKey(),
  spaceId: text('space_id').notNull().references(() => spaces.id),
  createdBy: text('created_by').notNull().references(() => users.id),
  date: text('date').notNull(),
  timeSlot: text('time_slot').notNull(),
  reason: text('reason').notNull(),
  blockType: text('block_type').notNull(), // 'maintenance' | 'administrative'
  status: text('status').notNull().default('active'), // 'active' | 'removed'
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── Notifications (notificacoes) ───────────────────────────────────────────
export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  message: text('message').notNull(),
  type: text('type').notNull(), // 'confirmed' | 'canceled' | 'modified' | 'overridden'
  read: integer('read', { mode: 'boolean' }).notNull().default(false),
  sentAt: text('sent_at').notNull(),
});

// ─── Audit Logs (logs) ─────────────────────────────────────────────────────
export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  actionType: text('action_type').notNull(),
  referenceId: text('reference_id'),
  referenceType: text('reference_type'), // 'reservation' | 'blocking' | 'equipment' | 'space'
  timestamp: text('timestamp').notNull(),
  details: text('details'),
});

// ─── Relations ──────────────────────────────────────────────────────────────
export const usersRelations = relations(users, ({ many }) => ({
  reservations: many(reservations),
  blockings: many(blockings),
  notifications: many(notifications),
  auditLogs: many(auditLogs),
}));

export const spacesRelations = relations(spaces, ({ many }) => ({
  equipment: many(equipment),
  reservations: many(reservations),
  blockings: many(blockings),
}));

export const reservationsRelations = relations(reservations, ({ one }) => ({
  space: one(spaces, { fields: [reservations.spaceId], references: [spaces.id] }),
  user: one(users, { fields: [reservations.userId], references: [users.id] }),
  recurrence: one(recurrences, { fields: [reservations.recurrenceId], references: [recurrences.id] }),
}));

export const blockingsRelations = relations(blockings, ({ one }) => ({
  space: one(spaces, { fields: [blockings.spaceId], references: [spaces.id] }),
  creator: one(users, { fields: [blockings.createdBy], references: [users.id] }),
}));

export const equipmentRelations = relations(equipment, ({ one }) => ({
  space: one(spaces, { fields: [equipment.spaceId], references: [spaces.id] }),
  updater: one(users, { fields: [equipment.updatedBy], references: [users.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}));
```

### 2.2 Generate and Apply Migrations

```bash
npx drizzle-kit generate
npx wrangler d1 execute ufcim-db --local --file=migrations/0000_initial.sql
```

### Acceptance Criteria
- [ ] `drizzle-kit generate` produces valid SQL migration
- [ ] Migration applies to D1 without errors
- [ ] All foreign key relationships are correct
- [ ] No PostgreSQL-specific syntax in generated SQL

---

## 3. Database Client Factory

### 3.1 Environment Types

Create `src/types/env.ts`:

```typescript
export type Env = {
  DB: D1Database;
  JWKS_URL: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE?: string;
  ENVIRONMENT: 'development' | 'staging' | 'production';
};
```

### 3.2 D1 Client (Prototype)

Create `src/db/client.ts`:

```typescript
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Database = ReturnType<typeof createDb>;
```

> **Migration note:** When moving to PostgreSQL, this file becomes:
> ```typescript
> import { drizzle } from 'drizzle-orm/postgres-js';
> import postgres from 'postgres';
> import * as schema from './schema';
>
> const connection = postgres(process.env.DATABASE_URL!);
> export const db = drizzle(connection, { schema });
> export type Database = typeof db;
> ```

### Acceptance Criteria
- [ ] `createDb()` returns a typed Drizzle instance
- [ ] All schema tables are accessible via `db.query.<tableName>`
- [ ] Type inference works (hovering over `db.query.users` shows correct columns)

---

## 4. Validation Schemas (Zod)

### 4.1 Common Schemas

Create `src/validators/common.schema.ts`:

```typescript
import { z } from 'zod';

export const uuidSchema = z.string().uuid();

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const timeSlotSchema = z.enum(['morning', 'afternoon', 'evening']);

export const userRoleSchema = z.enum(['student', 'professor', 'staff', 'maintenance']);

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format');

export const futureDateSchema = dateSchema.refine(
  (d) => new Date(d) >= new Date(new Date().toISOString().split('T')[0]),
  'Date cannot be in the past'
);
```

### 4.2 Reservation Schemas

Create `src/validators/reservation.schema.ts`:

```typescript
import { z } from 'zod';
import { uuidSchema, timeSlotSchema, futureDateSchema } from './common.schema';

export const createReservationSchema = z.object({
  spaceId: uuidSchema,
  date: futureDateSchema,
  timeSlot: timeSlotSchema,
});

export const createRecurringReservationSchema = z
  .object({
    spaceId: uuidSchema,
    startDate: futureDateSchema,
    endDate: futureDateSchema,
    dayOfWeek: z.number().int().min(0).max(6), // 0=Sunday
    timeSlot: timeSlotSchema,
    description: z.string().min(1).max(200),
  })
  .refine((d) => new Date(d.endDate) > new Date(d.startDate), {
    message: 'End date must be after start date',
    path: ['endDate'], // Zod v4: pass object so the error is attributed to the correct field
  });

export const updateReservationSchema = z.object({
  date: futureDateSchema.optional(),
  timeSlot: timeSlotSchema.optional(),
  status: z.enum(['confirmed', 'canceled', 'modified']).optional(),
});
```

### 4.3 Space Schemas

Create `src/validators/space.schema.ts`:

```typescript
import { z } from 'zod';

export const spaceTypeSchema = z.enum(['classroom', 'study_room', 'meeting_room', 'hall']);

export const createSpaceSchema = z.object({
  number: z.string().min(1).max(50),
  type: spaceTypeSchema,
  block: z.string().min(1).max(50),
  campus: z.string().min(1).max(100),
  department: z.string().min(1).max(100),
  capacity: z.number().int().positive(),
  furniture: z.string().optional(),
  lighting: z.string().optional(),
  hvac: z.string().optional(),
  multimedia: z.string().optional(),
});

export const updateSpaceSchema = createSpaceSchema.partial();
```

### 4.4 Equipment Schemas

Create `src/validators/equipment.schema.ts`:

```typescript
import { z } from 'zod';
import { uuidSchema } from './common.schema';

export const equipmentStatusSchema = z.enum([
  'working', 'broken', 'under_repair', 'replacement_scheduled'
]);

export const createEquipmentSchema = z.object({
  spaceId: uuidSchema,
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(100),
  status: equipmentStatusSchema,
  notes: z.string().optional(),
});

export const updateEquipmentStatusSchema = z.object({
  status: equipmentStatusSchema,
  notes: z.string().optional(),
});
```

### 4.5 Blocking Schemas

Create `src/validators/blocking.schema.ts`:

```typescript
import { z } from 'zod';
import { uuidSchema, timeSlotSchema, futureDateSchema } from './common.schema';

export const blockTypeSchema = z.enum(['maintenance', 'administrative']);

export const createBlockingSchema = z.object({
  spaceId: uuidSchema,
  date: futureDateSchema,
  timeSlot: timeSlotSchema,
  reason: z.string().min(1).max(500),
  blockType: blockTypeSchema,
});
```

### Acceptance Criteria
- [ ] All schemas parse valid input without errors
- [ ] All schemas reject invalid input with descriptive error messages
- [ ] `futureDateSchema` rejects past dates
- [ ] `createRecurringReservationSchema` rejects endDate <= startDate
- [ ] Pagination defaults work (page=1, limit=20)

---

## 5. Authentication Middleware

### 5.1 JWT Verification

Create `src/middleware/auth.ts`:

```typescript
import { createMiddleware } from 'hono/factory';
import type { Env } from '@/types/env';

export interface JwtPayload {
  sub: string;            // Keycloak user ID
  email: string;
  name: string;
  preferred_username: string;
  realm_access?: {
    roles: string[];
  };
  department?: string;
  registration?: string;
  exp: number;
  iss: string;
}

/**
 * Verifies JWT from Authorization: Bearer <token> header.
 * In prototype, validates signature against JWKS endpoint.
 * In production, same flow — Keycloak is the issuer in both cases.
 */
export const authMiddleware = createMiddleware<{ Bindings: Env; Variables: { user: JwtPayload } }>(
  async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid Authorization header' }, 401);
    }

    const token = authHeader.slice(7);

    try {
      // Decode and verify JWT
      // In Workers, use Web Crypto API to verify RS256 signature
      const payload = await verifyJwt(token, c.env.JWKS_URL, c.env.JWT_ISSUER);
      c.set('user', payload);
      await next();
    } catch (err) {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }
  }
);

/**
 * JWT verification using Web Crypto API (works in Workers and Node.js).
 * Fetches JWKS, finds matching key by kid, verifies RS256 signature.
 *
 * IMPLEMENTATION NOTE: Use jose library for production robustness:
 *   npm install jose
 *   import { jwtVerify, createRemoteJWKSet } from 'jose';
 */
async function verifyJwt(token: string, jwksUrl: string, issuer: string): Promise<JwtPayload> {
  // TODO: Implement with jose library
  // const JWKS = createRemoteJWKSet(new URL(jwksUrl));
  // const { payload } = await jwtVerify(token, JWKS, { issuer });
  // return payload as unknown as JwtPayload;
  throw new Error('Not implemented — install jose and implement');
}
```

### 5.2 Role-Based Access Control

Create `src/middleware/rbac.ts`:

```typescript
import { createMiddleware } from 'hono/factory';
import type { JwtPayload } from './auth';
import type { Env } from '@/types/env';

type Role = 'student' | 'professor' | 'staff' | 'maintenance';

/**
 * Restricts access to specific roles.
 * Usage: app.post('/api/v1/blockings', rbac(['professor', 'staff', 'maintenance']), handler)
 */
export function rbac(allowedRoles: Role[]) {
  return createMiddleware<{ Bindings: Env; Variables: { user: JwtPayload } }>(
    async (c, next) => {
      const user = c.get('user');
      const userRole = extractRole(user);

      if (!userRole || !allowedRoles.includes(userRole)) {
        return c.json({
          error: 'Forbidden',
          message: `This action requires one of: ${allowedRoles.join(', ')}`,
        }, 403);
      }

      await next();
    }
  );
}

/**
 * Extracts the UFCIM role from Keycloak JWT claims.
 * Maps Keycloak realm roles to app roles.
 */
function extractRole(payload: JwtPayload): Role | null {
  const roles = payload.realm_access?.roles ?? [];
  const roleMap: Record<string, Role> = {
    'ufcim-student': 'student',
    'ufcim-professor': 'professor',
    'ufcim-staff': 'staff',
    'ufcim-maintenance': 'maintenance',
  };

  for (const [keycloakRole, appRole] of Object.entries(roleMap)) {
    if (roles.includes(keycloakRole)) return appRole;
  }
  return null;
}
```

### 5.3 Validation Middleware

Create `src/middleware/validation.ts`:

```typescript
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';

/**
 * Validates request body against a Zod schema.
 * Usage: app.post('/path', validate(mySchema), handler)
 */
export function validate<T extends z.ZodType>(schema: T) {
  return createMiddleware(async (c, next) => {
    try {
      const body = await c.req.json();
      const parsed = schema.parse(body);
      c.set('validatedBody', parsed);
      await next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        return c.json({
          error: 'Validation failed',
          details: err.issues.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        }, 400);
      }
      return c.json({ error: 'Invalid request body' }, 400);
    }
  });
}

/**
 * Validates query parameters.
 */
export function validateQuery<T extends z.ZodType>(schema: T) {
  return createMiddleware(async (c, next) => {
    try {
      const query = c.req.query();
      const parsed = schema.parse(query);
      c.set('validatedQuery', parsed);
      await next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        return c.json({
          error: 'Invalid query parameters',
          details: err.issues.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        }, 400);
      }
      return c.json({ error: 'Invalid query parameters' }, 400);
    }
  });
}
```

### 5.4 Error Handler

Create `src/middleware/error-handler.ts`:

```typescript
import type { ErrorHandler } from 'hono';

export const globalErrorHandler: ErrorHandler = (err, c) => {
  console.error(`[ERROR] ${err.message}`, err.stack);

  if (err instanceof AppError) {
    return c.json({ error: err.message, code: err.code }, err.statusCode);
  }

  return c.json({ error: 'Internal server error' }, 500);
};

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, `${resource} not found`, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, 'CONFLICT');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(403, message, 'FORBIDDEN');
  }
}
```

### Acceptance Criteria
- [ ] Requests without `Authorization` header return 401
- [ ] Requests with expired/invalid JWT return 401
- [ ] Role check returns 403 for unauthorized roles
- [ ] Validation errors return 400 with field-level detail
- [ ] Global error handler catches unhandled errors and returns 500

---

## 6. Service Layer (Business Logic)

> **Rule:** All business logic lives here. Routes are thin — they parse input, call a service, return output. Services receive a `Database` instance and validated data, never raw requests.

### 6.1 Reservation Service

Create `src/services/reservation.service.ts`:

```typescript
import { eq, and } from 'drizzle-orm';
import { reservations, blockings, recurrences } from '@/db/schema';
import type { Database } from '@/db/client';
import { ConflictError, ForbiddenError, NotFoundError, AppError } from '@/middleware/error-handler';

interface CreateReservationInput {
  spaceId: string;
  date: string;
  timeSlot: 'morning' | 'afternoon' | 'evening';
}

interface CreateRecurringInput {
  spaceId: string;
  startDate: string;
  endDate: string;
  dayOfWeek: number;
  timeSlot: 'morning' | 'afternoon' | 'evening';
  description: string;
}

export class ReservationService {
  constructor(private db: Database) {}

  async create(userId: string, userRole: string, userDept: string, input: CreateReservationInput) {
    // 1. Check if space exists and belongs to user's department
    // 2. Check if slot is available (no confirmed reservation or active blocking)
    // 3. If student: check they have no other active reservation
    // 4. Insert reservation with status 'confirmed'
    // 5. Create audit log entry
    // 6. Create notification for the user
    // 7. Return the created reservation

    await this.checkSlotAvailability(input.spaceId, input.date, input.timeSlot);

    if (userRole === 'student') {
      await this.enforceStudentLimit(userId);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const [reservation] = await this.db.insert(reservations).values({
      id,
      spaceId: input.spaceId,
      userId,
      date: input.date,
      timeSlot: input.timeSlot,
      status: 'confirmed',
      createdAt: now,
      updatedAt: now,
    }).returning();

    return reservation;
  }

  async createRecurring(userId: string, userRole: string, input: CreateRecurringInput) {
    if (!['professor', 'staff'].includes(userRole)) {
      throw new ForbiddenError('Only professors and staff can create recurring reservations');
    }

    // Generate all dates matching dayOfWeek between startDate and endDate
    const dates = this.generateRecurringDates(input.startDate, input.endDate, input.dayOfWeek);

    // Create recurrence group
    const recurrenceId = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.db.insert(recurrences).values({
      id: recurrenceId,
      description: input.description,
      createdBy: userId,
      createdAt: now,
    });

    // Create individual reservations (skip conflicting slots, log skipped)
    const created = [];
    const skipped = [];

    for (const date of dates) {
      try {
        await this.checkSlotAvailability(input.spaceId, date, input.timeSlot);
        const id = crypto.randomUUID();
        const [reservation] = await this.db.insert(reservations).values({
          id,
          spaceId: input.spaceId,
          userId,
          date,
          timeSlot: input.timeSlot,
          status: 'confirmed',
          recurrenceId,
          createdAt: now,
          updatedAt: now,
        }).returning();
        created.push(reservation);
      } catch {
        skipped.push({ date, timeSlot: input.timeSlot, reason: 'Slot unavailable' });
      }
    }

    return { recurrenceId, created, skipped };
  }

  async cancel(reservationId: string, userId: string, userRole: string) {
    const reservation = await this.findOrThrow(reservationId);

    // Students can only cancel their own
    if (userRole === 'student' && reservation.userId !== userId) {
      throw new ForbiddenError('Students can only cancel their own reservations');
    }

    // Maintenance cannot cancel
    if (userRole === 'maintenance') {
      throw new ForbiddenError('Maintenance personnel cannot manage reservations');
    }

    const now = new Date().toISOString();
    const [updated] = await this.db
      .update(reservations)
      .set({ status: 'canceled', updatedAt: now })
      .where(eq(reservations.id, reservationId))
      .returning();

    return updated;
  }

  async listBySpace(spaceId: string, date?: string) {
    const conditions = [
      eq(reservations.spaceId, spaceId),
      eq(reservations.status, 'confirmed'),
    ];
    if (date) conditions.push(eq(reservations.date, date));

    return this.db.query.reservations.findMany({
      where: and(...conditions),
      with: { user: true },
      orderBy: (r, { asc }) => [asc(r.date)],
    });
  }

  async listByUser(userId: string, page: number, limit: number) {
    return this.db.query.reservations.findMany({
      where: eq(reservations.userId, userId),
      with: { space: true },
      orderBy: (r, { desc }) => [desc(r.date)],
      limit,
      offset: (page - 1) * limit,
    });
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async checkSlotAvailability(spaceId: string, date: string, timeSlot: string) {
    // Check for existing confirmed reservation
    const existing = await this.db.query.reservations.findFirst({
      where: and(
        eq(reservations.spaceId, spaceId),
        eq(reservations.date, date),
        eq(reservations.timeSlot, timeSlot),
        eq(reservations.status, 'confirmed')
      ),
    });
    if (existing) throw new ConflictError('This time slot is already reserved');

    // Check for active blocking
    const blocked = await this.db.query.blockings.findFirst({
      where: and(
        eq(blockings.spaceId, spaceId),
        eq(blockings.date, date),
        eq(blockings.timeSlot, timeSlot),
        eq(blockings.status, 'active')
      ),
    });
    if (blocked) throw new ConflictError('This space is blocked for the requested time slot');
  }

  private async enforceStudentLimit(userId: string) {
    const active = await this.db.query.reservations.findFirst({
      where: and(
        eq(reservations.userId, userId),
        eq(reservations.status, 'confirmed')
      ),
    });
    if (active) {
      throw new AppError(400, 'Students can only have one active reservation at a time', 'STUDENT_LIMIT');
    }
  }

  private async findOrThrow(id: string) {
    const reservation = await this.db.query.reservations.findFirst({
      where: eq(reservations.id, id),
    });
    if (!reservation) throw new NotFoundError('Reservation');
    return reservation;
  }

  private generateRecurringDates(start: string, end: string, dayOfWeek: number): string[] {
    const dates: string[] = [];
    const current = new Date(start);
    const endDate = new Date(end);

    // Move to the first matching day of week
    while (current.getDay() !== dayOfWeek) {
      current.setDate(current.getDate() + 1);
    }

    while (current <= endDate) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 7);
    }

    return dates;
  }
}
```

### 6.2 Blocking Service

Create `src/services/blocking.service.ts`:

Implement with the same patterns as reservation service:
- `create(userId, userRole, input)` — validates role (professor/staff/maintenance), checks no duplicate blocking on same slot, inserts blocking, cancels any confirmed reservation on the same slot (with `changeOrigin: 'blocking'` and notification to affected user)
- `remove(blockingId, userId)` — sets status to `'removed'`
- `listBySpace(spaceId, date?)` — returns active blockings

### 6.3 Space Service

Create `src/services/space.service.ts`:

- `create(input)` — inserts space
- `update(id, input)` — partial update
- `getAvailability(spaceId, date)` — returns all three time slots with their status (available/reserved/blocked) by querying reservations and blockings tables. **This replaces the removed `status` column.**
- `list(filters)` — filter by campus, block, department, type with pagination
- `getById(id)` — single space with equipment

### 6.4 Equipment Service

Create `src/services/equipment.service.ts`:

- `create(input)` — insert equipment linked to a space
- `updateStatus(id, userId, input)` — role check (staff/maintenance only), update status/notes, set `updatedBy`
- `listBySpace(spaceId)` — all equipment for a space

### 6.5 Notification Service

Create `src/services/notification.service.ts`:

- `create(userId, title, message, type)` — insert notification
- `listForUser(userId, unreadOnly?)` — user's notifications, newest first
- `markAsRead(notificationId, userId)` — ownership check, set read=true
- `markAllRead(userId)` — batch update

### 6.6 Audit Log Service

Create `src/services/audit-log.service.ts`:

- `log(userId, actionType, referenceId, referenceType, details?)` — insert log entry
- `list(filters)` — filter by user, action type, reference type, date range with pagination

### 6.7 User Service

Create `src/services/user.service.ts`:

- `syncFromToken(jwtPayload)` — upsert user from JWT claims (idempotent, called on every authenticated request or first login)
- `getById(id)` — single user
- `list(page, limit)` — paginated user list (staff only)

### Acceptance Criteria
- [ ] Students cannot create more than 1 active reservation
- [ ] Students cannot cancel other users' reservations
- [ ] Maintenance cannot create reservations
- [ ] Only professors/staff can create recurring reservations
- [ ] Conflicting slots throw ConflictError
- [ ] Blocking a reserved slot cancels the reservation and notifies the user
- [ ] Space availability is computed, not stored
- [ ] All mutations create audit log entries

---

## 7. Routes

### 7.1 App Definition

Create `src/app.ts`:

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env } from '@/types/env';
import { authMiddleware } from '@/middleware/auth';
import { globalErrorHandler } from '@/middleware/error-handler';
import { reservationRoutes } from '@/routes/reservations';
import { spaceRoutes } from '@/routes/spaces';
import { equipmentRoutes } from '@/routes/equipment';
import { blockingRoutes } from '@/routes/blockings';
import { notificationRoutes } from '@/routes/notifications';
import { logRoutes } from '@/routes/logs';
import { userRoutes } from '@/routes/users';

const app = new Hono<{ Bindings: Env }>();

// Global middleware
app.use('*', cors());
app.use('*', logger());
app.onError(globalErrorHandler);

// Health check (unauthenticated)
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// All API routes require authentication
const api = new Hono<{ Bindings: Env }>();
api.use('*', authMiddleware);

api.route('/users', userRoutes);
api.route('/spaces', spaceRoutes);
api.route('/equipment', equipmentRoutes);
api.route('/reservations', reservationRoutes);
api.route('/blockings', blockingRoutes);
api.route('/notifications', notificationRoutes);
api.route('/logs', logRoutes);

app.route('/api/v1', api);

export { app };
```

### 7.2 Workers Entry Point

Create `src/index.ts`:

```typescript
import { app } from './app';
export default app;
```

### 7.3 Node.js Entry Point (Production)

Create `src/index.node.ts`:

```typescript
import { serve } from '@hono/node-server';
import { app } from './app';

const port = parseInt(process.env.PORT || '3000');
serve({ fetch: app.fetch, port });
console.log(`UFCIM running on http://localhost:${port}`);
```

### 7.4 Route Files

Each route file follows this pattern. Example `src/routes/reservations.ts`:

```typescript
import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { createDb } from '@/db/client';
import { ReservationService } from '@/services/reservation.service';
import { validate, validateQuery } from '@/middleware/validation';
import { rbac } from '@/middleware/rbac';
import { createReservationSchema, createRecurringReservationSchema } from '@/validators/reservation.schema';
import { paginationSchema } from '@/validators/common.schema';

export const reservationRoutes = new Hono<{ Bindings: Env }>();

// Create a single reservation
reservationRoutes.post(
  '/',
  rbac(['student', 'professor', 'staff']),
  validate(createReservationSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new ReservationService(db);
    const user = c.get('user');
    const body = c.get('validatedBody');

    const reservation = await service.create(user.sub, /* role */, /* dept */, body);
    return c.json(reservation, 201);
  }
);

// Create recurring reservation
reservationRoutes.post(
  '/recurring',
  rbac(['professor', 'staff']),
  validate(createRecurringReservationSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new ReservationService(db);
    const user = c.get('user');
    const body = c.get('validatedBody');

    const result = await service.createRecurring(user.sub, /* role */, body);
    return c.json(result, 201);
  }
);

// Cancel a reservation
reservationRoutes.patch(
  '/:id/cancel',
  rbac(['student', 'professor', 'staff']),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new ReservationService(db);
    const user = c.get('user');

    const result = await service.cancel(c.req.param('id'), user.sub, /* role */);
    return c.json(result);
  }
);

// List reservations for a space
reservationRoutes.get(
  '/space/:spaceId',
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new ReservationService(db);
    const date = c.req.query('date');

    const results = await service.listBySpace(c.req.param('spaceId'), date);
    return c.json(results);
  }
);

// List current user's reservations
reservationRoutes.get(
  '/mine',
  validateQuery(paginationSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new ReservationService(db);
    const user = c.get('user');
    const { page, limit } = c.get('validatedQuery');

    const results = await service.listByUser(user.sub, page, limit);
    return c.json(results);
  }
);
```

Implement the remaining route files (`spaces.ts`, `equipment.ts`, `blockings.ts`, `notifications.ts`, `logs.ts`, `users.ts`) following the same pattern: thin handlers that instantiate a service and delegate.

### 7.5 Full Endpoint Reference

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| `GET` | `/health` | Public | Health check |
| `GET` | `/api/v1/users` | staff | List all users (paginated) |
| `GET` | `/api/v1/users/me` | Any | Current user profile |
| `POST` | `/api/v1/spaces` | staff | Create space |
| `GET` | `/api/v1/spaces` | Any | List spaces (filtered) |
| `GET` | `/api/v1/spaces/:id` | Any | Get space with equipment |
| `GET` | `/api/v1/spaces/:id/availability` | Any | Get slot availability for a date |
| `PUT` | `/api/v1/spaces/:id` | staff | Update space |
| `POST` | `/api/v1/equipment` | staff, maintenance | Create equipment |
| `PATCH` | `/api/v1/equipment/:id/status` | staff, maintenance | Update equipment status |
| `GET` | `/api/v1/equipment/space/:spaceId` | Any | List equipment for space |
| `POST` | `/api/v1/reservations` | student, professor, staff | Create reservation |
| `POST` | `/api/v1/reservations/recurring` | professor, staff | Create recurring reservation |
| `PATCH` | `/api/v1/reservations/:id/cancel` | student, professor, staff | Cancel reservation |
| `GET` | `/api/v1/reservations/space/:spaceId` | Any | List reservations for space |
| `GET` | `/api/v1/reservations/mine` | Any | List user's reservations |
| `POST` | `/api/v1/blockings` | professor, staff, maintenance | Create blocking |
| `PATCH` | `/api/v1/blockings/:id/remove` | professor, staff, maintenance | Remove blocking |
| `GET` | `/api/v1/blockings/space/:spaceId` | Any | List blockings for space |
| `GET` | `/api/v1/notifications` | Any | List user's notifications |
| `PATCH` | `/api/v1/notifications/:id/read` | Any | Mark notification as read |
| `PATCH` | `/api/v1/notifications/read-all` | Any | Mark all as read |
| `GET` | `/api/v1/logs` | staff | List audit logs (filtered) |

### Acceptance Criteria
- [ ] `GET /health` returns 200
- [ ] All `/api/v1/*` routes return 401 without auth
- [ ] Role restrictions enforced on all protected routes
- [ ] Request body validation works on POST/PUT/PATCH routes
- [ ] Query parameter validation works on GET routes with pagination

---

## 8. Seed Data

Create `src/db/seed.ts` with realistic test data:

- 4 users (one per role)
- 6 spaces across 2 campuses
- 10 equipment items
- 8 reservations (including 1 recurring series)
- 2 blockings
- 5 notifications
- 10 audit log entries

Use deterministic UUIDs (e.g., `00000000-0000-0000-0000-000000000001`) for easy reference in testing.

### Acceptance Criteria
- [ ] Seed script runs idempotently (can run multiple times)
- [ ] All foreign key references are valid
- [ ] Data covers all enum values (roles, statuses, time slots, etc.)

---

## 9. Deployment

### 9.1 Cloudflare Workers (Prototype)

```bash
# Create D1 database
npx wrangler d1 create ufcim-db
# Update wrangler.toml with the database_id

# Apply migrations
npx wrangler d1 execute ufcim-db --remote --file=migrations/0000_initial.sql

# Deploy
npx wrangler deploy

# Seed (optional)
npx wrangler d1 execute ufcim-db --remote --file=seed.sql
```

### 9.2 University Server (Production)

```bash
# Install dependencies
npm install @hono/node-server postgres

# Set environment variables
export DATABASE_URL="postgres://user:pass@localhost:5432/ufcim"
export JWKS_URL="https://keycloak.ufc.br/realms/ufc/protocol/openid-connect/certs"
export JWT_ISSUER="https://keycloak.ufc.br/realms/ufc"

# Generate PostgreSQL migrations
# (change drizzle.config.ts dialect to 'postgresql')
npx drizzle-kit generate
npx drizzle-kit migrate

# Run
npx tsx src/index.node.ts

# Or with Docker
docker compose up -d
```

### Acceptance Criteria
- [ ] `wrangler deploy` succeeds
- [ ] All endpoints work against D1 in remote Workers environment
- [ ] Same codebase runs locally with `wrangler dev` against local D1
- [ ] (Future) Same codebase runs with Node.js entry point against PostgreSQL

---

## 10. Migration Checklist (Workers → University Server)

When the time comes to move to production:

1. [ ] Change `drizzle.config.ts` dialect from `sqlite` to `postgresql`
2. [ ] Swap `src/db/client.ts` to use `drizzle-orm/postgres-js`
3. [ ] Install production deps: `npm install @hono/node-server postgres`
4. [ ] Regenerate migrations: `npx drizzle-kit generate`
5. [ ] Export D1 data: `wrangler d1 export ufcim-db --remote --output=dump.sql`
6. [ ] Transform dump for PostgreSQL (boolean ints → bools, etc.)
7. [ ] Apply migrations to PostgreSQL: `npx drizzle-kit migrate`
8. [ ] Import data
9. [ ] Update entry point to `src/index.node.ts`
10. [ ] Configure Keycloak + LDAP integration
11. [ ] Enable SMTP notifications
12. [ ] Set up reverse proxy (Nginx/Traefik) with HTTPS
13. [ ] Dockerize with `docker compose`