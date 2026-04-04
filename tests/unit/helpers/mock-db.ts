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

  // Delete chain: delete(table).where(...)
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });

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
      spaceManagers: { findFirst: vi.fn().mockResolvedValue(undefined), findMany: vi.fn().mockResolvedValue([]) },
    },
    insert: insertFn,
    update: updateFn,
    delete: deleteFn,
    // Exposed for assertions and per-test overrides
    _insert: { fn: insertFn, values: insertValues, returning: insertReturning },
    _update: { fn: updateFn, set: updateSet, where: updateWhere, returning: updateReturning },
    _delete: { fn: deleteFn, where: deleteWhere },
  };

  return db as unknown as Database & {
    query: typeof db.query;
    _insert: typeof db._insert;
    _update: typeof db._update;
    _delete: typeof db._delete;
  };
}

/** Seed objects used across service tests */
export const SEED = {
  spaceManager: {
    id: '00000000-0000-0000-0000-100000000001',
    spaceId: '00000000-0000-0000-0000-000000000011',
    userId: '00000000-0000-0000-0000-000000000003',
    role: 'coordinator',
    assignedBy: '00000000-0000-0000-0000-000000000003',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  user: {
    id: '00000000-0000-0000-0000-000000000003',
    name: 'Carlos Oliveira',
    registration: '2010005001',
    role: 'staff',
    department: 'Administração',
    email: 'carlos.oliveira@ufc.br',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
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
    reservable: true,
    closedFrom: '22:00',
    closedTo: '07:00',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  reservation: {
    id: '00000000-0000-0000-0000-000000000031',
    spaceId: '00000000-0000-0000-0000-000000000011',
    userId: '00000000-0000-0000-0000-000000000001',
    date: '2099-06-15',
    timeSlot: 'morning',
    startTime: '09:00',
    endTime: '10:00',
    status: 'confirmed',
    recurrenceId: null,
    changeOrigin: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  equipment: {
    id: '00000000-0000-0000-0000-000000000021',
    assetId: '2020002658',
    spaceId: '00000000-0000-0000-0000-000000000011',
    name: 'Projetor Epson PowerLite',
    type: 'projector',
    status: 'working',
    notes: null,
    updatedBy: '00000000-0000-0000-0000-000000000003',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  blocking: {
    id: '00000000-0000-0000-0000-000000000041',
    spaceId: '00000000-0000-0000-0000-000000000011',
    createdBy: '00000000-0000-0000-0000-000000000003',
    date: '2099-06-15',
    timeSlot: 'morning',
    startTime: '08:00',
    endTime: '09:00',
    reason: 'Maintenance work',
    blockType: 'maintenance',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
} as const;
