/** What the actor wants to do to the reservation (or series). */
export type ReservationAction = 'edit' | 'cancel';

/**
 * Who may edit or cancel a reservation.
 *
 * - MEL-023: the owner and staff. Students and professors touch only their
 *   own; maintenance touches none.
 * - MEL-025: the registered requester of a reservation made on their behalf
 *   may **cancel** it, never **edit** it.
 *
 * Also used for a whole series, passing the recurrence's creator as `userId`.
 */
export function canManageReservation(
  actor: { userId: string; role: string },
  reservation: { userId: string; requesterUserId?: string | null },
  action: ReservationAction
): boolean {
  if (actor.role === 'maintenance') return false;
  if (actor.role === 'staff') return true;
  if (reservation.userId === actor.userId) return true;
  return action === 'cancel' && !!reservation.requesterUserId && reservation.requesterUserId === actor.userId;
}
