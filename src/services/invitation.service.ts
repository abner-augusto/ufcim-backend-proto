import { eq, and, isNull, isNotNull, lt, gte } from 'drizzle-orm';
import { invitations, users } from '@/db/schema';
import type { Database } from '@/db/client';
import type { Env } from '@/types/env';
import type { UserRole } from '@/types/auth';
import { AppError, ConflictError, NotFoundError } from '@/middleware/error-handler';
import { AuditLogService } from '@/services/audit-log.service';
import { DepartmentService } from '@/services/department.service';
import { generateOpaqueToken, sha256Hex } from '@/lib/crypto';

type Invitation = typeof invitations.$inferSelect;

interface PaginatedInvitations {
  data: Invitation[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export class InvitationService {
  private auditLog: AuditLogService;

  constructor(
    private db: Database,
    private env: Env
  ) {
    this.auditLog = new AuditLogService(db);
  }

  private buildInviteUrl(token: string): string {
    if (!this.env.INVITE_BASE_URL) throw new Error('INVITE_BASE_URL não configurado — rode com --env dev');
    return `${this.env.INVITE_BASE_URL}/${token}`;
  }

  async create(input: {
    inviterId: string;
    email: string;
    name: string;
    role: UserRole;
    department: string;
    registration?: string | null;
    ttlHours?: number;
    purpose?: 'invite' | 'reset';
  }): Promise<{ invitation: Invitation; token: string; url: string }> {
    const { inviterId, email, name, role, department, registration, ttlHours = 72, purpose = 'invite' } = input;

    const deptService = new DepartmentService(this.db);
    if (!(await deptService.validateId(department))) {
      throw new AppError(422, `Departamento "${department}" não existe`, 'INVALID_DEPARTMENT');
    }

    // For 'invite' purpose: block existing users
    if (purpose === 'invite') {
      const existingUser = await this.db.query.users.findFirst({
        where: eq(users.email, email),
      });
      if (existingUser) {
        throw new ConflictError(`Já existe um usuário com o e-mail ${email}`);
      }

      // Block duplicate pending invitations
      const now = new Date().toISOString();
      const existingInvite = await this.db.query.invitations.findFirst({
        where: and(
          eq(invitations.email, email),
          eq(invitations.purpose, 'invite'),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gte(invitations.expiresAt, now)
        ),
      });
      if (existingInvite) {
        throw new ConflictError(
          `Já existe um convite pendente para ${email}. Use "Reenviar" para gerar um novo link.`
        );
      }
    }

    const rawToken = generateOpaqueToken();
    const tokenHash = await sha256Hex(rawToken);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
    const id = crypto.randomUUID();

    const [invitation] = await this.db
      .insert(invitations)
      .values({
        id,
        email,
        role,
        name,
        registration: registration ?? null,
        department,
        tokenHash,
        purpose,
        invitedBy: inviterId,
        expiresAt,
        createdAt: now,
      })
      .returning();

    const url = this.buildInviteUrl(rawToken);
    await this.auditLog.log(inviterId, 'invitation.created', id, 'invitation', `Convite criado para ${email}`);

    return { invitation, token: rawToken, url };
  }

  async list(filters: {
    status?: 'pending' | 'accepted' | 'expired' | 'revoked' | 'all';
    page: number;
    limit: number;
  }): Promise<PaginatedInvitations> {
    const all = await this.db.query.invitations.findMany({
      orderBy: (inv, { desc }) => [desc(inv.createdAt)],
    });

    const now = new Date().toISOString();
    const filtered = all.filter((inv) => {
      const status = filters.status ?? 'all';
      if (status === 'all') return true;
      if (status === 'accepted') return inv.acceptedAt != null;
      if (status === 'revoked') return inv.revokedAt != null;
      if (status === 'expired') return inv.expiresAt < now && inv.acceptedAt == null && inv.revokedAt == null;
      if (status === 'pending') return inv.acceptedAt == null && inv.revokedAt == null && inv.expiresAt >= now;
      return true;
    });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / filters.limit));
    const start = (filters.page - 1) * filters.limit;

    return {
      data: filtered.slice(start, start + filters.limit),
      pagination: { page: filters.page, limit: filters.limit, total, totalPages },
    };
  }

  async revoke(inviterId: string, invitationId: string): Promise<Invitation> {
    const invite = await this.db.query.invitations.findFirst({
      where: eq(invitations.id, invitationId),
    });
    if (!invite) throw new NotFoundError('Invitation');
    if (invite.acceptedAt) {
      throw new ConflictError('Não é possível revogar um convite já aceito');
    }

    const now = new Date().toISOString();
    const [updated] = await this.db
      .update(invitations)
      .set({ revokedAt: now })
      .where(eq(invitations.id, invitationId))
      .returning();

    await this.auditLog.log(inviterId, 'invitation.revoked', invitationId, 'invitation');
    return updated;
  }

  async resend(
    inviterId: string,
    invitationId: string,
    ttlHours = 72
  ): Promise<{ invitation: Invitation; token: string; url: string }> {
    const invite = await this.db.query.invitations.findFirst({
      where: eq(invitations.id, invitationId),
    });
    if (!invite) throw new NotFoundError('Invitation');
    if (invite.acceptedAt) {
      throw new ConflictError('Não é possível reenviar um convite já aceito');
    }

    const rawToken = generateOpaqueToken();
    const tokenHash = await sha256Hex(rawToken);
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

    const [updated] = await this.db
      .update(invitations)
      .set({ tokenHash, expiresAt, revokedAt: null })
      .where(eq(invitations.id, invitationId))
      .returning();

    const url = this.buildInviteUrl(rawToken);
    await this.auditLog.log(inviterId, 'invitation.resent', invitationId, 'invitation', `Convite reenviado para ${invite.email}`);
    return { invitation: updated, token: rawToken, url };
  }
}
