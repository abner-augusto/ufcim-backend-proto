import { vi } from 'vitest';
import type { Database } from '@/db/client';

/**
 * Creates a fully-typed Drizzle mock for service unit tests.
 *
 * Each table's findFirst/findMany starts returning undefined/[] by default.
 * Override per-test with: db.query.spaces.findFirst.mockResolvedValue(mySpace)
 *
 * The insert/update chain is pre-wired. Override the terminal `returning` mock:
 *   db._insert.returning.mockResolvedValue([myRow])
 *   db._update.returning.mockResolvedValue([myRow])
 */
export function createMockDb() {
  // Insert chain: insert(table).values({}).returning()
  const insertReturning = vi.fn().mockResolvedValue([{}]);
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
  const insertFn = vi.fn().mockReturnValue({ values: insertValues });

  // Update chain: update(table).set({}).where(...).returning()
  const updateReturning = vi.fn().mockResolvedValue([{}]);
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });

  const db = {
    query: {
      spaces:        { findFirst: vi.fn().mockResolvedValue(undefined), findMany: vi.fn().mockResolvedValue([]) },
      reservations:  { findFirst: vi.fn().mockResolvedValue(undefined), findMany: vi.fn().mockResolvedValue([]) },
      blockings:     { findFirst: vi.fn().mockResolvedValue(undefined), findMany: vi.fn().mockResolvedValue([]) },
      users:         { findFirst: vi.fn().mockResolvedValue(undefined), findMany: vi.fn().mockResolvedValue([]) },
      notifications: { findFirst: vi.fn().mockResolvedValue(undefined), findMany: vi.fn().mockResolvedValue([]) },
      auditLogs:     { findFirst: vi.fn().mockResolvedValue(undefined), findMany: vi.fn().mockResolvedValue([]) },
      equipment:     { findFirst: vi.fn().mockResolvedValue(undefined), findMany: vi.fn().mockResolvedValue([]) },
      recurrences:   { findFirst: vi.fn().mockResolvedValue(undefined), findMany: vi.fn().mockResolvedValue([]) },
    },
    insert: insertFn,
    update: updateFn,
    // Exposed for assertions and per-test overrides
    _insert: { fn: insertFn, values: insertValues, returning: insertReturning },
    _update: { fn: updateFn, set: updateSet, where: updateWhere, returning: updateReturning },
  };

  return db as unknown as Database & {
    query: typeof db.query;
    _insert: typeof db._insert;
    _update: typeof db._update;
  };
}

/** Seed objects used across service tests */
export const SEED = {
  space: {
    id: '00000000-0000-0000-0000-000000000011',
    number: 'A101',
    type: 'classroom',
    block: 'A',
    campus: 'Pici',
    department: 'Ciência da Computação',
    capacity: 40,
    furniture: null,
    lighting: null,
    hvac: null,
    multimedia: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  reservation: {
    id: '00000000-0000-0000-0000-000000000031',
    spaceId: '00000000-0000-0000-0000-000000000011',
    userId: '00000000-0000-0000-0000-000000000001',
    date: '2099-06-15',
    timeSlot: 'morning',
    status: 'confirmed',
    recurrenceId: null,
    changeOrigin: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  blocking: {
    id: '00000000-0000-0000-0000-000000000041',
    spaceId: '00000000-0000-0000-0000-000000000011',
    createdBy: '00000000-0000-0000-0000-000000000003',
    date: '2099-06-15',
    timeSlot: 'morning',
    reason: 'Maintenance work',
    blockType: 'maintenance',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
} as const;
