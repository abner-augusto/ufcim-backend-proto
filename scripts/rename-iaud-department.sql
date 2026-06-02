-- One-off data fix: rename the IAUD department to its correct full name
--   old slug: 'Instituto de Arquitetura e Design (IAUD)'
--   new slug: 'Instituto de Arquitetura, Urbanismo e Design (IAUD)'
--
-- Non-destructive and FK-safe (no PRAGMA toggling needed): the new department
-- row is created first, every referencing row (spaces, users, invitations) is
-- repointed, then the old row is removed once nothing references it. All user
-- credentials are preserved. Also moves ALL users onto IAUD — the closed POC
-- only covers this department.
--
-- Idempotent: safe to re-run (OR IGNORE on the insert; the UPDATEs/DELETE match
-- nothing on a second pass).
--
-- Apply:
--   npx wrangler d1 execute ufcim-db     --remote --env production --file=scripts/rename-iaud-department.sql
--   npx wrangler d1 execute ufcim-db-dev --remote --env dev        --file=scripts/rename-iaud-department.sql

-- 1. Create the correctly-named department (inherits campus/timestamps from the old row).
INSERT OR IGNORE INTO departments (id, name, campus, created_at, updated_at)
  SELECT 'Instituto de Arquitetura, Urbanismo e Design (IAUD)',
         'Instituto de Arquitetura, Urbanismo e Design',
         campus, created_at, updated_at
  FROM departments
  WHERE id = 'Instituto de Arquitetura e Design (IAUD)';

-- 2. Repoint spaces off the old slug.
UPDATE spaces
  SET department = 'Instituto de Arquitetura, Urbanismo e Design (IAUD)'
  WHERE department = 'Instituto de Arquitetura e Design (IAUD)';

-- 3. Move every user onto IAUD (master admin + all test accounts — POC is IAUD-only).
UPDATE users
  SET department = 'Instituto de Arquitetura, Urbanismo e Design (IAUD)';

-- 4. Repoint any invitations off the old slug.
UPDATE invitations
  SET department = 'Instituto de Arquitetura, Urbanismo e Design (IAUD)'
  WHERE department = 'Instituto de Arquitetura e Design (IAUD)';

-- 5. Remove the old department row (now unreferenced).
DELETE FROM departments WHERE id = 'Instituto de Arquitetura e Design (IAUD)';
