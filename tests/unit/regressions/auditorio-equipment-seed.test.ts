import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSqliteD1, sqlite } from '../helpers/d1-sqlite';

const ROOT = resolve(__dirname, '../../..');
const SEED_SQL = readFileSync(resolve(ROOT, 'scripts/seed.sql'), 'utf8');
const FIX_SQL = readFileSync(resolve(ROOT, 'scripts/fix-auditorio-equipment.sql'), 'utf8');

const AUDITORIO_ID = 'a1a00009-0000-4000-8000-000000000000';
const EXPECTED_HVAC = 'Ar condicionado split (1 unidade)';
const EXPECTED_MULTIMEDIA = 'Projetor (1), Microfone com pedestal (1), Caixas de som (2)';
const EXPECTED_EQUIPMENT = [
  { asset_id: 'IAUD-AC-016', name: 'Ar Condicionado Split', type: 'hvac' },
  { asset_id: 'IAUD-MIC-001', name: 'Microfone com pedestal', type: 'audio' },
  { asset_id: 'IAUD-PROJ-010', name: 'Projetor', type: 'projector' },
  { asset_id: 'IAUD-SOM-001', name: 'Caixa de som', type: 'audio' },
  { asset_id: 'IAUD-SOM-002', name: 'Caixa de som', type: 'audio' },
];

describe.skipIf(!sqlite)('Auditório equipment seed and idempotent fix (BUG-020)', () => {
  it('seeds Auditório hvac, multimedia, and 5 equipment items cleanly', () => {
    const { raw } = createSqliteD1();
    raw.exec(SEED_SQL);

    const space = raw.prepare('SELECT hvac, multimedia FROM spaces WHERE id = ?').get(AUDITORIO_ID);
    expect(space).toEqual({
      hvac: EXPECTED_HVAC,
      multimedia: EXPECTED_MULTIMEDIA,
    });

    const equipment = raw
      .prepare('SELECT asset_id, name, type, status FROM equipment WHERE space_id = ? ORDER BY asset_id')
      .all(AUDITORIO_ID);

    expect(equipment).toEqual(
      EXPECTED_EQUIPMENT.map((item) => ({ ...item, status: 'working' })),
    );
    expect(raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('backfills an already-populated DB and runs twice without duplicating rows', () => {
    const { raw } = createSqliteD1();
    raw.exec(`
      INSERT INTO departments (id, name, campus, created_at, updated_at)
      VALUES ('iaud', 'IAUD', 'Benfica', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO spaces (id, name, number, type, block, campus, department, capacity, furniture, lighting, hvac, multimedia, model_id, created_at, updated_at)
      VALUES ('${AUDITORIO_ID}', 'Auditório', 'B2-02', 'hall', 'Bloco 2', 'Benfica', 'iaud', 63, NULL, NULL, NULL, NULL, 'Auditório', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z');
    `);

    raw.exec(FIX_SQL);
    const updatedAfterFirst = raw
      .prepare('SELECT hvac, multimedia, updated_at FROM spaces WHERE id = ?')
      .get(AUDITORIO_ID);
    expect(updatedAfterFirst).toMatchObject({
      hvac: EXPECTED_HVAC,
      multimedia: EXPECTED_MULTIMEDIA,
    });

    raw.exec(FIX_SQL);
    const updatedAfterSecond = raw
      .prepare('SELECT hvac, multimedia, updated_at FROM spaces WHERE id = ?')
      .get(AUDITORIO_ID);
    expect(updatedAfterSecond).toEqual(updatedAfterFirst);

    const equipment = raw
      .prepare('SELECT asset_id, name, type, status FROM equipment WHERE space_id = ? ORDER BY asset_id')
      .all(AUDITORIO_ID);
    expect(equipment).toEqual(
      EXPECTED_EQUIPMENT.map((item) => ({ ...item, status: 'working' })),
    );
    expect(raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
