import { describe, it, expect, beforeEach } from 'vitest';
import { StatsService } from '@/services/stats.service';
import { createMockDb, SEED } from '../helpers/mock-db';

describe('StatsService.getDashboardStats', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: StatsService;

  beforeEach(() => {
    db = createMockDb();
    service = new StatsService(db);
  });

  it('counts spaces, users, active blockings, and confirmed reservations for the requested day', async () => {
    db.query.spaces.findMany.mockResolvedValue([SEED.space, { ...SEED.space, id: 'space-2' }]);
    db.query.users.findMany.mockResolvedValue([
      { id: 'user-1' },
      { id: 'user-2' },
      { id: 'user-3' },
    ]);
    db.query.reservations.findMany.mockResolvedValue([
      SEED.reservation,
      { ...SEED.reservation, id: 'r-2', date: '2099-06-15', status: 'confirmed' },
      { ...SEED.reservation, id: 'r-3', date: '2099-06-15', status: 'canceled' },
      { ...SEED.reservation, id: 'r-4', date: '2099-06-16', status: 'confirmed' },
    ]);
    db.query.blockings.findMany.mockResolvedValue([
      SEED.blocking,
      { ...SEED.blocking, id: 'b-2', status: 'removed' },
      { ...SEED.blocking, id: 'b-3', status: 'active' },
    ]);

    const stats = await service.getDashboardStats('2099-06-15');

    expect(stats).toEqual({
      totalSpaces: 2,
      activeReservationsToday: 2,
      activeBlockings: 2,
      totalUsers: 3,
    });
  });
});
