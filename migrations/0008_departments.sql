-- Create departments table
CREATE TABLE IF NOT EXISTS departments (
  id   TEXT PRIMARY KEY,  -- slug, e.g. "iaud"
  name TEXT NOT NULL,     -- full name, e.g. "Instituto de Arquitetura e Design (IAUD)"
  campus TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Seed the only existing department
INSERT OR IGNORE INTO departments (id, name, campus, created_at, updated_at)
VALUES ('iaud', 'Instituto de Arquitetura e Design (IAUD)', 'Benfica', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- Migrate existing data to use the slug
UPDATE users  SET department = 'iaud' WHERE department IN ('IAUD', 'Instituto de Arquitetura e Design (IAUD)');
UPDATE spaces SET department = 'iaud' WHERE department = 'Instituto de Arquitetura e Design (IAUD)';
UPDATE invitations SET department = 'iaud' WHERE department IN ('IAUD', 'Instituto de Arquitetura e Design (IAUD)');
