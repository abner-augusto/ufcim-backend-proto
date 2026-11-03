import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * A D1Database stand-in over node:sqlite, for services that issue raw D1
 * statements. Covers prepare/bind/first/all/run/batch; `batch` runs in one
 * transaction like D1. All migrations are applied, with foreign keys on.
 */

type Row = Record<string, unknown>;
interface SqliteStatement {
  all(...params: unknown[]): Row[];
  get(...params: unknown[]): Row | undefined;
  run(...params: unknown[]): { changes: number | bigint };
}
interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

const MIGRATIONS_DIR = resolve(__dirname, '../../../migrations');

export const sqlite = (await import('node:sqlite').catch(() => null)) as
  | { DatabaseSync: new (path: string) => SqliteDb }
  | null;

class Statement {
  constructor(
    private db: SqliteDb,
    private sql: string,
    private params: unknown[] = []
  ) {}
  bind(...params: unknown[]) {
    return new Statement(this.db, this.sql, params);
  }
  async first<T>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[], success: true, meta: {} };
  }
  async run() {
    return this.exec();
  }
  exec() {
    const { changes } = this.db.prepare(this.sql).run(...this.params);
    return { results: [], success: true, meta: { changes: Number(changes) } };
  }
}

export function createSqliteD1(): { d1: D1Database; raw: SqliteDb } {
  if (!sqlite) throw new Error('node:sqlite indisponível');
  const raw = new sqlite.DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    raw.exec('BEGIN');
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (statement.trim()) raw.exec(statement);
    }
    raw.exec('COMMIT');
  }

  const d1 = {
    prepare: (sql: string) => new Statement(raw, sql),
    batch: async (statements: Statement[]) => {
      raw.exec('BEGIN');
      try {
        const results = statements.map((s) => s.exec());
        raw.exec('COMMIT');
        return results;
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;

  return { d1, raw };
}
