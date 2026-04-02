import type { Database } from '@/db/client';

export class StatsService {
  constructor(private db: Database) {}

  async getDashboardStats(date = new Date().toISOString().slice(0, 10)) {
    const [allSpaces, todayReservations, activeBlockings, allUsers] = await Promise.all([
      this.db.query.spaces.findMany(),
      this.db.query.reservations.findMany(),
      this.db.query.blockings.findMany(),
      this.db.query.users.findMany(),
    ]);

    return {
      totalSpaces: allSpaces.length,
      activeReservationsToday: todayReservations.filter(
        (reservation) => reservation.date === date && reservation.status === 'confirmed'
      ).length,
      activeBlockings: activeBlockings.filter((blocking) => blocking.status === 'active').length,
      totalUsers: allUsers.length,
    };
  }
}
