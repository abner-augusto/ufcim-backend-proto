-- One-off data fix (BUG-020, feedback from the IAUD administrative technician):
--   • Auditório (B2-02) has 1 split AC, 1 projector, 1 microphone with stand,
--     and 2 speakers.
--   • Fills hvac and multimedia on spaces and inserts the 5 equipment rows so
--     the room popup displays them and maintenance tickets can target them.
--
-- seed.sql already carries these values for fresh databases, while its
-- INSERT OR IGNORE does not update existing spaces, so populated databases
-- need this script.
--
-- Idempotent: safe to re-run.
--
-- Apply:
--   npx wrangler d1 execute ufcim-db-dev --local  --env dev        --file=scripts/fix-auditorio-equipment.sql
--   npx wrangler d1 execute ufcim-db     --remote --env production --file=scripts/fix-auditorio-equipment.sql

UPDATE spaces
  SET hvac = 'Ar condicionado split (1 unidade)',
      multimedia = 'Projetor (1), Microfone com pedestal (1), Caixas de som (2)',
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE model_id = 'Auditório'
    AND (
      COALESCE(hvac, '') <> 'Ar condicionado split (1 unidade)'
      OR COALESCE(multimedia, '') <> 'Projetor (1), Microfone com pedestal (1), Caixas de som (2)'
    );

INSERT OR IGNORE INTO equipment
  (id, asset_id, space_id, name, type, status, notes, updated_by, updated_at)
SELECT
  v.id, v.asset_id, s.id, v.name, v.type, 'working', NULL, NULL, '2026-04-03T00:00:00.000Z'
FROM spaces s
JOIN (
  SELECT 'e9e00025-0000-4000-8000-000000000000' AS id, 'IAUD-AC-016'   AS asset_id, 'Ar Condicionado Split'  AS name, 'hvac'      AS type
  UNION ALL
  SELECT 'e9e00026-0000-4000-8000-000000000000',       'IAUD-PROJ-010',              'Projetor',               'projector'
  UNION ALL
  SELECT 'e9e00027-0000-4000-8000-000000000000',       'IAUD-MIC-001',               'Microfone com pedestal', 'audio'
  UNION ALL
  SELECT 'e9e00028-0000-4000-8000-000000000000',       'IAUD-SOM-001',               'Caixa de som',           'audio'
  UNION ALL
  SELECT 'e9e00029-0000-4000-8000-000000000000',       'IAUD-SOM-002',               'Caixa de som',           'audio'
) v
WHERE s.model_id = 'Auditório';
