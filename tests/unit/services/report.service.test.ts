import { beforeEach, describe, expect, it } from 'vitest';
import { ReportService } from '@/services/report.service';
import { NotFoundError, AppError } from '@/middleware/error-handler';
import { createMockDb, SEED } from '../helpers/mock-db';

describe('ReportService.getSpaceReport', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: ReportService;

  beforeEach(() => {
    db = createMockDb();
    service = new ReportService(db);

    // Default mock space
    db.query.spaces.findFirst.mockResolvedValue({
      ...SEED.space,
      name: 'Sala de Aula A101',
      closedFrom: '22:00',
      closedTo: '07:00',
      department: { id: 'iaud', name: 'IAUD' },
    });

    // No reservations or blockings by default
    db.query.reservations.findMany.mockResolvedValue([]);
    db.query.blockings.findMany.mockResolvedValue([]);

    // Default space object for calls that don't override
    (service as any)._defaultSpace = {
      id: SEED.space.id,
      name: 'Sala de Aula A101',
      number: SEED.space.number,
      block: SEED.space.block,
      type: SEED.space.type,
      capacity: SEED.space.capacity,
      department: { id: 'iaud', name: 'IAUD' },
      closedFrom: '22:00',
      closedTo: '07:00',
    };
  });

  it('throws AppError for invalid date range (end before start)', async () => {
    await expect(
      service.getSpaceReport({
        spaceId: SEED.space.id,
        startDate: '2026-06-10',
        endDate: '2026-06-01',
        viewer: { userId: 'user-1', role: 'staff' },
        space: (service as any)._defaultSpace,
      })
    ).rejects.toThrow(AppError);
  });

  it('throws AppError for range exceeding 90 days', async () => {
    await expect(
      service.getSpaceReport({
        spaceId: SEED.space.id,
        startDate: '2026-01-01',
        endDate: '2026-05-01', // ~121 days
        viewer: { userId: 'user-1', role: 'staff' },
        space: (service as any)._defaultSpace,
      })
    ).rejects.toThrow(AppError);
  });

  it('returns empty report when no reservations or blockings exist', async () => {
    const report = await service.getSpaceReport({
      spaceId: SEED.space.id,
      startDate: '2026-06-01',
      endDate: '2026-06-07',
      viewer: { userId: 'user-1', role: 'staff' },
      space: (service as any)._defaultSpace,
    });

    expect(report.space.id).toBe(SEED.space.id);
    expect(report.space.name).toBe('Sala de Aula A101');
    expect(report.range.days).toBe(7);
    expect(report.summary.totalReservations).toBe(0);
    expect(report.summary.totalCanceledReservations).toBe(0);
    expect(report.summary.totalBlockings).toBe(0);
    expect(report.summary.occupancyRate).toBe(0);
    expect(report.dailySeries).toHaveLength(7);
    expect(report.reservations).toHaveLength(0);
    expect(report.blockings).toHaveLength(0);
  });

  it('returns report with reservations data', async () => {
    db.query.reservations.findMany.mockResolvedValue([
      {
        id: 'res-1',
        spaceId: SEED.space.id,
        userId: 'user-1',
        date: '2026-06-02',
        timeSlot: 'morning',
        startTime: '08:00',
        endTime: '10:00',
        status: 'confirmed',
        recurrenceId: null,
        purpose: 'class',
        description: 'Aula de Matemática',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        user: { id: 'user-1', name: 'João', role: 'professor' },
        recurrence: null,
      },
      {
        id: 'res-2',
        spaceId: SEED.space.id,
        userId: 'user-2',
        date: '2026-06-03',
        timeSlot: 'afternoon',
        startTime: '14:00',
        endTime: '16:00',
        status: 'confirmed',
        recurrenceId: null,
        purpose: 'meeting',
        description: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        user: { id: 'user-2', name: 'Maria', role: 'professor' },
        recurrence: null,
      },
      {
        id: 'res-3',
        spaceId: SEED.space.id,
        userId: 'user-1',
        date: '2026-06-02',
        timeSlot: 'morning',
        startTime: '08:00',
        endTime: '10:00',
        status: 'canceled',
        recurrenceId: null,
        purpose: 'other',
        description: 'Cancelada',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        user: { id: 'user-1', name: 'João', role: 'professor' },
        recurrence: null,
      },
    ]);

    const report = await service.getSpaceReport({
      spaceId: SEED.space.id,
      startDate: '2026-06-01',
      endDate: '2026-06-07',
      viewer: { userId: 'viewer-1', role: 'staff' },
      space: (service as any)._defaultSpace,
    });

    expect(report.summary.totalReservations).toBe(2);
    expect(report.summary.totalCanceledReservations).toBe(1);
    expect(report.summary.occupancyRate).toBeGreaterThan(0);
    expect(report.summary.distinctUsersWhoReserved).toBe(2);
    expect(report.reservations).toHaveLength(2);
    expect(report.reservations[0].author.displayName).toBe('João'); // staff sees name
    expect(report.dailySeries[1].reservations).toBe(1); // day 2 has 1 confirmed
    expect(report.dailySeries[2].reservations).toBe(1); // day 3 has 1 confirmed
  });

  it('applies privacy rules for student viewer', async () => {
    db.query.reservations.findMany.mockResolvedValue([
      {
        id: 'res-1',
        spaceId: SEED.space.id,
        userId: 'user-1',
        date: '2026-06-02',
        timeSlot: 'morning',
        startTime: '08:00',
        endTime: '10:00',
        status: 'confirmed',
        recurrenceId: null,
        purpose: 'class',
        description: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        user: { id: 'user-1', name: 'João', role: 'professor' },
        recurrence: null,
      },
    ]);

    const report = await service.getSpaceReport({
      spaceId: SEED.space.id,
      startDate: '2026-06-01',
      endDate: '2026-06-07',
      viewer: { userId: 'student-1', role: 'student' },
      space: (service as any)._defaultSpace,
    });

    // Student should see only role label for other people's reservations
    expect(report.reservations[0].author.displayName).toBe('professor');
  });

  it('shows own name for student viewing own reservation', async () => {
    db.query.reservations.findMany.mockResolvedValue([
      {
        id: 'res-1',
        spaceId: SEED.space.id,
        userId: 'student-self',
        date: '2026-06-02',
        timeSlot: 'morning',
        startTime: '08:00',
        endTime: '10:00',
        status: 'confirmed',
        recurrenceId: null,
        purpose: 'study',
        description: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        user: { id: 'student-self', name: 'Pedro', role: 'student' },
        recurrence: null,
      },
    ]);

    const report = await service.getSpaceReport({
      spaceId: SEED.space.id,
      startDate: '2026-06-01',
      endDate: '2026-06-07',
      viewer: { userId: 'student-self', role: 'student' },
      space: (service as any)._defaultSpace,
    });

    expect(report.reservations[0].author.displayName).toBe('Pedro');
  });

  it('includes blockings in the report', async () => {
    db.query.blockings.findMany.mockResolvedValue([
      {
        id: 'blk-1',
        spaceId: SEED.space.id,
        createdBy: 'staff-1',
        date: '2026-06-04',
        timeSlot: 'morning',
        startTime: '08:00',
        endTime: '12:00',
        reason: 'Manutenção',
        blockType: 'maintenance',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        creator: { id: 'staff-1', name: 'Admin', role: 'staff' },
      },
    ]);

    const report = await service.getSpaceReport({
      spaceId: SEED.space.id,
      startDate: '2026-06-01',
      endDate: '2026-06-07',
      viewer: { userId: 'viewer-1', role: 'staff' },
      space: (service as any)._defaultSpace,
    });

    expect(report.summary.totalBlockings).toBe(1);
    expect(report.blockings).toHaveLength(1);
    expect(report.blockings[0].blockType).toBe('maintenance');
    expect(report.blockings[0].reason).toBe('Manutenção');
  });

  it('returns dailySeries with all dates in range', async () => {
    const report = await service.getSpaceReport({
      spaceId: SEED.space.id,
      startDate: '2026-06-01',
      endDate: '2026-06-05',
      viewer: { userId: 'user-1', role: 'staff' },
      space: (service as any)._defaultSpace,
    });

    expect(report.dailySeries).toHaveLength(5);
    expect(report.dailySeries[0].date).toBe('2026-06-01');
    expect(report.dailySeries[4].date).toBe('2026-06-05');
  });

  it('returns hourlyAverage data', async () => {
    const report = await service.getSpaceReport({
      spaceId: SEED.space.id,
      startDate: '2026-06-01',
      endDate: '2026-06-07',
      viewer: { userId: 'user-1', role: 'staff' },
      space: (service as any)._defaultSpace,
    });

    // Should have operational hours (07:00 to 21:00 — closed from 22:00 to 07:00)
    expect(report.hourlyAverage.length).toBeGreaterThan(0);
    expect(report.hourlyAverage[0].hour).toBe('07:00');
  });

  it('returns peakDay and peakHour', async () => {
    db.query.reservations.findMany.mockResolvedValue([
      {
        id: 'res-1',
        spaceId: SEED.space.id,
        userId: 'user-1',
        date: '2026-06-02',
        timeSlot: 'morning',
        startTime: '08:00',
        endTime: '12:00',
        status: 'confirmed',
        recurrenceId: null,
        purpose: 'class',
        description: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        user: { id: 'user-1', name: 'João', role: 'professor' },
        recurrence: null,
      },
    ]);

    const report = await service.getSpaceReport({
      spaceId: SEED.space.id,
      startDate: '2026-06-01',
      endDate: '2026-06-03',
      viewer: { userId: 'user-1', role: 'staff' },
      space: (service as any)._defaultSpace,
    });

    expect(report.summary.peakDay).not.toBeNull();
    expect(report.summary.peakDay!.date).toBe('2026-06-02');
    expect(report.summary.peakHour).not.toBeNull();
  });
});
