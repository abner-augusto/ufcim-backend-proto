import { eq, and, ne, gte, lte, asc, count, inArray, type SQL } from 'drizzle-orm';
import { reservations, spaces, users } from '@/db/schema';
import type { Database } from '@/db/client';
import { presentReservationForViewer } from '@/lib/reservation-privacy';
import type { DepartmentReservationQuery } from '@/validators/department-reservation.schema';

function statusCondition(status: DepartmentReservationQuery['status']): SQL | undefined {
  if (!status || status === 'all') return undefined;
  if (status === 'active') return ne(reservations.status, 'canceled');
  return eq(reservations.status, status);
}

function buildWhereClause(db: Database, departmentId: string, filters: DepartmentReservationQuery): SQL {
  const spaceIdsSubquery = db.select({ id: spaces.id }).from(spaces).where(eq(spaces.department, departmentId));
  const conditions: SQL[] = [inArray(reservations.spaceId, spaceIdsSubquery)];

  if (filters.spaceId) conditions.push(eq(reservations.spaceId, filters.spaceId));
  if (filters.createdBy) conditions.push(eq(reservations.createdBy, filters.createdBy));
  if (filters.dateFrom) conditions.push(gte(reservations.date, filters.dateFrom));
  if (filters.dateTo) conditions.push(lte(reservations.date, filters.dateTo));
  const statusClause = statusCondition(filters.status);
  if (statusClause) conditions.push(statusClause);

  return and(...conditions)!;
}

function emptyDepartmentResponse(page: number, limit: number) {
  return {
    data: [],
    pagination: { page, limit, total: 0, totalPages: 1 },
    spaces: [],
    creators: [],
  };
}

export class DepartmentReservationService {
  constructor(private db: Database) {}

  private async resolveDepartment(viewerId: string, tokenDepartment?: string): Promise<string | null> {
    if (tokenDepartment && tokenDepartment !== 'Unknown') return tokenDepartment;
    const row = await this.db.query.users.findFirst({
      where: eq(users.id, viewerId),
      columns: { department: true },
    });
    return row?.department && row.department !== 'Unknown' ? row.department : null;
  }

  async list(viewerId: string, tokenDepartment: string | undefined, filters: DepartmentReservationQuery) {
    const departmentId = await this.resolveDepartment(viewerId, tokenDepartment);
    if (!departmentId) return emptyDepartmentResponse(filters.page, filters.limit);

    const where = buildWhereClause(this.db, departmentId, filters);
    const offset = (filters.page - 1) * filters.limit;

    const [rows, [countRow], deptSpaces, deptCreators] = await Promise.all([
      this.db.query.reservations.findMany({
        where,
        with: {
          space: true,
          creator: { columns: { id: true, name: true } },
          requester: { columns: { id: true, name: true } },
        },
        orderBy: (r, { desc }) => [desc(r.date), desc(r.startTime), desc(r.id)],
        limit: filters.limit,
        offset,
      }),
      this.db.select({ total: count() }).from(reservations).where(where),
      this.db
        .select({ id: spaces.id, name: spaces.name, number: spaces.number })
        .from(spaces)
        .where(eq(spaces.department, departmentId))
        .orderBy(asc(spaces.name), asc(spaces.number)),
      this.db
        .selectDistinct({ id: users.id, name: users.name })
        .from(reservations)
        .innerJoin(spaces, eq(reservations.spaceId, spaces.id))
        .innerJoin(users, eq(reservations.createdBy, users.id))
        .where(eq(spaces.department, departmentId))
        .orderBy(asc(users.name)),
    ]);

    const total = countRow?.total ?? 0;
    return {
      data: rows.map((row) => presentReservationForViewer(row, { userId: viewerId, role: 'staff' })),
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / filters.limit)),
      },
      spaces: deptSpaces,
      creators: deptCreators,
    };
  }
}
