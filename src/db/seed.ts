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
  recurrences: {
    weeklyClass: '00000000-0000-0000-0000-000000000051',
  },
  reservations: {
    todayReservation: '00000000-0000-0000-0000-000000000061',
    recurring1: '00000000-0000-0000-0000-000000000062',
    recurring2: '00000000-0000-0000-0000-000000000063',
    canceled1: '00000000-0000-0000-0000-000000000064',
  },
  blockings: {
    active1: '00000000-0000-0000-0000-000000000071',
    active2: '00000000-0000-0000-0000-000000000072',
    removed1: '00000000-0000-0000-0000-000000000073',
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
      modelId: null,
      closedFrom: '22:00',
      closedTo: '07:00',
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
      modelId: null,
      closedFrom: '22:00',
      closedTo: '07:00',
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
      modelId: null,
      closedFrom: '22:00',
      closedTo: '07:00',
      createdAt: now,
      updatedAt: now,
    },
  ]).onConflictDoNothing();

  // ── Equipment ──────────────────────────────────────────────────────────────
  await db.insert(schema.equipment).values([
    {
      id: SEED.equipment.projector1,
      assetId: '2020002658',
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
      assetId: '2020002659',
      spaceId: SEED.spaces.studyRoom1,
      name: 'Ar Condicionado Midea 9000 BTU',
      type: 'hvac',
      status: 'working',
      notes: null,
      updatedBy: SEED.users.maintenance1,
      updatedAt: now,
    },
  ]).onConflictDoNothing();

  await db.insert(schema.recurrences).values([
    {
      id: SEED.recurrences.weeklyClass,
      description: 'Aula semanal de Engenharia de Software',
      createdBy: SEED.users.professor1,
      createdAt: now,
    },
  ]).onConflictDoNothing();

  await db.insert(schema.reservations).values([
    {
      id: SEED.reservations.todayReservation,
      spaceId: SEED.spaces.classroom1,
      userId: SEED.users.professor1,
      date: '2026-04-02',
      timeSlot: 'morning',
      startTime: '09:00',
      endTime: '10:00',
      status: 'confirmed',
      recurrenceId: null,
      changeOrigin: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: SEED.reservations.recurring1,
      spaceId: SEED.spaces.classroom1,
      userId: SEED.users.professor1,
      date: '2026-04-09',
      timeSlot: 'afternoon',
      startTime: '14:00',
      endTime: '15:00',
      status: 'confirmed',
      recurrenceId: SEED.recurrences.weeklyClass,
      changeOrigin: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: SEED.reservations.recurring2,
      spaceId: SEED.spaces.classroom1,
      userId: SEED.users.professor1,
      date: '2026-04-16',
      timeSlot: 'afternoon',
      startTime: '14:00',
      endTime: '15:00',
      status: 'confirmed',
      recurrenceId: SEED.recurrences.weeklyClass,
      changeOrigin: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: SEED.reservations.canceled1,
      spaceId: SEED.spaces.studyRoom1,
      userId: SEED.users.student1,
      date: '2026-04-03',
      timeSlot: 'evening',
      startTime: '19:00',
      endTime: '20:00',
      status: 'canceled',
      recurrenceId: null,
      changeOrigin: null,
      createdAt: now,
      updatedAt: now,
    },
  ]).onConflictDoNothing();

  await db.insert(schema.blockings).values([
    {
      id: SEED.blockings.active1,
      spaceId: SEED.spaces.meetingRoom1,
      createdBy: SEED.users.staff1,
      date: '2026-04-02',
      timeSlot: 'afternoon',
      startTime: '15:00',
      endTime: '17:00',
      reason: 'Reunião do conselho departamental',
      blockType: 'administrative',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: SEED.blockings.active2,
      spaceId: SEED.spaces.studyRoom1,
      createdBy: SEED.users.maintenance1,
      date: '2026-04-05',
      timeSlot: 'morning',
      startTime: '08:00',
      endTime: '10:00',
      reason: 'Troca de unidade de ar condicionado',
      blockType: 'maintenance',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: SEED.blockings.removed1,
      spaceId: SEED.spaces.meetingRoom1,
      createdBy: SEED.users.staff1,
      date: '2026-03-29',
      timeSlot: 'morning',
      startTime: '08:00',
      endTime: '09:00',
      reason: 'Bloqueio removido de teste',
      blockType: 'administrative',
      status: 'removed',
      createdAt: now,
      updatedAt: now,
    },
  ]).onConflictDoNothing();

  await db.insert(schema.notifications).values([
    {
      id: '00000000-0000-0000-0000-000000000081',
      userId: SEED.users.professor1,
      title: 'Reserva confirmada',
      message: 'Sua reserva da sala A101 foi confirmada.',
      type: 'confirmed',
      read: false,
      sentAt: now,
    },
    {
      id: '00000000-0000-0000-0000-000000000082',
      userId: SEED.users.student1,
      title: 'Reserva cancelada',
      message: 'Sua reserva futura da sala B205 foi cancelada.',
      type: 'canceled',
      read: true,
      sentAt: now,
    },
  ]).onConflictDoNothing();

  await db.insert(schema.auditLogs).values([
    {
      id: '00000000-0000-0000-0000-000000000091',
      userId: SEED.users.staff1,
      actionType: 'create_space',
      referenceId: SEED.spaces.classroom1,
      referenceType: 'space',
      timestamp: now,
      details: 'Created space A101',
    },
    {
      id: '00000000-0000-0000-0000-000000000092',
      userId: SEED.users.professor1,
      actionType: 'create_reservation',
      referenceId: SEED.reservations.todayReservation,
      referenceType: 'reservation',
      timestamp: now,
      details: 'Reserved space A101 on 2026-04-02 (morning)',
    },
    {
      id: '00000000-0000-0000-0000-000000000093',
      userId: SEED.users.maintenance1,
      actionType: 'create_blocking',
      referenceId: SEED.blockings.active2,
      referenceType: 'blocking',
      timestamp: now,
      details: 'Blocked space B205 on 2026-04-05 (morning)',
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
