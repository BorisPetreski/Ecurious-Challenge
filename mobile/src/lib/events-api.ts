import { API_BASE_URL } from './reservation-api';
import type { MunichEvent } from './munich-events';

export interface EventFeed {
  configured: boolean;
  source: 'eventbrite';
  scope?: 'organization' | 'curated' | 'not_configured';
  events: MunichEvent[];
  reason: string | null;
  fetchedAt: string;
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 1_000): value is string => typeof value === 'string' && value.length <= max;
const timestamp = (value: unknown): value is string => text(value, 64) && Number.isFinite(Date.parse(value));
const categories = ['tech', 'sports', 'culture', 'concert'];

/** A malformed event must never turn into a marker at an invented location. */
export function parseEventFeed(value: unknown): EventFeed {
  if (!record(value) || typeof value.configured !== 'boolean' || value.source !== 'eventbrite' ||
    !Array.isArray(value.events) || value.events.length > 100 || !timestamp(value.fetchedAt) ||
    !(value.reason === null || value.reason === undefined || text(value.reason, 1_000)) ||
    (value.scope !== undefined && !['organization', 'curated', 'not_configured'].includes(String(value.scope))) ||
    (!value.configured && value.events.length > 0)) throw new Error('The event feed returned an invalid response.');

  const events = value.events.map((event): MunichEvent => {
    if (!record(event) || !text(event.id, 150) || !event.id || !text(event.title, 300) || !event.title ||
      !text(event.subtitle, 3_000) || !categories.includes(String(event.category)) || !text(event.emoji, 32) ||
      !text(event.venue, 500) || !text(event.address, 1_000) || !text(event.date, 200) || !text(event.expectedAttendance, 300) ||
      typeof event.latitude !== 'number' || !Number.isFinite(event.latitude) || Math.abs(event.latitude) > 90 ||
      typeof event.longitude !== 'number' || !Number.isFinite(event.longitude) || Math.abs(event.longitude) > 180 ||
      (event.latitude === 0 && event.longitude === 0) ||
      (event.startsAt !== undefined && !timestamp(event.startsAt))) throw new Error('The event feed returned an invalid event.');
    let url: string | undefined;
    if (text(event.url, 2_000)) {
      try {
        const candidate = new URL(event.url);
        if (candidate.protocol === 'https:' && !candidate.username && !candidate.password) url = candidate.href;
      } catch { /* The map can still use a valid event without an external link. */ }
    }
    return {
      id: event.id, title: event.title, subtitle: event.subtitle, category: event.category as MunichEvent['category'],
      emoji: event.emoji, venue: event.venue, address: event.address, latitude: event.latitude, longitude: event.longitude,
      date: event.date, expectedAttendance: event.expectedAttendance, source: 'eventbrite', url,
      ...(event.startsAt ? { startsAt: event.startsAt as string } : {}),
    };
  });
  return { configured: value.configured, source: 'eventbrite', events, reason: typeof value.reason === 'string' ? value.reason : null,
    fetchedAt: value.fetchedAt, ...(value.scope ? { scope: value.scope as EventFeed['scope'] } : {}) };
}

export async function fetchEvents(signal?: AbortSignal): Promise<EventFeed> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 20_000);
  try {
    const response = await fetch(`${API_BASE_URL}/api/events`, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new Error('The event service is unavailable. Refresh to try again.');
    if (Number(response.headers.get('content-length')) > 500_000) throw new Error('The event feed was too large.');
    const body = await response.text();
    if (body.length > 500_000) throw new Error('The event feed was too large.');
    let value: unknown;
    try { value = JSON.parse(body); } catch { throw new Error('The event service returned an unreadable response.'); }
    return parseEventFeed(value);
  } catch (error) {
    if (timedOut) throw new Error('The event request timed out. Check the connection and refresh.');
    if (controller.signal.aborted) throw error;
    throw error instanceof Error && error.message !== 'Network request failed' ? error : new Error('Could not load events. Keep the phone and API on the same network.');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
