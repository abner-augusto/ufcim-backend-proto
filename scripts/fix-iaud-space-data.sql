-- One-off data fix (BUG-019, feedback from the IAUD administrative technician):
--   • Auditório (B2-02) seats 63, not 100.
--   • B1-05 is "Atelier Digital 2"; the old name "Atelier Digital" made it hard
--     to find in the space search. model_id stays 'Atelier Digital' — it is the
--     GLB pin name and must not change.
--
-- seed.sql already carries the corrected values, but its INSERT OR IGNORE does
-- not touch rows that exist, so existing databases need these UPDATEs.
--
-- Idempotent: safe to re-run.
--
-- Apply:
--   npx wrangler d1 execute ufcim-db-dev --local  --env dev        --file=scripts/fix-iaud-space-data.sql
--   npx wrangler d1 execute ufcim-db     --remote --env production --file=scripts/fix-iaud-space-data.sql

UPDATE spaces
  SET capacity = 63, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE model_id = 'Auditório' AND capacity <> 63;

UPDATE spaces
  SET name = 'Atelier Digital 2', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE model_id = 'Atelier Digital' AND name <> 'Atelier Digital 2';
