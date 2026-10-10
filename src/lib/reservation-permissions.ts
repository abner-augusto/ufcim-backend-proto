/**
 * Who may edit or cancel a reservation (MEL-023): the owner and staff.
 * Students and professors touch only their own; maintenance touches none.
 *
 * Single extension point: MEL-025 will let the registered requester cancel
 * (but not edit) a reservation made on their behalf.
 */
export function canManageReservation(
  actor: { userId: string; role: string },
  reservation: { userId: string }
): boolean {
  if (actor.role === 'maintenance') return false;
  if (actor.role === 'staff') return true;
  return reservation.userId === actor.userId;
}
