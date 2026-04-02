-- UFCIM seed data — run with:
--   npx wrangler d1 execute ufcim-db --local --file=scripts/seed.sql
--   npx wrangler d1 execute ufcim-db --remote --file=scripts/seed.sql
--
-- Uses deterministic UUIDs so it is safe to run multiple times (INSERT OR IGNORE).
-- All UUIDs match the sub claims in scripts/generate-test-token.mjs.

-- ── Users ────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO users (id, name, registration, role, department, email, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-000000000001', 'João Silva',       '2023001001', 'student',     'Ciência da Computação', 'joao.silva@alu.ufc.br',  '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000002', 'Dra. Maria Costa', '1998010001', 'professor',   'Ciência da Computação', 'maria.costa@ufc.br',      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000003', 'Carlos Oliveira',  '2010005001', 'staff',       'Administração',         'carlos.oliveira@ufc.br', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000004', 'Pedro Santos',     '2015002001', 'maintenance', 'Manutenção',            'pedro.santos@ufc.br',    '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- ── Spaces ───────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO spaces (id, number, type, block, campus, department, capacity, furniture, lighting, hvac, multimedia, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-000000000011', 'A101', 'classroom',    'A', 'Pici', 'Ciência da Computação', 40, 'Mesas e cadeiras para 40 pessoas',  'Fluorescente',   'Ar condicionado split 18000 BTU', 'Projetor + tela retrátil',   '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000012', 'B205', 'study_room',   'B', 'Pici', 'Ciência da Computação', 10, 'Mesa de reunião redonda, 10 cadeiras', 'LED',          'Ar condicionado split 9000 BTU',  NULL,                         '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000013', 'C301', 'meeting_room', 'C', 'Pici', 'Administração',         20, 'Mesa de conferência, 20 cadeiras',  'LED regulável',  'Ar condicionado split 12000 BTU', 'TV 65" + videoconferência', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- ── Equipment ─────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO equipment (id, space_id, name, type, status, notes, updated_by, updated_at) VALUES
  ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000011', 'Projetor Epson PowerLite',      'projector', 'working', NULL, '00000000-0000-0000-0000-000000000003', '2026-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000012', 'Ar Condicionado Midea 9000 BTU','hvac',      'working', NULL, '00000000-0000-0000-0000-000000000004', '2026-01-01T00:00:00.000Z');
