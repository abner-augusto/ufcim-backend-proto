export const DEFAULT_CLOSED_FROM = '22:00';
export const DEFAULT_CLOSED_TO = '07:00';
/** Hour-aligned times: still used for a space's closed hours (`closedFrom`/`closedTo`). */
export const HOURLY_TIME_REGEX = /^([01]\d|2[0-3]):00$/;
export const BOUNDARY_TIME_REGEX = /^(?:([01]\d|2[0-3]):00|24:00)$/;

/** Booking granularity (MEL-024): reservations and blockings move in 30-minute steps. */
export const SLOT_MINUTES = 30;
/** Shortest reservation, series occurrence or blocking accepted (MEL-024). */
export const MIN_DURATION_MINUTES = 60;
/** A booking start: `HH:00` or `HH:30`. */
export const SLOT_START_TIME_REGEX = /^([01]\d|2[0-3]):(00|30)$/;
/** A booking end: `HH:00`, `HH:30` or `24:00`. */
export const SLOT_END_TIME_REGEX = /^(?:([01]\d|2[0-3]):(00|30)|24:00)$/;

export function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
  const minutes = (totalMinutes % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function deriveLegacyTimeSlot(startTime: string) {
  const hour = timeToMinutes(startTime) / 60;
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

export function isHourlyTime(value: string) {
  return HOURLY_TIME_REGEX.test(value);
}

export function isBoundaryTime(value: string) {
  return BOUNDARY_TIME_REGEX.test(value);
}

export function isSlotStartTime(value: string) {
  return SLOT_START_TIME_REGEX.test(value);
}

export function isSlotEndTime(value: string) {
  return SLOT_END_TIME_REGEX.test(value);
}

/** True when `startTime`–`endTime` lasts at least {@link MIN_DURATION_MINUTES}. */
export function meetsMinimumDuration(startTime: string, endTime: string) {
  return timeToMinutes(endTime) - timeToMinutes(startTime) >= MIN_DURATION_MINUTES;
}

export function normalizeClosedHours(closedFrom?: string | null, closedTo?: string | null) {
  return {
    closedFrom: isHourlyTime(closedFrom ?? '') ? closedFrom! : DEFAULT_CLOSED_FROM,
    closedTo: isBoundaryTime(closedTo ?? '') ? closedTo! : DEFAULT_CLOSED_TO,
  };
}

function normalizeInterval(startTime?: string | null, endTime?: string | null) {
  if (!isSlotStartTime(startTime ?? '') || !isSlotEndTime(endTime ?? '')) return null;
  if (timeToMinutes(startTime!) >= timeToMinutes(endTime!)) return null;

  return { startTime: startTime!, endTime: endTime! };
}

export function intervalsOverlap(
  leftStart: string,
  leftEnd: string,
  rightStart: string,
  rightEnd: string
) {
  return timeToMinutes(leftStart) < timeToMinutes(rightEnd)
    && timeToMinutes(leftEnd) > timeToMinutes(rightStart);
}

/**
 * Inclusive list of `YYYY-MM-DD` dates between two dates (MEL-017 multi-day
 * blockings). Assumes `from <= to` and valid ISO dates — callers validate first.
 */
export function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function getClosedIntervals(closedFrom: string, closedTo: string) {
  const normalized = normalizeClosedHours(closedFrom, closedTo);
  const from = timeToMinutes(normalized.closedFrom);
  const to = timeToMinutes(normalized.closedTo);

  if (from === to) return [{ startTime: '00:00', endTime: '24:00' }];
  if (from < to) return [{ startTime: normalized.closedFrom, endTime: normalized.closedTo }];

  return [
    { startTime: '00:00', endTime: normalized.closedTo },
    { startTime: normalized.closedFrom, endTime: '24:00' },
  ];
}

export function overlapsClosedHours(
  startTime: string,
  endTime: string,
  closedFrom: string,
  closedTo: string
) {
  return getClosedIntervals(closedFrom, closedTo).some((interval) =>
    intervalsOverlap(startTime, endTime, interval.startTime, interval.endTime)
  );
}

export type SlotStatus = 'closed' | 'blocked' | 'reserved' | 'available';

/**
 * Day availability in `stepMinutes` slots (default {@link SLOT_MINUTES}: 48 slots).
 * Precedence per slot: closed > blocked > reserved > available.
 */
export function buildAvailability(
  closedFrom: string,
  closedTo: string,
  reservations: Array<{ startTime: string; endTime: string }>,
  blockings: Array<{ startTime: string; endTime: string }>,
  stepMinutes: number = SLOT_MINUTES
): Array<{ startTime: string; endTime: string; status: SlotStatus }> {
  const normalizedClosedHours = normalizeClosedHours(closedFrom, closedTo);
  const normalizedReservations = reservations
    .map((reservation) => normalizeInterval(reservation.startTime, reservation.endTime))
    .filter((reservation): reservation is { startTime: string; endTime: string } => reservation !== null);
  const normalizedBlockings = blockings
    .map((blocking) => normalizeInterval(blocking.startTime, blocking.endTime))
    .filter((blocking): blocking is { startTime: string; endTime: string } => blocking !== null);
  const slots: Array<{ startTime: string; endTime: string; status: SlotStatus }> = [];

  for (let minutes = 0; minutes < 24 * 60; minutes += stepMinutes) {
    const startTime = minutesToTime(minutes);
    const endTime = minutesToTime(Math.min(minutes + stepMinutes, 24 * 60));

    const status: SlotStatus = overlapsClosedHours(
      startTime,
      endTime,
      normalizedClosedHours.closedFrom,
      normalizedClosedHours.closedTo
    )
      ? 'closed'
      : normalizedBlockings.some((blocking) => intervalsOverlap(startTime, endTime, blocking.startTime, blocking.endTime))
        ? 'blocked'
        : normalizedReservations.some((reservation) => intervalsOverlap(startTime, endTime, reservation.startTime, reservation.endTime))
          ? 'reserved'
          : 'available';

    slots.push({ startTime, endTime, status });
  }

  return slots;
}

/**
 * Per-hour roll-up of {@link buildAvailability} slots (MEL-024): for each of the
 * 24 hours, how many of its slots are open (not closed) and how many of those are
 * occupied (reserved or blocked). Reports keep `hourlyAverage`/`peakHour` per hour.
 */
export function hourlyOccupancy(
  slots: Array<{ startTime: string; status: string }>
): Array<{ hour: string; occupied: number; open: number }> {
  const hours = Array.from({ length: 24 }, (_, h) => ({
    hour: `${String(h).padStart(2, '0')}:00`,
    occupied: 0,
    open: 0,
  }));

  for (const slot of slots) {
    const bucket = hours[Math.floor(timeToMinutes(slot.startTime) / 60)];
    if (!bucket || slot.status === 'closed') continue;
    bucket.open++;
    if (slot.status === 'reserved' || slot.status === 'blocked') bucket.occupied++;
  }

  return hours;
}
