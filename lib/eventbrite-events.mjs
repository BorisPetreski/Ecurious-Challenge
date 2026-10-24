/** Read-only Eventbrite feed. Public event search was retired by Eventbrite.
 * Use a creator organization or explicit event IDs; the token stays on Node.
 * Official reference: https://www.eventbrite.com/platform/new/api
 */
const API = 'https://www.eventbriteapi.com/v3';
const ID = /^\d{1,30}$/;
const MAX_BYTES = 1024 * 1024;
const MUNICH = { latitude: 48.1488, longitude: 11.568 };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function cleanText(value, limit = 180) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) : '';
}

function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function coordinate(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function distanceKm(latitude, longitude) {
  const rad = value => value * Math.PI / 180;
  const a = Math.sin(rad(latitude - MUNICH.latitude) / 2) ** 2 +
    Math.cos(rad(latitude)) * Math.cos(rad(MUNICH.latitude)) * Math.sin(rad(longitude - MUNICH.longitude) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function eventUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      /(^|\.)eventbrite\.(com|de|co\.uk|ie|fr|es|it|nl|com\.au|ca|at|ch|be|pt)$/.test(url.hostname)
      ? url.href : null;
  } catch { return null; }
}

export function normalizeEventbriteEvent(event, now = Date.now()) {
  if (!record(event) || !ID.test(String(event.id ?? '')) || event.listed !== true ||
    !['live', 'started'].includes(event.status) || event.online_event === true) return null;
  const starts = instant(event.start?.utc);
  const ends = instant(event.end?.utc);
  if (starts === null || ends === null || ends <= now || ends <= starts) return null;
  const venue = record(event.venue) ? event.venue : {};
  const address = record(venue.address) ? venue.address : {};
  const latitude = coordinate(venue.latitude ?? address.latitude);
  const longitude = coordinate(venue.longitude ?? address.longitude);
  if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 ||
    distanceKm(latitude, longitude) > 50) return null;
  const title = cleanText(event.name?.text, 140);
  const url = eventUrl(event.url);
  if (!title || !url) return null;
  const category = ({ '102': 'tech', '108': 'sports', '103': 'concert' })[String(event.category_id)] ?? 'culture';
  return {
    id: `eventbrite-${event.id}`,
    title,
    subtitle: cleanText(event.summary) || 'Eventbrite event · public listing',
    category,
    emoji: ({ tech: '⚡', sports: '⚽', concert: '🎵', culture: '🎟️' })[category],
    venue: cleanText(venue.name, 120) || 'Event venue',
    address: cleanText(address.localized_address_display, 240) ||
      [address.address_1, address.postal_code, address.city].map(value => cleanText(value, 120)).filter(Boolean).join(', ') || 'Address not provided',
    latitude,
    longitude,
    date: new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(starts)),
    expectedAttendance: 'Not provided',
    url,
    startsAt: new Date(starts).toISOString(),
    source: 'eventbrite',
  };
}

class FeedError extends Error {}

export class EventbriteEvents {
  #token;
  #organizationId;
  #eventIds;
  #fetch;
  #clock;
  #timeoutMs;
  #cacheMs;
  #cached = null;
  #pending = null;

  constructor({ env = process.env, fetchImpl = globalThis.fetch, clock = Date.now, timeoutMs = 6_000, cacheMs = 60_000 } = {}) {
    this.#token = (env.EVENTBRITE_PRIVATE_TOKEN || env.EVENTBRITE_TOKEN || '').trim();
    this.#organizationId = (env.EVENTBRITE_ORGANIZATION_ID || '').trim();
    this.#eventIds = [...new Set((env.EVENTBRITE_EVENT_IDS || '').split(',').map(value => value.trim()).filter(Boolean))];
    this.#fetch = fetchImpl;
    this.#clock = clock;
    this.#timeoutMs = timeoutMs;
    this.#cacheMs = cacheMs;
  }

  get configured() { return this.#token.length > 0; }

  async #request(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(`${API}${path}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.#token}`, Accept: 'application/json' },
        redirect: 'error', signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403].includes(response.status)) throw new FeedError('Eventbrite rejected the private token or access to these events.');
        if (response.status === 429) throw new FeedError('Eventbrite rate limit reached. Try again shortly.');
        if (response.status === 404) throw new FeedError('The configured Eventbrite organization or event was not found.');
        throw new FeedError('Eventbrite could not supply events. Try again shortly.');
      }
      if (!response.headers.get('content-type')?.includes('application/json')) {
        await response.body?.cancel();
        throw new FeedError('Eventbrite returned an unsupported event response.');
      }
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body ?? []) {
        bytes += chunk.byteLength;
        if (bytes > MAX_BYTES) {
          controller.abort();
          throw new FeedError('The Eventbrite response exceeded the event feed size limit.');
        }
        chunks.push(chunk);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!record(data)) throw new FeedError('Eventbrite returned an unsupported event response.');
      return data;
    } catch (error) {
      if (error instanceof FeedError) throw error;
      throw new FeedError(controller.signal.aborted
        ? 'Eventbrite did not respond in time. Try again shortly.'
        : 'The Eventbrite feed could not be read. Check the server connection and configuration.');
    } finally { clearTimeout(timer); }
  }

  async #load() {
    const base = { configured: this.configured, source: 'eventbrite', events: [], reason: null,
      fetchedAt: new Date(this.#clock()).toISOString(), scope: this.#eventIds.length ? 'curated' : 'organization' };
    if (!this.configured) return { ...base, scope: 'not_configured', reason: 'Add EVENTBRITE_PRIVATE_TOKEN to the backend .env and restart the server. Live events use your organization or curated event IDs; public city search is unavailable.' };
    try {
      if (/[\r\n]/.test(this.#token) || (this.#organizationId && !ID.test(this.#organizationId)) ||
        this.#eventIds.length > 10 || this.#eventIds.some(id => !ID.test(id))) {
        throw new FeedError('Check the Eventbrite token, numeric organization ID and up to ten comma-separated event IDs in backend configuration.');
      }
      let rawEvents = [];
      let truncated = false;
      if (this.#eventIds.length) {
        const results = await Promise.all(this.#eventIds.map(id => this.#request(`/events/${id}/?expand=venue`)));
        rawEvents = results;
      } else {
        let organizationId = this.#organizationId;
        if (!organizationId) {
          const data = await this.#request('/users/me/organizations/');
          const organizations = Array.isArray(data.organizations) ? data.organizations : [];
          if (organizations.length !== 1 || data.pagination?.has_more_items === true || Number(data.pagination?.page_count ?? 1) > 1) {
            throw new FeedError(organizations.length === 0
              ? 'No Eventbrite organization is available. Configure EVENTBRITE_EVENT_IDS for public events you want to show.'
              : 'Choose EVENTBRITE_ORGANIZATION_ID in backend configuration, or use curated EVENTBRITE_EVENT_IDS.');
          }
          organizationId = String(organizations[0]?.id ?? '');
          if (!ID.test(organizationId)) throw new FeedError('Eventbrite returned an unsupported organization response.');
        }
        for (let page = 1; page <= 2; page++) {
          const data = await this.#request(`/organizations/${organizationId}/events/?time_filter=current_future&expand=venue&page=${page}`);
          if (!Array.isArray(data.events)) throw new FeedError('Eventbrite returned an unsupported event list.');
          rawEvents.push(...data.events);
          const more = data.pagination?.has_more_items === true || Number(data.pagination?.page_count ?? 1) > page;
          if (!more) break;
          if (page === 2) truncated = true;
        }
      }
      const unique = new Map();
      for (const raw of rawEvents) {
        const event = normalizeEventbriteEvent(raw, this.#clock());
        if (event) unique.set(event.id, event);
      }
      const events = [...unique.values()].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)).slice(0, 50);
      return { ...base, events, reason: events.length === 0
        ? 'No published, current or upcoming in-person events with venue coordinates within 50 km of Munich were found in this source.'
        : truncated ? 'Showing a bounded selection from the configured Eventbrite organization.' : null };
    } catch (error) {
      return { ...base, reason: error instanceof FeedError ? error.message : 'The Eventbrite event feed is unavailable.' };
    }
  }

  async listEvents() {
    const now = this.#clock();
    if (this.#cached && now - this.#cached.at < this.#cacheMs && now >= this.#cached.at) return structuredClone(this.#cached.feed);
    if (!this.#pending) {
      this.#pending = this.#load().then(feed => {
        this.#cached = { at: this.#clock(), feed };
        return feed;
      }).finally(() => { this.#pending = null; });
    }
    return structuredClone(await this.#pending);
  }
}
