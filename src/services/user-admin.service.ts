import { eq, and, isNull } from 'drizzle-orm';
import { users, refreshTokens } from '@/db/schema';
import type { Database } from '@/db/client';
import type { Env } from '@/types/env';
import type { UserRole } from '@/types/auth';
import { ForbiddenError, NotFoundError } from '@/middleware/error-handler';
import { AuditLogService } from '@/services/audit-log.service';
import { InvitationService } from '@/services/invitation.service';

type User = typeof users.$inferSelect;

export class UserAdminService {
  private auditLog: AuditLogService;

  constructor(
    private db: Database,
    private env: Env
  ) {
    this.auditLog = new AuditLogService(db);
  }

  async changeRole(actorId: string, userId: string, newRole: UserRole): Promise<User> {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new NotFoundError('User');
    if (user.isMasterAdmin) {
      throw new ForbiddenError('Não é possível alterar o papel do administrador principal');
    }

    const now = new Date().toISOString();
    const [updated] = await this.db
      .update(users)
      .set({ role: newRole, updatedAt: now })
      .where(eq(users.id, userId))
      .returning();

    await this.auditLog.log(actorId, 'user.role.changed', userId, 'user', `Papel alterado para ${newRole}`);
    return updated;
  }

  async setDisabled(actorId: string, userId: string, disabled: boolean): Promise<User> {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new NotFoundError('User');
    if (user.isMasterAdmin) {
      throw new ForbiddenError('Não é possível desativar o administrador principal');
    }

    const now = new Date().toISOString();
    const [updated] = await this.db
      .update(users)
      .set({ disabledAt: disabled ? now : null, updatedAt: now })
      .where(eq(users.id, userId))
      .returning();

    if (disabled) {
      await this.db
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    }

    await this.auditLog.log(
      actorId,
      'user.disabled',
      userId,
      'user',
      disabled ? 'Conta desativada' : 'Conta reativada'
    );
    return updated;
  }

  async resetPassword(actorId: string, userId: string): Promise<{ token: string; url: string }> {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new NotFoundError('User');

    const invService = new InvitationService(this.db, this.env);
    const { token, url } = await invService.create({
      inviterId: actorId,
      email: user.email,
      name: user.name,
      role: user.role as UserRole,
      department: user.department,
      registration: user.registration,
      ttlHours: 24,
      purpose: 'reset',
    });

    await this.auditLog.log(actorId, 'user.password.reset', userId, 'user');
    return { token, url };
  }

  async revokeAllSessions(actorId: string, userId: string): Promise<{ revoked: number }> {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new NotFoundError('User');

    const now = new Date().toISOString();
    const result = await this.db
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
      .returning();

    await this.auditLog.log(
      actorId,
      'user.sessions.revoked',
      userId,
      'user',
      `${result.length} sessão(ões) revogada(s)`
    );
    return { revoked: result.length };
  }
}
