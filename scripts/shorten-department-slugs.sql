-- One-off data fix: shorten the department slugs (departments.id).
-- The slug doubles as the FK in spaces/users/invitations, but it had been
-- storing the full department NAME — overflowing the 50-char cap that the
-- space/invitation validators enforce (so editing a room's department failed).
--
--   old slug                                                → new slug
--   'Instituto de Arquitetura, Urbanismo e Design (IAUD)'   → 'iaud'
--   'Ciência da Computação'                                 → 'dc'
--   'Administração'                                         → 'adm'
--   'Manutenção'                                            → 'si'
--
-- The readable `name` column is preserved (copied from the old row). The
-- pattern is non-destructive and FK-safe (no PRAGMA toggling): create the new
-- short-slug row, repoint every reference, then drop the old row once nothing
-- references it. Idempotent — safe to re-run.
--
-- Apply:
--   npx wrangler d1 execute ufcim-db-dev --local  --env dev        --file=scripts/shorten-department-slugs.sql
--   npx wrangler d1 execute ufcim-db-dev --remote --env dev        --file=scripts/shorten-department-slugs.sql
--   npx wrangler d1 execute ufcim-db     --remote --env production --file=scripts/shorten-department-slugs.sql

-- ── IAUD ─────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO departments (id, name, campus, created_at, updated_at)
  SELECT 'iaud', name, campus, created_at, updated_at
  FROM departments WHERE id = 'Instituto de Arquitetura, Urbanismo e Design (IAUD)';
UPDATE spaces      SET department = 'iaud' WHERE department = 'Instituto de Arquitetura, Urbanismo e Design (IAUD)';
UPDATE users       SET department = 'iaud' WHERE department = 'Instituto de Arquitetura, Urbanismo e Design (IAUD)';
UPDATE invitations SET department = 'iaud' WHERE department = 'Instituto de Arquitetura, Urbanismo e Design (IAUD)';
DELETE FROM departments WHERE id = 'Instituto de Arquitetura, Urbanismo e Design (IAUD)';

-- ── Departamento de Computação ───────────────────────────────────────────────
INSERT OR IGNORE INTO departments (id, name, campus, created_at, updated_at)
  SELECT 'dc', name, campus, created_at, updated_at
  FROM departments WHERE id = 'Ciência da Computação';
UPDATE spaces      SET department = 'dc' WHERE department = 'Ciência da Computação';
UPDATE users       SET department = 'dc' WHERE department = 'Ciência da Computação';
UPDATE invitations SET department = 'dc' WHERE department = 'Ciência da Computação';
DELETE FROM departments WHERE id = 'Ciência da Computação';

-- ── Departamento de Administração ────────────────────────────────────────────
INSERT OR IGNORE INTO departments (id, name, campus, created_at, updated_at)
  SELECT 'adm', name, campus, created_at, updated_at
  FROM departments WHERE id = 'Administração';
UPDATE spaces      SET department = 'adm' WHERE department = 'Administração';
UPDATE users       SET department = 'adm' WHERE department = 'Administração';
UPDATE invitations SET department = 'adm' WHERE department = 'Administração';
DELETE FROM departments WHERE id = 'Administração';

-- ── Superintendência de Infraestrutura (Manutenção) ──────────────────────────
INSERT OR IGNORE INTO departments (id, name, campus, created_at, updated_at)
  SELECT 'si', name, campus, created_at, updated_at
  FROM departments WHERE id = 'Manutenção';
UPDATE spaces      SET department = 'si' WHERE department = 'Manutenção';
UPDATE users       SET department = 'si' WHERE department = 'Manutenção';
UPDATE invitations SET department = 'si' WHERE department = 'Manutenção';
DELETE FROM departments WHERE id = 'Manutenção';
