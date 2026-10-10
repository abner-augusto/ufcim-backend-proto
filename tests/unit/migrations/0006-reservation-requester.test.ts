import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * MEL-025 migration 0006 on a real SQLite (node:sqlite), FKs on and each
 * migration in its own transaction, like D1 runs them. Rows written before
 * the migration must survive unchanged, with `created_by` backfilled from
 * `user_id` and the requester columns empty.
 */

type Row = Record<string, unknown>;
interface Db {
  exec(sql: string): void;
  prepare(sql: string): { all(...params: unknown[]): Row[]; get(...params: unknown[]): Row | undefined };
}

const MIGRATIONS_DIR = resolve(__dirname, '../../../migrations');
const TARGET = '0006_reservation_requester.sql';

function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
}

function applyMigration(db: Db, file: string) {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
  db.exec('BEGIN');
  for (const statement of sql.split('--> statement-breakpoint')) {
    if (statement.trim()) db.exec(statement);
  }
  db.exec('COMMIT');
}

const NOW = '2026-01-01T00:00:00.000Z';
const STAFF = 'u-staff';
const PROF = 'u-prof';

// node:sqlite ships with Node 22.5+; on an older runtime the suite is skipped.
const sqlite = (await import('node:sqlite').catch(() => null)) as
  | { DatabaseSync: new (path: string) => Db }
  | null;
let before: Row[] = [];
let db: Db;

beforeAll(() => {
  if (!sqlite) return;
  db = new sqlite.DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');

  const files = migrationFiles();
  const targetIndex = files.indexOf(TARGET);
  for (const file of files.slice(0, targetIndex)) applyMigration(db, file);

  db.exec(`
    INSERT INTO departments (id, name, campus, created_at, updated_at) VALUES ('iaud', 'IAUD', 'Benfica', '${NOW}', '${NOW}');
    INSERT INTO users (id, name, role, department, email, created_at, updated_at) VALUES
      ('${STAFF}', 'Staff', 'staff', 'iaud', 'staff@x', '${NOW}', '${NOW}'),
      ('${PROF}', 'Prof', 'professor', 'iaud', 'prof@x', '${NOW}', '${NOW}');
    INSERT INTO spaces (id, name, number, type, block, campus, department, capacity, created_at, updated_at)
      VALUES ('s1', 'Sala', 'B2-02', 'classroom', 'B2', 'Benfica', 'iaud', 30, '${NOW}', '${NOW}');
    INSERT INTO recurrences (id, description, created_by, created_at) VALUES ('rec1', 'Aula', '${PROF}', '${NOW}');
    INSERT INTO reservations (id, space_id, user_id, date, time_slot, start_time, end_time, status, recurrence_id, change_origin, purpose, description, cancel_reason, created_at, updated_at) VALUES
      ('r1', 's1', '${PROF}', '2026-04-02', 'morning', '09:00', '10:00', 'confirmed', 'rec1', NULL, 'class', 'Aula', NULL, '${NOW}', '${NOW}'),
      ('r2', 's1', '${STAFF}', '2026-04-02', 'afternoon', '14:00', '15:30', 'canceled', NULL, 'user', 'meeting', NULL, 'Motivo', '${NOW}', '${NOW}'),
      ('r3', 's1', '${STAFF}', '2026-04-03', 'morning', '09:00', '10:00', 'confirmed', NULL, NULL, NULL, NULL, NULL, '${NOW}', '${NOW}');
  `);
  before = db.prepare('SELECT * FROM reservations ORDER BY id').all();

  applyMigration(db, TARGET);
});

describe.skipIf(!sqlite)('migration 0006_reservation_requester (MEL-025)', () => {
  it('keeps every reservation and every original column value', () => {
    const after = db.prepare('SELECT * FROM reservations ORDER BY id').all();
    expect(after).toHaveLength(before.length);
    after.forEach((row, i) => {
      for (const [column, value] of Object.entries(before[i])) {
        expect(row[column], `${row.id}.${column}`).toEqual(value);
      }
    });
  });

  it('backfills created_by with user_id and leaves the requester empty', () => {
    const after = db.prepare('SELECT * FROM reservations ORDER BY id').all();
    for (const row of after) {
      expect(row.created_by).toBe(row.user_id);
      expect(row.requester_user_id).toBeNull();
      expect(row.requester_name).toBeNull();
      expect(row.requester_contact).toBeNull();
    }
  });

  it('keeps created_by NOT NULL on new reservations', () => {
    expect(() =>
      db.exec(`INSERT INTO reservations (id, space_id, user_id, date, time_slot, start_time, end_time, status, created_at, updated_at)
               VALUES ('r9', 's1', '${STAFF}', '2026-05-01', 'morning', '09:00', '10:00', 'confirmed', '${NOW}', '${NOW}')`)
    ).toThrow(/NOT NULL/);
  });

  it('keeps the confirmed-slot unique index and adds the requester index', () => {
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'reservations' AND sql IS NOT NULL")
      .all()
      .map((r) => r.name);
    expect(indexes).toEqual(expect.arrayContaining(['reservations_confirmed_slot_unq', 'reservations_requester_idx']));
    expect(() =>
      db.exec(`INSERT INTO reservations (id, space_id, user_id, created_by, date, time_slot, start_time, end_time, status, created_at, updated_at)
               VALUES ('r8', 's1', '${STAFF}', '${STAFF}', '2026-04-03', 'morning', '09:00', '10:00', 'confirmed', '${NOW}', '${NOW}')`)
    ).toThrow(/UNIQUE/);
  });

  it('adds nullable requester columns to recurrences and keeps their creator', () => {
    const rec = db.prepare('SELECT * FROM recurrences WHERE id = ?').get('rec1');
    expect(rec).toMatchObject({ created_by: PROF, requester_user_id: null, requester_name: null, requester_contact: null });
  });

  it('enforces the requester foreign key and passes the FK check', () => {
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(() =>
      db.exec(`INSERT INTO reservations (id, space_id, user_id, created_by, requester_user_id, date, time_slot, start_time, end_time, status, created_at, updated_at)
               VALUES ('r7', 's1', '${STAFF}', '${STAFF}', 'ghost', '2026-05-02', 'morning', '09:00', '10:00', 'confirmed', '${NOW}', '${NOW}')`)
    ).toThrow(/FOREIGN KEY/);
  });
});
