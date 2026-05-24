import type { UserRole } from '@/types/auth';

const ROLE_LABELS: Record<string, string> = {
  student: 'estudante',
  professor: 'professor',
  staff: 'funcionário',
  maintenance: 'manutenção',
};

const PRIVILEGED_ROLES: UserRole[] = ['professor', 'staff', 'maintenance'];

interface AuthorInput {
  ownerId: string;
  ownerName: string;
  ownerRole: string;
}

interface ViewerInput {
  userId: string;
  role: UserRole;
}

/**
 * Returns { displayName, role, isSelf }.
 * - If viewer is the owner: show full name + isSelf=true.
 * - If viewer has a privileged role (professor/staff/maintenance/coordinator/maintainer): show full name.
 * - Otherwise (student): show only the role label.
 *
 * Coordinator/maintainer roles (from space_managers) should be passed via `isManager: true`.
 */
export function formatReservationAuthor(
  owner: AuthorInput,
  viewer: ViewerInput,
  options: { isManager?: boolean } = {}
): { displayName: string; role: string; isSelf: boolean } {
  const isSelf = owner.ownerId === viewer.userId;
  if (isSelf) {
    return { displayName: owner.ownerName, role: owner.ownerRole, isSelf: true };
  }

  const isPrivileged = PRIVILEGED_ROLES.includes(viewer.role) || options.isManager;
  if (isPrivileged) {
    return { displayName: owner.ownerName, role: owner.ownerRole, isSelf: false };
  }

  // Student viewing someone else's reservation: only role
  const label = ROLE_LABELS[owner.ownerRole] ?? owner.ownerRole;
  return { displayName: label, role: owner.ownerRole, isSelf: false };
}
