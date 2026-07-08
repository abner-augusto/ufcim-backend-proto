/**
 * Campus-local clock. The campus is in Fortaleza (America/Fortaleza, UTC-3,
 * no DST) while Workers run in UTC — date/hour comparisons for "today" must
 * use campus time, or they drift by 3 hours (and by a whole day between
 * 21:00 and 24:00 local).
 */
const CAMPUS_TIME_ZONE = 'America/Fortaleza';

function campusParts(now: Date): { date: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAMPUS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Today's date in campus time, as "YYYY-MM-DD". */
export function campusToday(now = new Date()): string {
  return campusParts(now).date;
}

/** Minutes since campus-local midnight. */
export function campusNowMinutes(now = new Date()): number {
  return campusParts(now).minutes;
}