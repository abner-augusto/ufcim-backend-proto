-- UFCIM seed: IAUD (Instituto de Arquitetura e Design) — Campus Benfica
-- Adds all 3D-model pins as spaces + equipment for reservable rooms.
--
-- Sources:
--   manifest.json  → pin IDs, blocks, and floors
--   pins_db_popup.json → capacity, furniture, lighting, hvac, projectors
--
-- Safe to re-run: INSERT OR IGNORE
-- Apply locally:
--   npx wrangler d1 execute ufcim-db --local --file=scripts/seed_iaud.sql
-- Apply remotely:
--   npx wrangler d1 execute ufcim-db --remote --file=scripts/seed_iaud.sql

-- ── Spaces ───────────────────────────────────────────────────────────────────
-- UUID scheme: a1a0XXYY-0000-4000-8000-000000000000 (valid v4 format)
-- model_id matches the pin "id" field in manifest.json exactly.

INSERT OR IGNORE INTO spaces
  (id, name, number, type, block, campus, department, capacity, furniture, lighting, hvac, multimedia, model_id, closed_from, closed_to, created_at, updated_at)
VALUES

  -- ── Bloco 1 — Térreo ─────────────────────────────────────────────────────
  ('a1a00001-0000-4000-8000-000000000000',
   'Sala de Leitura', 'B1-01', 'study_room', 'Bloco 1', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   50, NULL, 'Natural + Led', NULL, NULL,
   'Sala de Leitura (Biblioteca)',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  ('a1a00002-0000-4000-8000-000000000000',
   'LEAU', 'B1-02', 'study_room', 'Bloco 1', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   20, NULL, NULL, NULL, NULL,
   'LEAU',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  ('a1a00003-0000-4000-8000-000000000000',
   'Administração', 'B1-03', 'meeting_room', 'Bloco 1', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   10, NULL, NULL, NULL, NULL,
   'Administração',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  ('a1a00004-0000-4000-8000-000000000000',
   'LABCAD', 'B1-04', 'study_room', 'Bloco 1', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   20, NULL, NULL, NULL, NULL,
   'LABCAD',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  ('a1a00005-0000-4000-8000-000000000000',
   'Atelier Digital', 'B1-05', 'study_room', 'Bloco 1', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   20, NULL, NULL, NULL, NULL,
   'Atelier Digital',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  ('a1a00006-0000-4000-8000-000000000000',
   'Acervo', 'B1-06', 'study_room', 'Bloco 1', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   100, NULL, NULL, NULL, NULL,
   'Acervo (Bibilioteca)',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  ('a1a00007-0000-4000-8000-000000000000',
   'Adm. Biblioteca', 'B1-07', 'meeting_room', 'Bloco 1', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   10, NULL, NULL, NULL, NULL,
   'Administrativo (Biblioteca)',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  -- ── Bloco 2 — Térreo ─────────────────────────────────────────────────────
  ('a1a00008-0000-4000-8000-000000000000',
   'Sala 01', 'B2-01', 'classroom', 'Bloco 2', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   36,
   'Cadeira (35), Cadeira Professor (1), Mesa (18), Mesa Professor (1), Quadro Branco (2)',
   'Natural + Led', 'Ar condicionado split (2 unidades)', NULL,
   'Sala 01',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  ('a1a00009-0000-4000-8000-000000000000',
   'Auditório', 'B2-02', 'hall', 'Bloco 2', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   100, NULL, NULL, NULL, NULL,
   'Auditório',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  ('a1a00010-0000-4000-8000-000000000000',
   'Sala 03', 'B2-03', 'classroom', 'Bloco 2', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   36,
   'Cadeira (35), Cadeira Professor (1), Mesa (20), Mesa Professor (1), Quadro Branco (1)',
   'Natural + Led', 'Ar condicionado split (1 unidade)', 'Projetor + tela',
   'Sala 03',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  ('a1a00011-0000-4000-8000-000000000000',
   'Lehab', 'B2-04', 'study_room', 'Bloco 2', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   20, NULL, NULL, NULL, NULL,
   'Lehab',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  ('a1a00012-0000-4000-8000-000000000000',
   'Loja 01', 'B2-05', 'study_room', 'Bloco 2', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   10, NULL, NULL, NULL, NULL,
   'Loja 01',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  -- ── Bloco 3 — Térreo ─────────────────────────────────────────────────────
  ('a1a00013-0000-4000-8000-000000000000',
   'Sala 05', 'B3-05', 'classroom', 'Bloco 3', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   36,
   'Cadeira (35), Cadeira Professor (1), Mesa (20), Mesa Professor (1), Quadro Branco (1)',
   'Natural + Led', 'Ar condicionado split (1 unidade)', 'Projetor + tela',
   'Sala 05',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  ('a1a00014-0000-4000-8000-000000000000',
   'Sala 06', 'B3-06', 'classroom', 'Bloco 3', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   36,
   'Cadeira (35), Cadeira Professor (1), Mesa (20), Mesa Professor (1), Quadro Branco (2)',
   'Natural + Led', 'Ar condicionado split (1 unidade)', 'Projetor + tela',
   'Sala 06',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  ('a1a00015-0000-4000-8000-000000000000',
   'Sala 07', 'B3-07', 'classroom', 'Bloco 3', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   36,
   'Cadeira (35), Cadeira Professor (1), Mesa (20), Mesa Professor (1), Quadro Branco (2)',
   'Natural + Led', 'Ar condicionado split (1 unidade)', 'Projetor + tela',
   'Sala 07',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  ('a1a00016-0000-4000-8000-000000000000',
   'Sala 08', 'B3-08', 'classroom', 'Bloco 3', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   36,
   'Cadeira (35), Cadeira Professor (1), Mesa (20), Mesa Professor (1), Quadro Branco (1)',
   'Natural + Led', 'Ar condicionado split (1 unidade)', 'Projetor + tela',
   'Sala 08',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  ('a1a00017-0000-4000-8000-000000000000',
   'Centro Acadêmico', 'B3-CA', 'meeting_room', 'Bloco 3', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   20, NULL, NULL, NULL, NULL,
   'Centro Acadêmico',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  -- ── Bloco 3 — 1º Pavimento ────────────────────────────────────────────────
  ('a1a00018-0000-4000-8000-000000000000',
   'Sala 12', 'B3-12', 'classroom', 'Bloco 3', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   36, NULL, NULL, NULL, NULL,
   'Sala 12 (manutenção)',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  ('a1a00019-0000-4000-8000-000000000000',
   'Sala 11', 'B3-11', 'classroom', 'Bloco 3', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   46,
   'Cadeira (45), Cadeira Professor (1), Mesa (30), Mesa Professor (1), Quadro Branco (1)',
   'Natural + Led', 'Ar condicionado split (2 unidades)', 'Projetor + tela',
   'Sala 11',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  ('a1a00020-0000-4000-8000-000000000000',
   'Sala 10', 'B3-10', 'classroom', 'Bloco 3', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   46,
   'Cadeira (45), Cadeira Professor (1), Mesa (30), Mesa Professor (1), Quadro Branco (1)',
   'Natural + Led', 'Ar condicionado split (2 unidades)', 'Projetor + tela',
   'Sala 10',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  ('a1a00021-0000-4000-8000-000000000000',
   'Sala 09', 'B3-09', 'classroom', 'Bloco 3', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   46,
   'Cadeira (45), Cadeira Professor (1), Mesa (30), Mesa Professor (1), Quadro Branco (1)',
   'Natural + Led', 'Ar condicionado split (2 unidades)', 'Projetor + tela',
   'Sala 09',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  -- ── Bloco 4 — Térreo ─────────────────────────────────────────────────────
  ('a1a00022-0000-4000-8000-000000000000',
   'Cantina', 'B4-01', 'meeting_room', 'Bloco 4', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   50, NULL, NULL, NULL, NULL,
   'Cantina',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  ('a1a00023-0000-4000-8000-000000000000',
   'BHO Masculino', 'B4-02', 'meeting_room', 'Bloco 4', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   10, NULL, NULL, NULL, NULL,
   'BHO Masculino',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  ('a1a00024-0000-4000-8000-000000000000',
   'BHO Feminino', 'B4-03', 'meeting_room', 'Bloco 4', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   10, NULL, NULL, NULL, NULL,
   'BHO Feminino',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  ('a1a00025-0000-4000-8000-000000000000',
   'Sala Professores', 'B4-04', 'meeting_room', 'Bloco 4', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   15, NULL, NULL, NULL, NULL,
   'Sala Professores',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  -- ── Pavilhão — Térreo ────────────────────────────────────────────────────
  ('a1a00026-0000-4000-8000-000000000000',
   'LED', 'PV-01', 'study_room', 'Pavilhão', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   20, NULL, NULL, NULL, NULL,
   'LED',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  ('a1a00027-0000-4000-8000-000000000000',
   'Sala 13', 'PV-13', 'classroom', 'Pavilhão', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   20,
   'Cadeira (20), Mesa (10), Quadro Branco (1)',
   'Natural + Led', 'Ar condicionado split (2 unidades)', 'Projetor + tela',
   'Sala 13',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  ('a1a00028-0000-4000-8000-000000000000',
   'Oficina Digital', 'PV-02', 'study_room', 'Pavilhão', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   20, NULL, NULL, NULL, NULL,
   'Oficina Digital',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z'),

  -- ── Pavilhão — 1º Pavimento ───────────────────────────────────────────────
  ('a1a00029-0000-4000-8000-000000000000',
   'Atelier Digital 1', 'PV-03', 'study_room', 'Pavilhão', 'Benfica',
   'Instituto de Arquitetura e Design (IAUD)',
   20, NULL, NULL, NULL, NULL,
   'Atelier digital 1',
   '22:00', '07:00', '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z');

-- ── Equipment ────────────────────────────────────────────────────────────────
-- Only inserted for rooms present in pins_db_popup.json.
-- Asset IDs use the IAUD- prefix. updated_by is NULL (no IAUD staff user seeded).
-- UUID scheme: e9e0XXYY-0000-4000-8000-000000000000

INSERT OR IGNORE INTO equipment
  (id, asset_id, space_id, name, type, status, notes, updated_by, updated_at)
VALUES

  -- Sala 01 — 2 AC, 0 projectors
  ('e9e00001-0000-4000-8000-000000000000', 'IAUD-AC-001',   'a1a00008-0000-4000-8000-000000000000', 'Ar Condicionado Split', 'hvac',      'working', NULL, NULL, '2026-04-03T00:00:00.000Z'),
  ('e9e00002-0000-4000-8000-000000000000', 'IAUD-AC-002',   'a1a00008-0000-4000-8000-000000000000', 'Ar Condicionado Split', 'hvac',      'working', NULL, NULL, '2026-04-03T00:00:00.000Z'),

  -- Sala 03 — 1 AC, 1 projector
  ('e9e00003-0000-4000-8000-000000000000', 'IAUD-AC-003',   'a1a00010-0000-4000-8000-000000000000', 'Ar Condicionado Split', 'hvac',      'working', NULL, NULL, '2026-04-03T00:00:00.000Z'),
  ('e9e00004-0000-4000-8000-000000000000', 'IAUD-PROJ-001', 'a1a00010-0000-4000-8000-000000000000', 'Projetor',              'projector', 'working', NULL, NULL, '2026-04-03T00:00:00.000Z'),

  -- Sala 05 — 1 AC, 1 projector
  ('e9e00005-0000-4000-8000-000000000000', 'IAUD-AC-004',   'a1a00013-0000-4000-8000-000000000000', 'Ar Condicionado Split', 'hvac',      'working', NULL, NULL, '2026-04-03T00:00:00.000Z'),
  ('e9e00006-0000-4000-8000-000000000000', 'IAUD-PROJ-002', 'a1a00013-0000-4000-8000-000000000000', 'Projetor',              'projector', 'working', NULL, NULL, '2026-04-03T00:00:00.000Z'),

  -- Sala 06 — 1 AC, 1 projector
  ('e9e00007-0000-4000-8000-000000000000', 'IAUD-AC-005',   'a1a00014-0000-4000-8000-000000000000', 'Ar Condicionado Split', 'hvac',      'working', NULL, NULL, '2026-04-03T00:00:00.000Z'),
  ('e9e00008-0000-4000-8000-000000000000', 'IAUD-PROJ-003', 'a1a00014-0000-4000-8000-000000000000', 'Projetor',              'projector', 'working', NULL, NULL, '2026-04-03T00:00:00.000Z'),

  -- Sala 07 — 1 AC, 1 projector
  ('e9e00009-0000-4000-8000-000000000000', 'IAUD-AC-006',   'a1a00015-0000-4000-8000-000000000000', 'Ar Condicionado Split', 'hvac',      'working', NULL, NULL, '2026-04-03T00:00:00.000Z'),
  ('e9e00010-0000-4000-8000-000000000000', 'IAUD-PROJ-004', 'a1a00015-0000-4000-8000-000000000000', 'Projetor',              'projector', 'working', NULL, NULL, '2026-04-03T00:00:00.000Z'),

  -- Sala 08 — 1 AC, 1 projector
  ('e9e00011-0000-4000-8000-000000000000', 'IAUD-AC-007',   'a1a00016-0000-4000-8000-000000000000', 'Ar Condicionado Split', 'hvac',      'working', NULL, NULL, '2026-04-03T00:00:00.000Z'),
  ('e9e00012-0000-4000-8000-000000000000', 'IAUD-PROJ-005', 'a1a00016-0000-4000-8000-000000000000', 'Projetor',              'projector', 'working', NULL, NULL, '2026-04-03T00:00:00.000Z'),

  -- Sala 09 — 2 AC, 1 projector
  ('e9e00013-0000-4000-8000-000000000000', 'IAUD-AC-008',   'a1a00021-0000-4000-8000-000000000000', 'Ar Condicionado Split', 'hvac',      'working', NULL, NULL, '2026-04-03T00:00:00.000Z'),
  ('e9e00014-0000-4000-8000-000000000000', 'IAUD-AC-009',   'a1a00021-0000-4000-8000-000000000000', 'Ar Condicionado Split', 'hvac',      'working', NULL, NULL, '2026-04-03T00:00:00.000Z'),
  ('e9e00015-0000-4000-8000-000000000000', 'IAUD-PROJ-006', 'a1a00021-0000-4000-8000-000000000000', 'Projetor',              'projector', 'working', NULL, NULL, '2026-04-03T00:00:00.000Z'),

  -- Sala 10 — 2 AC, 1 projector
  ('e9e00016-0000-4000-8000-000000000000', 'IAUD-AC-010',   'a1a00020-0000-4000-8000-000000000000', 'Ar Condicionado Split', 'hvac',      'working', NULL, NULL, '2026-04-03T00:00:00.000Z'),
  ('e9e00017-0000-4000-8000-000000000000', 'IAUD-AC-011',   'a1a00020-0000-4000-8000-000000000000', 'Ar Condicionado Split', 'hvac',      'working', NULL, NULL, '2026-04-03T00:00:00.000Z'),
  ('e9e00018-0000-4000-8000-000000000000', 'IAUD-PROJ-007', 'a1a00020-0000-4000-8000-000000000000', 'Projetor',              'projector', 'working', NULL, NULL, '2026-04-03T00:00:00.000Z'),

  -- Sala 11 — 2 AC, 1 projector
  ('e9e00019-0000-4000-8000-000000000000', 'IAUD-AC-012',   'a1a00019-0000-4000-8000-000000000000', 'Ar Condicionado Split', 'hvac',      'working', NULL, NULL, '2026-04-03T00:00:00.000Z'),
  ('e9e00020-0000-4000-8000-000000000000', 'IAUD-AC-013',   'a1a00019-0000-4000-8000-000000000000', 'Ar Condicionado Split', 'hvac',      'working', NULL, NULL, '2026-04-03T00:00:00.000Z'),
  ('e9e00021-0000-4000-8000-000000000000', 'IAUD-PROJ-008', 'a1a00019-0000-4000-8000-000000000000', 'Projetor',              'projector', 'working', NULL, NULL, '2026-04-03T00:00:00.000Z'),

  -- Sala 13 — 2 AC, 1 projector
  ('e9e00022-0000-4000-8000-000000000000', 'IAUD-AC-014',   'a1a00027-0000-4000-8000-000000000000', 'Ar Condicionado Split', 'hvac',      'working', NULL, NULL, '2026-04-03T00:00:00.000Z'),
  ('e9e00023-0000-4000-8000-000000000000', 'IAUD-AC-015',   'a1a00027-0000-4000-8000-000000000000', 'Ar Condicionado Split', 'hvac',      'working', NULL, NULL, '2026-04-03T00:00:00.000Z'),
  ('e9e00024-0000-4000-8000-000000000000', 'IAUD-PROJ-009', 'a1a00027-0000-4000-8000-000000000000', 'Projetor',              'projector', 'working', NULL, NULL, '2026-04-03T00:00:00.000Z');
