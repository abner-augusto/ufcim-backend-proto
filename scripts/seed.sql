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
INSERT OR IGNORE INTO spaces (id, number, type, block, campus, department, capacity, furniture, lighting, hvac, multimedia, closed_from, closed_to, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-000000000011', 'A101', 'classroom',    'A', 'Pici', 'Ciência da Computação', 40, 'Mesas e cadeiras para 40 pessoas',  'Fluorescente',   'Ar condicionado split 18000 BTU', 'Projetor + tela retrátil', '22:00', '07:00', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000012', 'B205', 'study_room',   'B', 'Pici', 'Ciência da Computação', 10, 'Mesa de reunião redonda, 10 cadeiras', 'LED',          'Ar condicionado split 9000 BTU',  NULL,                       '22:00', '07:00', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000013', 'C301', 'meeting_room', 'C', 'Pici', 'Administração',         20, 'Mesa de conferência, 20 cadeiras',  'LED regulável',  'Ar condicionado split 12000 BTU', 'TV 65" + videoconferência', '22:00', '07:00', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- ── Equipment ─────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO equipment (id, asset_id, space_id, name, type, status, notes, updated_by, updated_at) VALUES
  ('00000000-0000-0000-0000-000000000021', '2020002658', '00000000-0000-0000-0000-000000000011', 'Projetor Epson PowerLite',      'projector', 'working', NULL, '00000000-0000-0000-0000-000000000003', '2026-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000022', '2020002659', '00000000-0000-0000-0000-000000000012', 'Ar Condicionado Midea 9000 BTU','hvac',      'working', NULL, '00000000-0000-0000-0000-000000000004', '2026-01-01T00:00:00.000Z');

-- ── Recurrences ───────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO recurrences (id, description, created_by, created_at) VALUES
  ('00000000-0000-0000-0000-000000000051', 'Aula semanal de Engenharia de Software', '00000000-0000-0000-0000-000000000002', '2026-01-01T00:00:00.000Z');

-- ── Reservations ──────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO reservations (id, space_id, user_id, date, time_slot, start_time, end_time, status, recurrence_id, change_origin, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000002', '2026-04-02', 'morning',   '09:00', '10:00', 'confirmed',  NULL,                                   NULL,        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000002', '2026-04-09', 'afternoon', '14:00', '15:00', 'confirmed',  '00000000-0000-0000-0000-000000000051', NULL,        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000063', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000002', '2026-04-16', 'afternoon', '14:00', '15:00', 'confirmed',  '00000000-0000-0000-0000-000000000051', NULL,        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000064', '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', '2026-04-03', 'evening',   '19:00', '20:00', 'canceled',   NULL,                                   NULL,        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- ── Blockings ─────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO blockings (id, space_id, created_by, date, time_slot, start_time, end_time, reason, block_type, status, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000003', '2026-04-02', 'afternoon', '15:00', '17:00', 'Reunião do conselho departamental', 'administrative', 'active',  '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000072', '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000004', '2026-04-05', 'morning',   '08:00', '10:00', 'Troca de unidade de ar condicionado', 'maintenance',   'active',  '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000073', '00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000003', '2026-03-29', 'morning',   '08:00', '09:00', 'Bloqueio removido de teste',          'administrative', 'removed', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- ── Notifications ─────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO notifications (id, user_id, title, message, type, read, created_at) VALUES
  ('00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-000000000002', 'Reserva confirmada', 'Sua reserva da sala A101 foi confirmada.', 'confirmed', 0, '2026-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000082', '00000000-0000-0000-0000-000000000001', 'Reserva cancelada',  'Sua reserva futura da sala B205 foi cancelada.', 'canceled', 1, '2026-01-01T00:00:00.000Z');

-- ── Audit Logs ────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO audit_logs (id, user_id, action_type, reference_id, reference_type, timestamp, details) VALUES
  ('00000000-0000-0000-0000-000000000091', '00000000-0000-0000-0000-000000000003', 'create_space',       '00000000-0000-0000-0000-000000000011', 'space',       '2026-01-01T00:00:00.000Z', 'Created space A101'),
  ('00000000-0000-0000-0000-000000000092', '00000000-0000-0000-0000-000000000002', 'create_reservation', '00000000-0000-0000-0000-000000000061', 'reservation', '2026-01-01T00:00:00.000Z', 'Reserved space A101 on 2026-04-02 (morning)'),
  ('00000000-0000-0000-0000-000000000093', '00000000-0000-0000-0000-000000000004', 'create_blocking',    '00000000-0000-0000-0000-000000000072', 'blocking',    '2026-01-01T00:00:00.000Z', 'Blocked space B205 on 2026-04-05 (morning)');
