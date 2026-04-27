import { createMiddleware } from 'hono/factory';
import type { JwtPayload, UserRole } from '@/types/auth';
import type { Env } from '@/types/env';

/**
 * Restricts access to specific roles.
 * Must be used after authMiddleware (requires c.get('user') to be set).
 *
 * Usage: route.post('/path', rbac(['professor', 'staff']), handler)
 */
const ROLE_LABELS: Record<UserRole, string> = {
  student: 'estudante',
  professor: 'professor',
  staff: 'funcionário',
  maintenance: 'manutenção',
};

export function rbac(allowedRoles: UserRole[]) {
  return createMiddleware<{ Bindings: Env; Variables: { user: JwtPayload } }>(
    async (c, next) => {
      const user = c.get('user');
      const userRole = extractRole(user);

      if (!userRole || !allowedRoles.includes(userRole)) {
        const labels = allowedRoles.map((r) => ROLE_LABELS[r]).join(', ');
        return c.json(
          {
            error: `Você não tem permissão para realizar esta ação. Perfil necessário: ${labels}.`,
            code: 'FORBIDDEN',
          },
          403
        );
      }

      await next();
    }
  );
}

export function isMasterAdmin(payload: JwtPayload): boolean {
  return (payload.realm_access?.roles ?? []).includes('ufcim-master-admin');
}

export function requireMasterAdmin() {
  return createMiddleware<{ Bindings: Env; Variables: { user: JwtPayload } }>(async (c, next) => {
    const user = c.get('user');
    if (!isMasterAdmin(user)) {
      return c.json(
        { error: 'Acesso restrito ao administrador principal.', code: 'FORBIDDEN' },
        403
      );
    }
    await next();
  });
}

/**
 * Extracts the UFCIM application role from Keycloak JWT realm_access claims.
 * Maps Keycloak realm roles to app roles.
 */
export function extractRole(payload: JwtPayload): UserRole | null {
  const roles = payload.realm_access?.roles ?? [];

  const roleMap: Record<string, UserRole> = {
    'ufcim-student': 'student',
    'ufcim-professor': 'professor',
    'ufcim-staff': 'staff',
    'ufcim-maintenance': 'maintenance',
  };

  for (const [keycloakRole, appRole] of Object.entries(roleMap)) {
    if (roles.includes(keycloakRole)) return appRole;
  }

  return null;
}
