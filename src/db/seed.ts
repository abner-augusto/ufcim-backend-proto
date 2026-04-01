import { createDb } from './client';
import type { Env } from '@/types/env';

// Deterministic seed UUIDs
const SEED = {
  users: {
    student1: '00000000-0000-0000-0000-000000000001',
    professor1: '00000000-0000-0000-0000-000000000002',
    staff1: '00000000-0000-0000-0000-000000000003',
    maintenance1: '00000000-0000-0000-0000-000000000004',
  },
  spaces: {
    classroom1: '00000000-0000-0000-0000-000000000011',
    studyRoom1: '00000000-0000-0000-0000-000000000012',
    meetingRoom1: '00000000-0000-0000-0000-000000000013',
  },
  equipment: {
    projector1: '00000000-0000-0000-0000-000000000021',
    ac1: '00000000-0000-0000-0000-000000000022',
  },
};

export async function seed(db: ReturnType<typeof createDb>) {
  const now = new Date().toISOString();

  // ── Users ──────────────────────────────────────────────────────────────────
  await db.insert(schema.users).values([
    {
      id: SEED.users.student1,
      name: 'João Silva',
      registration: '2023001001',
      role: 'student',
      department: 'Ciência da Computação',
      email: 'joao.silva@alu.ufc.br',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: SEED.users.professor1,
      name: 'Dra. Maria Costa',
      registration: '1998010001',
      role: 'professor',
      department: 'Ciência da Computação',
      email: 'maria.costa@ufc.br',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: SEED.users.staff1,
      name: 'Carlos Oliveira',
      registration: '2010005001',
      role: 'staff',
      department: 'Administração',
      email: 'carlos.oliveira@ufc.br',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: SEED.users.maintenance1,
      name: 'Pedro Santos',
      registration: '2015002001',
      role: 'maintenance',
      department: 'Manutenção',
      email: 'pedro.santos@ufc.br',
      createdAt: now,
      updatedAt: now,
    },
  ]).onConflictDoNothing();

  // ── Spaces ─────────────────────────────────────────────────────────────────
  await db.insert(schema.spaces).values([
    {
      id: SEED.spaces.classroom1,
      number: 'A101',
      type: 'classroom',
      block: 'A',
      campus: 'Pici',
      department: 'Ciência da Computação',
      capacity: 40,
      furniture: 'Mesas e cadeiras para 40 pessoas',
      lighting: 'Fluorescente',
      hvac: 'Ar condicionado split 18000 BTU',
      multimedia: 'Projetor + tela retrátil',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: SEED.spaces.studyRoom1,
      number: 'B205',
      type: 'study_room',
      block: 'B',
      campus: 'Pici',
      department: 'Ciência da Computação',
      capacity: 10,
      furniture: 'Mesa de reunião redonda, 10 cadeiras',
      lighting: 'LED',
      hvac: 'Ar condicionado split 9000 BTU',
      multimedia: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: SEED.spaces.meetingRoom1,
      number: 'C301',
      type: 'meeting_room',
      block: 'C',
      campus: 'Pici',
      department: 'Administração',
      capacity: 20,
      furniture: 'Mesa de conferência, 20 cadeiras',
      lighting: 'LED regulável',
      hvac: 'Ar condicionado split 12000 BTU',
      multimedia: 'TV 65" + videoconferência',
      createdAt: now,
      updatedAt: now,
    },
  ]).onConflictDoNothing();

  // ── Equipment ──────────────────────────────────────────────────────────────
  await db.insert(schema.equipment).values([
    {
      id: SEED.equipment.projector1,
      spaceId: SEED.spaces.classroom1,
      name: 'Projetor Epson PowerLite',
      type: 'projector',
      status: 'working',
      notes: null,
      updatedBy: SEED.users.staff1,
      updatedAt: now,
    },
    {
      id: SEED.equipment.ac1,
      spaceId: SEED.spaces.studyRoom1,
      name: 'Ar Condicionado Midea 9000 BTU',
      type: 'hvac',
      status: 'working',
      notes: null,
      updatedBy: SEED.users.maintenance1,
      updatedAt: now,
    },
  ]).onConflictDoNothing();

  console.log('Seed data inserted successfully.');
}

// ── Import schema for use in seed function ────────────────────────────────
import * as schema from './schema';

// ── Workers-compatible entry (invoked via wrangler d1 execute or a custom script) ──
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const db = createDb(env.DB);
    await seed(db);
    return new Response('Seed complete', { status: 200 });
  },
};
