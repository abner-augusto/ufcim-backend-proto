import { eq, and, count, isNull } from 'drizzle-orm';
import { users, notifications } from '@/db/schema';
import type { Database } from '@/db/client';
import type { JwtPayload } from '@/types/auth';
import { extractRole } from '@/middleware/rbac';
import { NotFoundError } from '@/middleware/error-handler';

interface PaginatedUsers {
  data: Awaited<ReturnType<Database['query']['users']['findMany']>>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export class UserService {
  constructor(private db: Database) {}

  /**
   * Upsert a user from JWT claims. Called on every authenticated request
   * (or on first login) to keep local user data in sync with Keycloak.
   */
  async syncFromToken(payload: JwtPayload) {
    const role = extractRole(payload) ?? 'student';
    const now = new Date().toISOString();

    await this.db
      .insert(users)
      .values({
        id: payload.sub,
        name: payload.name,
        registration: payload.registration ?? payload.preferred_username ?? null,
        role,
        department: payload.department ?? 'Unknown',
        email: payload.email,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          name: payload.name,
          email: payload.email,
          role,
          department: payload.department ?? 'Unknown',
          updatedAt: now,
        },
      });

    return this.getById(payload.sub);
  }

  async getById(id: string) {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, id),
    });
    if (!user) throw new NotFoundError('User');
    return user;
  }

  async getByEmail(email: string) {
    const user = await this.db.query.users.findFirst({
      where: eq(users.email, email),
    });
    return user ?? null;
  }

  async getMeProfile(id: string) {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, id),
      with: { department: true },
    });
    if (!user) throw new NotFoundError('User');

    const [{ unreadCount }] = await this.db
      .select({ unreadCount: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, id),
          eq(notifications.read, false)
        )
      );

    return {
      ...user,
      department: user.department?.name ?? user.department as unknown as string,
      unreadCount,
    };
  }

  async list(page: number, limit: number) {
    const data = await this.db.query.users.findMany({
      where: isNull(users.deletedAt),
      orderBy: (u, { asc }) => [asc(u.name)],
      limit,
      offset: (page - 1) * limit,
    });
    return data;
  }

  async listForAdmin(page: number, limit: number, includeDeleted = false): Promise<PaginatedUsers> {
    const allUsers = await this.db.query.users.findMany({
      where: includeDeleted ? undefined : isNull(users.deletedAt),
      orderBy: (u, { asc }) => [asc(u.name)],
    });

    const total = allUsers.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;

    return {
      data: allUsers.slice(start, start + limit),
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }
}
