import type { UserRole } from '@/types/auth';
import { ROLE_LABELS } from '@/lib/role-labels';

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
  const label = ROLE_LABELS[owner.ownerRole as UserRole] ?? owner.ownerRole;
  return { displayName: label, role: owner.ownerRole, isSelf: false };
}

interface PersonRef {
  id?: string;
  name: string;
  role: string;
}

/** A reservation row with its owner and (MEL-025) requester relations loaded. */
interface ReservationAuthorSource {
  userId: string;
  user?: PersonRef | null;
  requesterUserId?: string | null;
  requester?: PersonRef | null;
  requesterName?: string | null;
}

/**
 * Who a reservation is shown as belonging to (MEL-025): the person who asked
 * for it. That is the registered requester, else the free-text requester,
 * else the owner. A free-text requester has no account, so it never matches
 * the viewer (`ownerId: ''`) and borrows the registering staff's role, which
 * is all a student gets to see. Returns null when no person can be resolved.
 */
export function reservationAuthorInput(reservation: ReservationAuthorSource): AuthorInput | null {
  if (reservation.requesterUserId && reservation.requester) {
    return {
      ownerId: reservation.requesterUserId,
      ownerName: reservation.requester.name,
      ownerRole: reservation.requester.role,
    };
  }
  if (!reservation.user) return null;
  if (reservation.requesterName) {
    return { ownerId: '', ownerName: reservation.requesterName, ownerRole: reservation.user.role };
  }
  return { ownerId: reservation.userId, ownerName: reservation.user.name, ownerRole: reservation.user.role };
}

/**
 * The requester's contact is exposed only to staff (MEL-025): the value (or
 * null) for staff, `undefined` for everyone else so the key can be omitted.
 */
export function requesterContactFor(viewerRole: string, contact: string | null | undefined): string | null | undefined {
  return viewerRole === 'staff' ? contact ?? null : undefined;
}

/** Drops `requesterContact` from a reservation row unless the viewer is staff (MEL-025). */
export function withRequesterContactFor<T extends { requesterContact?: string | null }>(
  viewerRole: string,
  row: T
): T | Omit<T, 'requesterContact'> {
  if (viewerRole === 'staff') return row;
  const { requesterContact: _hidden, ...rest } = row;
  return rest;
}

interface MineReservationRow {
  userId: string;
  createdBy: string;
  requesterUserId: string | null;
  requesterName: string | null;
  requesterContact: string | null;
  creator?: { id: string; name: string } | null;
  requester?: { id: string; name: string } | null;
}

/**
 * Shapes a row of `GET /reservations/mine` for its viewer (MEL-025): replaces
 * the loaded user rows with `{ id, name }` refs, drops the contact for
 * non-staff and flags rows the viewer only sees as the registered requester.
 */
export function presentReservationForViewer<T extends MineReservationRow>(
  row: T,
  viewer: { userId: string; role: string }
) {
  const { creator, requester, requesterContact, ...rest } = row;
  const requesterRef = row.requesterUserId
    ? { userId: row.requesterUserId, name: requester?.name ?? '' }
    : row.requesterName
      ? { userId: null, name: row.requesterName }
      : null;
  const contact = requesterContactFor(viewer.role, requesterContact);

  return {
    ...rest,
    ...(contact === undefined ? {} : { requesterContact: contact }),
    requester: requesterRef,
    registeredBy: creator ? { id: creator.id, name: creator.name } : null,
    onBehalfOfMe: row.requesterUserId === viewer.userId && row.userId !== viewer.userId,
  };
}
