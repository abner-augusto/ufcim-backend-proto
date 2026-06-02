-- UFCIM seed: development-only fixtures.
--
-- ⚠️  NEVER apply this file with --remote / --env production.
--    It inserts hardcoded test users with deterministic UUIDs that match
--    scripts/generate-test-token.mjs. In production, users are provisioned
--    by syncUserMiddleware from Keycloak claims — seeding them here would
--    create orphan accounts and could collide with a real Keycloak `sub`.
--
-- Prerequisite: scripts/seed.sql must have been applied first (this file
-- relies on the 4 departments and the IAUD spaces existing).
--
-- Safe to re-run: every INSERT uses OR IGNORE.
-- Apply locally:
--   npx wrangler d1 execute ufcim-db --local --env dev --file=scripts/seed_dev.sql

-- ── Test users ──────────────────────────────────────────────────────────────
-- The sub claims here match scripts/generate-test-token.mjs exactly.
-- devAuthMiddleware auto-injects user …0003 (Carlos Oliveira / staff) when
-- no Authorization header is sent.
INSERT OR IGNORE INTO users (id, name, registration, role, department, email, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-000000000001', 'João Silva',        '2023001001', 'student',     'dc',  'joao.silva@alu.ufc.br',  '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000002', 'Dra. Maria Costa',  '1998010001', 'professor',   'dc',  'maria.costa@ufc.br',     '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000003', 'Carlos Oliveira',   '2010005001', 'staff',       'adm', 'carlos.oliveira@ufc.br', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000004', 'Pedro Santos',      '2015002001', 'maintenance', 'si',  'pedro.santos@ufc.br',    '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- ── Sample recurrence (weekly class in Sala 01, Bloco 2) ────────────────────
INSERT OR IGNORE INTO recurrences (id, description, created_by, created_at) VALUES
  ('00000000-0000-0000-0000-000000000051', 'Aula semanal de Projeto Arquitetônico', '00000000-0000-0000-0000-000000000002', '2026-01-01T00:00:00.000Z');

-- ── Sample reservations (IAUD spaces) ───────────────────────────────────────
INSERT OR IGNORE INTO reservations (id, space_id, user_id, date, time_slot, start_time, end_time, status, recurrence_id, change_origin, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-000000000061', 'a1a00008-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000002', '2026-04-02', 'morning',   '09:00', '10:00', 'confirmed', NULL,                                   NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000062', 'a1a00008-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000002', '2026-04-09', 'afternoon', '14:00', '15:00', 'confirmed', '00000000-0000-0000-0000-000000000051', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000063', 'a1a00008-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000002', '2026-04-16', 'afternoon', '14:00', '15:00', 'confirmed', '00000000-0000-0000-0000-000000000051', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000064', 'a1a00011-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000001', '2026-04-03', 'evening',   '19:00', '20:00', 'canceled',  NULL,                                   NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- ── Sample blockings ────────────────────────────────────────────────────────
INSERT OR IGNORE INTO blockings (id, space_id, created_by, date, time_slot, start_time, end_time, reason, block_type, status, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-000000000071', 'a1a00009-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000003', '2026-04-02', 'afternoon', '15:00', '17:00', 'Reunião do conselho departamental',   'administrative', 'active',  '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000072', 'a1a00011-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000004', '2026-04-05', 'morning',   '08:00', '10:00', 'Troca de unidade de ar condicionado', 'maintenance',    'active',  '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000073', 'a1a00009-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000003', '2026-03-29', 'morning',   '08:00', '09:00', 'Bloqueio removido de teste',          'administrative', 'removed', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- ── Sample notifications ────────────────────────────────────────────────────
INSERT OR IGNORE INTO notifications (id, user_id, title, message, type, read, created_at) VALUES
  ('00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-000000000002', 'Reserva confirmada', 'Sua reserva da Sala 01 (Bloco 2) foi confirmada.', 'confirmed', 0, '2026-01-01T00:00:00.000Z'),
  ('00000000-0000-0000-0000-000000000082', '00000000-0000-0000-0000-000000000001', 'Reserva cancelada',  'Sua reserva da Lehab (Bloco 2) foi cancelada.',    'canceled',  1, '2026-01-01T00:00:00.000Z');
