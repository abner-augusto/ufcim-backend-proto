import { eq } from 'drizzle-orm';
import { users, userCredentials, refreshTokens, invitations } from '@/db/schema';
import type { Database } from '@/db/client';
import type { Env } from '@/types/env';
import type { UserRole } from '@/types/auth';
import { UnauthorizedError } from '@/middleware/error-handler';
import { AuditLogService } from '@/services/audit-log.service';
import { hashPassword, verifyPassword, generateOpaqueToken, sha256Hex } from '@/lib/crypto';
import { signAccessToken } from '@/lib/jwt';

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  registration: string | null;
  role: string;
  department: string;
  isMasterAdmin: boolean;
}

export class AuthService {
  private auditLog: AuditLogService;

  constructor(
    private db: Database,
    private env: Env
  ) {
    this.auditLog = new AuditLogService(db);
  }

  async login(input: {
    email: string;
    password: string;
    userAgent?: string;
  }): Promise<{ accessToken: string; refreshToken: string; user: PublicUser }> {
    const email = input.email.trim().toLowerCase();
    const password = input.password;
    const userAgent = input.userAgent;

    const user = await this.db.query.users.findFirst({ where: eq(users.email, email) });
    if (!user) throw new UnauthorizedError('Credenciais inválidas');

    if (user.disabledAt) throw new UnauthorizedError('Conta desativada');

    const creds = await this.db.query.userCredentials.findFirst({
      where: eq(userCredentials.userId, user.id),
    });
    if (!creds) throw new UnauthorizedError('Credenciais inválidas');

    if (creds.lockedUntil && creds.lockedUntil > new Date().toISOString()) {
      throw new UnauthorizedError('Conta temporariamente bloqueada. Tente novamente mais tarde.');
    }

    const valid = await verifyPassword(password, creds.passwordHash);
    if (!valid) {
      const newAttempts = creds.failedAttempts + 1;
      if (newAttempts >= 5) {
        const lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        await this.db
          .update(userCredentials)
          .set({ failedAttempts: 0, lockedUntil })
          .where(eq(userCredentials.userId, user.id));
      } else {
        await this.db
          .update(userCredentials)
          .set({ failedAttempts: newAttempts })
          .where(eq(userCredentials.userId, user.id));
      }
      await this.auditLog.log(user.id, 'auth.login.failed', user.id, 'user');
      throw new UnauthorizedError('Credenciais inválidas');
    }

    await this.db
      .update(userCredentials)
      .set({ failedAttempts: 0, lockedUntil: null })
      .where(eq(userCredentials.userId, user.id));

    const { accessToken, refreshToken } = await this.issueTokenPair(user, userAgent);
    await this.auditLog.log(user.id, 'auth.login.success', user.id, 'user');

    return { accessToken, refreshToken, user: toPublicUser(user) };
  }

  async refresh(input: {
    refreshToken: string;
    userAgent?: string;
  }): Promise<{ accessToken: string; refreshToken: string }> {
    const { refreshToken, userAgent } = input;
    const tokenHash = await sha256Hex(refreshToken);

    const existing = await this.db.query.refreshTokens.findFirst({
      where: eq(refreshTokens.tokenHash, tokenHash),
    });
    if (!existing) throw new UnauthorizedError('Credenciais inválidas');

    if (existing.revokedAt) {
      await this.auditLog.log(existing.userId, 'auth.refresh.reused', existing.id, 'refresh_token');
      await this.revokeChain(existing.replacedBy);
      throw new UnauthorizedError('Token reutilizado — sessão revogada por segurança');
    }

    if (existing.expiresAt < new Date().toISOString()) {
      throw new UnauthorizedError('Sessão expirada');
    }

    const user = await this.db.query.users.findFirst({ where: eq(users.id, existing.userId) });
    if (!user) throw new UnauthorizedError('Credenciais inválidas');
    if (user.disabledAt) throw new UnauthorizedError('Conta desativada');

    const newRawToken = generateOpaqueToken();
    const newHash = await sha256Hex(newRawToken);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const newId = crypto.randomUUID();

    await this.db.batch([
      this.db.insert(refreshTokens).values({
        id: newId,
        userId: user.id,
        tokenHash: newHash,
        expiresAt,
        userAgent: userAgent?.slice(0, 200) ?? null,
        createdAt: now,
      }),
      this.db
        .update(refreshTokens)
        .set({ revokedAt: now, replacedBy: newId })
        .where(eq(refreshTokens.id, existing.id)),
    ]);

    const accessToken = await this.buildAccessToken(user);
    await this.auditLog.log(user.id, 'auth.refresh', existing.id, 'refresh_token');

    return { accessToken, refreshToken: newRawToken };
  }

  async logout(input: { refreshToken: string }): Promise<void> {
    const tokenHash = await sha256Hex(input.refreshToken);
    const existing = await this.db.query.refreshTokens.findFirst({
      where: eq(refreshTokens.tokenHash, tokenHash),
    });
    if (!existing) return;

    const now = new Date().toISOString();
    if (!existing.revokedAt) {
      await this.db
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(eq(refreshTokens.id, existing.id));
    }
    await this.auditLog.log(existing.userId, 'auth.logout', existing.id, 'refresh_token');
  }

  async previewInvitation(token: string): Promise<{
    email: string;
    name: string;
    role: UserRole;
    department: string;
    inviterName: string;
    expiresAt: string;
    valid: boolean;
  }> {
    const tokenHash = await sha256Hex(token);
    const invite = await this.db.query.invitations.findFirst({
      where: eq(invitations.tokenHash, tokenHash),
      with: { inviter: true },
    });

    if (!invite) {
      return {
        email: '',
        name: '',
        role: 'student',
        department: '',
        inviterName: '',
        expiresAt: '',
        valid: false,
      };
    }

    const now = new Date().toISOString();
    const valid =
      invite.expiresAt > now && invite.acceptedAt == null && invite.revokedAt == null;

    return {
      email: invite.email,
      name: invite.name,
      role: invite.role as UserRole,
      department: invite.department,
      inviterName: invite.inviter?.name ?? '',
      expiresAt: invite.expiresAt,
      valid,
    };
  }

  async acceptInvitation(input: {
    token: string;
    password: string;
    userAgent?: string;
  }): Promise<{ accessToken: string; refreshToken: string; user: PublicUser }> {
    const { token, password, userAgent } = input;
    const preview = await this.previewInvitation(token);
    if (!preview.valid) throw new UnauthorizedError('Convite inválido ou expirado');

    const tokenHash = await sha256Hex(token);
    const invite = await this.db.query.invitations.findFirst({
      where: eq(invitations.tokenHash, tokenHash),
    });
    if (!invite) throw new UnauthorizedError('Convite inválido ou expirado');

    const now = new Date().toISOString();
    const passwordHash = await hashPassword(password);

    if (invite.purpose === 'reset') {
      const existingUser = await this.db.query.users.findFirst({
        where: eq(users.email, invite.email),
      });
      if (!existingUser) throw new UnauthorizedError('Usuário não encontrado');

      await this.db.batch([
        this.db
          .update(userCredentials)
          .set({ passwordHash, passwordUpdatedAt: now, failedAttempts: 0, lockedUntil: null })
          .where(eq(userCredentials.userId, existingUser.id)),
        this.db
          .update(invitations)
          .set({ acceptedAt: now, acceptedUserId: existingUser.id })
          .where(eq(invitations.id, invite.id)),
      ]);

      const { accessToken, refreshToken } = await this.issueTokenPair(existingUser, userAgent);
      await this.auditLog.log(existingUser.id, 'auth.password.reset', invite.id, 'invitation');
      return { accessToken, refreshToken, user: toPublicUser(existingUser) };
    }

    const newUserId = crypto.randomUUID();
    await this.db.batch([
      this.db.insert(users).values({
        id: newUserId,
        name: invite.name,
        email: invite.email,
        role: invite.role,
        department: invite.department,
        registration: invite.registration ?? null,
        isMasterAdmin: false,
        disabledAt: null,
        createdAt: now,
        updatedAt: now,
      }),
      this.db.insert(userCredentials).values({
        userId: newUserId,
        passwordHash,
        passwordUpdatedAt: now,
        failedAttempts: 0,
      }),
      this.db
        .update(invitations)
        .set({ acceptedAt: now, acceptedUserId: newUserId })
        .where(eq(invitations.id, invite.id)),
    ]);

    const newUser = await this.db.query.users.findFirst({ where: eq(users.id, newUserId) });
    if (!newUser) throw new UnauthorizedError('Erro ao criar conta');

    const { accessToken, refreshToken } = await this.issueTokenPair(newUser, userAgent);
    await this.auditLog.log(newUserId, 'invitation.accepted', invite.id, 'invitation');

    return { accessToken, refreshToken, user: toPublicUser(newUser) };
  }

  private async issueTokenPair(
    user: { id: string; name: string; email: string; registration: string | null; role: string; department: string; isMasterAdmin: boolean },
    userAgent?: string
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = await this.buildAccessToken(user);
    const rawToken = generateOpaqueToken();
    const tokenHash = await sha256Hex(rawToken);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await this.db.insert(refreshTokens).values({
      id: crypto.randomUUID(),
      userId: user.id,
      tokenHash,
      expiresAt,
      userAgent: userAgent?.slice(0, 200) ?? null,
      createdAt: now,
    });

    return { accessToken, refreshToken: rawToken };
  }

  private async buildAccessToken(user: {
    id: string;
    name: string;
    email: string;
    registration: string | null;
    role: string;
    department: string;
    isMasterAdmin: boolean;
  }): Promise<string> {
    return signAccessToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      registration: user.registration,
      department: user.department,
      role: user.role as UserRole,
      isMasterAdmin: user.isMasterAdmin,
      issuer: this.env.JWT_ISSUER,
      secret: this.env.JWT_SIGNING_SECRET,
    });
  }

  private async revokeChain(startId: string | null | undefined): Promise<void> {
    let currentId = startId;
    const visited = new Set<string>();
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const token = await this.db.query.refreshTokens.findFirst({
        where: eq(refreshTokens.id, currentId),
      });
      if (!token) break;
      if (!token.revokedAt) {
        await this.db
          .update(refreshTokens)
          .set({ revokedAt: new Date().toISOString() })
          .where(eq(refreshTokens.id, currentId));
      }
      currentId = token.replacedBy;
    }
  }
}

function toPublicUser(user: {
  id: string;
  name: string;
  email: string;
  registration: string | null;
  role: string;
  department: string;
  isMasterAdmin: boolean;
}): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    registration: user.registration,
    role: user.role,
    department: user.department,
    isMasterAdmin: user.isMasterAdmin,
  };
}
