export const HARDWARE_TIME_ZONE = 'Europe/Berlin';
export interface BerlinTimeFields { date: string; time: string }
export interface BerlinTimeChoice { iso: string; offset: string }

const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: HARDWARE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function berlinTimeFields(instant: string | number): BerlinTimeFields {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Return both possible UTC instants during the repeated autumn hour. */
export function berlinTimeChoices(date: string, time: string): BerlinTimeChoice[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return [];
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (year < 2020 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return [];
  const wallTime = Date.UTC(year, month - 1, day, hour, minute);
  return [120, 60].flatMap(offset => {
    const candidate = wallTime - offset * 60_000;
    const fields = berlinTimeFields(candidate);
    return fields.date === date && fields.time === time ? [{ iso: new Date(candidate).toISOString(), offset: `UTC+${String(offset / 60).padStart(2, '0')}:00` }] : [];
  });
}

export function validateHardwareWindow(startsAt: string, endsAt: string, now: number): string | null {
  const start = Date.parse(startsAt), end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Enter valid start and end dates and times.';
  const minutes = (end - start) / 60_000;
  if (minutes < 5 || minutes > 120) return 'Choose a window between 5 minutes and 2 hours.';
  if (start < now - 60_000) return 'The start time has passed. Choose Now or a future time.';
  if (start > now + 7 * 24 * 60 * 60_000) return 'Choose a start within the next 7 days.';
  return null;
}

export function formatHardwareInstant(instant: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: HARDWARE_TIME_ZONE, year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset' }).format(new Date(instant));
}
