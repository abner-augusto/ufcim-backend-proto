import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { invitations, invitationRequests, users } from '@/db/schema';
import type { Database } from '@/db/client';
import type { Env } from '@/types/env';
import type { UserRole } from '@/types/auth';
import { ConflictError, NotFoundError } from '@/middleware/error-handler';
import { assertAllowedDomain } from '@/lib/email-domain';
import { AuditLogService } from '@/services/audit-log.service';
import { InvitationService } from '@/services/invitation.service';
import { TelegramService } from '@/services/telegram.service';
import type { EmailResult } from '@/services/email.service';

type InvitationRequest = typeof invitationRequests.$inferSelect;

export class InvitationRequestService {
  private auditLog: AuditLogService;

  constructor(
    private db: Database,
    private env: Env
  ) {
    this.auditLog = new AuditLogService(db);
  }

  /** Public self-service: a guest asks for access. Creates a pending request. */
  async request(input: { name: string; email: string }): Promise<InvitationRequest> {
    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();

    assertAllowedDomain(this.env, email);

    // Already a user? Don't queue a request.
    const existingUser = await this.db.query.users.findFirst({ where: eq(users.email, email) });
    if (existingUser) {
      throw new ConflictError('Já existe uma conta com este e-mail. Tente fazer login.');
    }

    // Already a pending request? Avoid duplicates.
    const existingRequest = await this.db.query.invitationRequests.findFirst({
      where: and(eq(invitationRequests.email, email), eq(invitationRequests.status, 'pending')),
    });
    if (existingRequest) {
      throw new ConflictError('Já existe uma solicitação pendente para este e-mail.');
    }

    // Already a live invitation pending acceptance? Treat as duplicate.
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
      throw new ConflictError('Já existe um convite pendente para este e-mail.');
    }

    const [created] = await this.db
      .insert(invitationRequests)
      .values({ id: crypto.randomUUID(), name, email, status: 'pending', createdAt: now })
      .returning();

    // Best-effort admin alert; never blocks the request flow.
    await new TelegramService(this.env).notifyInvitationRequest({ name, email });

    return created;
  }

  async list(status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending'): Promise<InvitationRequest[]> {
    return this.db.query.invitationRequests.findMany({
      where: status === 'all' ? undefined : eq(invitationRequests.status, status),
      orderBy: [desc(invitationRequests.createdAt)],
    });
  }

  /** Admin approves a request: chooses role + department, creates the real invitation (which e-mails the link). */
  async approve(
    adminId: string,
    requestId: string,
    input: { role: UserRole; department: string; registration?: string | null }
  ): Promise<{ url: string; email: EmailResult; request: InvitationRequest }> {
    const req = await this.loadPending(requestId);

    const invitationService = new InvitationService(this.db, this.env);
    const { invitation, url, email } = await invitationService.create({
      inviterId: adminId,
      email: req.email,
      name: req.name,
      role: input.role,
      department: input.department,
      registration: input.registration ?? null,
    });

    const now = new Date().toISOString();
    const [updated] = await this.db
      .update(invitationRequests)
      .set({ status: 'approved', reviewedAt: now, reviewedBy: adminId, invitationId: invitation.id })
      .where(eq(invitationRequests.id, requestId))
      .returning();

    await this.auditLog.log(adminId, 'invitation_request.approved', requestId, 'invitation_request', `Solicitação aprovada para ${req.email}`);

    return { url, email, request: updated };
  }

  async reject(adminId: string, requestId: string): Promise<InvitationRequest> {
    await this.loadPending(requestId);

    const now = new Date().toISOString();
    const [updated] = await this.db
      .update(invitationRequests)
      .set({ status: 'rejected', reviewedAt: now, reviewedBy: adminId })
      .where(eq(invitationRequests.id, requestId))
      .returning();

    await this.auditLog.log(adminId, 'invitation_request.rejected', requestId, 'invitation_request');
    return updated;
  }

  private async loadPending(requestId: string): Promise<InvitationRequest> {
    const req = await this.db.query.invitationRequests.findFirst({
      where: eq(invitationRequests.id, requestId),
    });
    if (!req) throw new NotFoundError('Invitation request');
    if (req.status !== 'pending') {
      throw new ConflictError('Esta solicitação já foi revisada.');
    }
    return req;
  }
}
