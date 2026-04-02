export const DEFAULT_CLOSED_FROM = '22:00';
export const DEFAULT_CLOSED_TO = '07:00';
export const HOURLY_TIME_REGEX = /^([01]\d|2[0-3]):00$/;
export const BOUNDARY_TIME_REGEX = /^(?:([01]\d|2[0-3]):00|24:00)$/;

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

export function normalizeClosedHours(closedFrom?: string | null, closedTo?: string | null) {
  return {
    closedFrom: isHourlyTime(closedFrom ?? '') ? closedFrom! : DEFAULT_CLOSED_FROM,
    closedTo: isBoundaryTime(closedTo ?? '') ? closedTo! : DEFAULT_CLOSED_TO,
  };
}

function normalizeInterval(startTime?: string | null, endTime?: string | null) {
  if (!isHourlyTime(startTime ?? '') || !isBoundaryTime(endTime ?? '')) return null;
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

export function buildHourlyAvailability(
  closedFrom: string,
  closedTo: string,
  reservations: Array<{ startTime: string; endTime: string }>,
  blockings: Array<{ startTime: string; endTime: string }>
) {
  const normalizedClosedHours = normalizeClosedHours(closedFrom, closedTo);
  const normalizedReservations = reservations
    .map((reservation) => normalizeInterval(reservation.startTime, reservation.endTime))
    .filter((reservation): reservation is { startTime: string; endTime: string } => reservation !== null);
  const normalizedBlockings = blockings
    .map((blocking) => normalizeInterval(blocking.startTime, blocking.endTime))
    .filter((blocking): blocking is { startTime: string; endTime: string } => blocking !== null);
  const slots = [];

  for (let minutes = 0; minutes < 24 * 60; minutes += 60) {
    const startTime = minutesToTime(minutes);
    const endTime = minutes === 23 * 60 ? '24:00' : minutesToTime(minutes + 60);

    const status = overlapsClosedHours(
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
