import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { EventbriteEvents, normalizeEventbriteEvent } from '../lib/eventbrite-events.mjs';
import { createServer } from '../server.mjs';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const env = { EVENTBRITE_PRIVATE_TOKEN: 'fictional-private-token', EVENTBRITE_ORGANIZATION_ID: '123' };
const event = (overrides = {}) => ({
  id: '456', listed: true, status: 'live', online_event: false,
  name: { text: 'Fictional mobility meetup' }, summary: 'A test fixture, not a real event.',
  start: { utc: '2026-10-24T14:00:00Z' }, end: { utc: '2026-10-24T16:00:00Z' },
  url: 'https://www.eventbrite.de/e/fictional-fixture-456', category_id: '102',
  venue: { name: 'Fictional Munich venue', latitude: '48.15', longitude: '11.57', address: { localized_address_display: 'Fictional test address, Munich' } },
  ...overrides,
});

test('normalization accepts real coordinates/times and never invents attendance or venue capacity', () => {
  const normalized = normalizeEventbriteEvent(event(), NOW);
  assert.equal(normalized.id, 'eventbrite-456');
  assert.equal(normalized.source, 'eventbrite');
  assert.equal(normalized.category, 'tech');
  assert.equal(normalized.latitude, 48.15);
  assert.equal(normalized.expectedAttendance, 'Not provided');
  assert.equal(normalized.startsAt, '2026-10-24T14:00:00.000Z');
  assert.match(normalized.date, /16:00/); // Europe/Berlin on this date.
});

test('normalization excludes private, online, cancelled, ended and unlocated/out-of-area events', () => {
  for (const value of [
    event({ listed: false }), event({ listed: undefined }), event({ online_event: true }),
    event({ status: 'canceled' }), event({ status: 'draft' }),
    event({ end: { utc: '2026-10-24T11:00:00Z' } }),
    event({ start: { utc: 'not-a-date' } }), event({ venue: {} }),
    event({ venue: { latitude: '', longitude: '' } }),
    event({ venue: { latitude: 0, longitude: 0 } }),
    event({ venue: { latitude: 52.52, longitude: 13.4 } }),
    event({ url: 'https://eventbrite.de.attacker.example/event' }),
  ]) assert.equal(normalizeEventbriteEvent(value, NOW), null);
});

test('unconfigured feed does not call a provider or substitute fictional events', async () => {
  const feed = new EventbriteEvents({ env: {}, clock: () => NOW, fetchImpl: () => assert.fail('No token means no request') });
  const result = await feed.listEvents();
  assert.equal(result.configured, false);
  assert.equal(result.scope, 'not_configured');
  assert.deepEqual(result.events, []);
  assert.match(result.reason, /EVENTBRITE_PRIVATE_TOKEN/);
});

test('organization feed uses private bearer GET, venue expansion, cached coalescing and narrow projection', async () => {
  let calls = 0;
  const feed = new EventbriteEvents({ env, clock: () => NOW, fetchImpl: async (input, options) => {
    calls++;
    const url = new URL(input);
    assert.equal(url.origin, 'https://www.eventbriteapi.com');
    assert.equal(url.pathname, '/v3/organizations/123/events/');
    assert.equal(url.searchParams.get('expand'), 'venue');
    assert.equal(url.searchParams.get('time_filter'), 'current_future');
    assert.ok(!url.href.includes(env.EVENTBRITE_PRIVATE_TOKEN));
    assert.equal(options.headers.Authorization, `Bearer ${env.EVENTBRITE_PRIVATE_TOKEN}`);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    return Response.json({ events: [event(), event({ id: '789', listed: false })], pagination: { page_count: 1 }, secret: 'not part of public result' });
  } });
  const [a, b] = await Promise.all([feed.listEvents(), feed.listEvents()]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  assert.equal(a.events.length, 1);
  assert.equal(a.reason, null);
  assert.ok(!JSON.stringify(a).includes(env.EVENTBRITE_PRIVATE_TOKEN));
  assert.ok(!JSON.stringify(a).includes('not part of public result'));
  a.events.length = 0;
  assert.equal((await feed.listEvents()).events.length, 1);
  assert.equal(calls, 1);
});

test('a single organization is discovered but multiple organizations require explicit selection', async () => {
  for (const count of [1, 2]) {
    const paths = [];
    const feed = new EventbriteEvents({ env: { EVENTBRITE_TOKEN: 'fictional-token' }, clock: () => NOW,
      fetchImpl: async input => {
        const path = new URL(input).pathname;
        paths.push(path);
        return Response.json(path.includes('/users/')
          ? { organizations: Array.from({ length: count }, (_, index) => ({ id: String(index + 1) })), pagination: { page_count: 1 } }
          : { events: [event()], pagination: { page_count: 1 } });
      } });
    const result = await feed.listEvents();
    assert.equal(result.events.length, count === 1 ? 1 : 0);
    assert.equal(paths.length, count === 1 ? 2 : 1);
    if (count === 2) assert.match(result.reason, /EVENTBRITE_ORGANIZATION_ID/);
  }
});

test('curated event IDs skip organization discovery and never use retired search', async () => {
  const paths = [];
  const feed = new EventbriteEvents({ env: { ...env, EVENTBRITE_EVENT_IDS: '456,456,789' }, clock: () => NOW,
    fetchImpl: async input => {
      const url = new URL(input);
      paths.push(url.pathname);
      return Response.json(event({ id: url.pathname.split('/')[3] }));
    } });
  const result = await feed.listEvents();
  assert.equal(result.scope, 'curated');
  assert.equal(result.events.length, 2);
  assert.deepEqual(paths.sort(), ['/v3/events/456/', '/v3/events/789/']);
});

test('provider failures, oversize responses and timeouts are sanitized and bounded', async () => {
  for (const fetchImpl of [
    async () => new Response('fictional-private-token and private provider body', { status: 401 }),
    async () => Response.json({ events: [], private: 'x'.repeat(1024 * 1024) }),
    async () => { throw new Error('fictional-private-token and private socket diagnostic'); },
    async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('private abort details')), { once: true })),
  ]) {
    const feed = new EventbriteEvents({ env, fetchImpl, timeoutMs: 10, clock: () => NOW });
    const result = await feed.listEvents();
    assert.deepEqual(result.events, []);
    assert.equal(result.configured, true);
    assert.ok(result.reason);
    assert.ok(!JSON.stringify(result).includes(env.EVENTBRITE_PRIVATE_TOKEN));
    assert.ok(!JSON.stringify(result).includes('private provider'));
    assert.ok(!JSON.stringify(result).includes('private socket'));
  }
});

test('GET /api/events exposes only the feed and rejects writes without changing simulator state', async t => {
  const events = new EventbriteEvents({ env, clock: () => NOW, fetchImpl: async () => Response.json({ events: [event()] }) });
  const server = createServer({ events });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/api/events`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).events.length, 1);
  const rejected = await fetch(`${base}/api/events`, { method: 'POST' });
  assert.equal(rejected.status, 405);
  assert.equal(rejected.headers.get('allow'), 'GET');
  assert.equal((await (await fetch(`${base}/api/state`)).json()).reservation, null);
});
