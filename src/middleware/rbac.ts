import { createMiddleware } from 'hono/factory';
import type { JwtPayload, UserRole } from '@/types/auth';
import type { Env } from '@/types/env';

/**
 * Restricts access to specific roles.
 * Must be used after authMiddleware (requires c.get('user') to be set).
 *
 * Usage: route.post('/path', rbac(['professor', 'staff']), handler)
 */
export function rbac(allowedRoles: UserRole[]) {
  return createMiddleware<{ Bindings: Env; Variables: { user: JwtPayload } }>(
    async (c, next) => {
      const user = c.get('user');
      const userRole = extractRole(user);

      if (!userRole || !allowedRoles.includes(userRole)) {
        return c.json(
          {
            error: `Esta ação exige um dos seguintes papéis: ${allowedRoles.join(', ')}`,
            code: 'FORBIDDEN',
          },
          403
        );
      }

      await next();
    }
  );
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
