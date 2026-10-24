import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../mobile/package.json', import.meta.url));
const ts = require('typescript');
const source = (await readFile(new URL('../mobile/src/lib/events-api.ts', import.meta.url), 'utf8'))
  .replace("import { API_BASE_URL } from './reservation-api';", "const API_BASE_URL = 'http://bayready.test:3000';");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { parseEventFeed, fetchEvents } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const event = () => ({ id: 'fictional-event', title: 'Fictional mobility event', subtitle: 'Test fixture', category: 'tech', emoji: '⚡',
  venue: 'Fictional Munich venue', address: 'Fictional address', latitude: 48.15, longitude: 11.57, date: '24 Oct 2026 · 18:00',
  expectedAttendance: 'Not provided', source: 'eventbrite', url: 'https://www.eventbrite.com/e/fictional-fixture', startsAt: '2026-10-24T16:00:00Z' });
const feed = () => ({ configured: true, source: 'eventbrite', scope: 'organization', events: [event()], reason: null, fetchedAt: '2026-10-24T12:00:00Z' });

test('mobile accepts real-source event fields without inventing venue coordinates or attendance', () => {
  const parsed = parseEventFeed(feed());
  assert.equal(parsed.events[0].source, 'eventbrite');
  assert.equal(parsed.events[0].latitude, 48.15);
  assert.equal(parsed.events[0].expectedAttendance, 'Not provided');
  assert.equal(parsed.events[0].url, event().url);
  const unsafeLink = feed();
  unsafeLink.events[0].url = 'javascript:alert(1)';
  assert.equal(parseEventFeed(unsafeLink).events[0].url, undefined);
});

test('empty configured feeds and unconfigured feeds remain different instead of supplying mock events', () => {
  const configured = parseEventFeed({ ...feed(), events: [], reason: 'No eligible events.' });
  assert.equal(configured.configured, true);
  assert.deepEqual(configured.events, []);
  const unconfigured = parseEventFeed({ ...feed(), configured: false, scope: 'not_configured', events: [], reason: 'Configure a token.' });
  assert.equal(unconfigured.configured, false);
  assert.deepEqual(unconfigured.events, []);
  assert.throws(() => parseEventFeed({ ...feed(), configured: false }), /invalid response/);
});

test('malformed venue, source and timestamp payloads are rejected before creating map markers', () => {
  for (const latitude of [NaN, 91, '48.15', undefined]) {
    const malformed = feed();
    malformed.events[0].latitude = latitude;
    assert.throws(() => parseEventFeed(malformed), /invalid event/);
  }
  const zero = feed();
  Object.assign(zero.events[0], { latitude: 0, longitude: 0 });
  assert.throws(() => parseEventFeed(zero), /invalid event/);
  assert.throws(() => parseEventFeed({ ...feed(), source: 'demo' }), /invalid response/);
  assert.throws(() => parseEventFeed({ ...feed(), fetchedAt: 'yesterday' }), /invalid response/);
  assert.throws(() => parseEventFeed({ ...feed(), events: Array.from({ length: 101 }, event) }), /invalid response/);
});

test('mobile event reads use the existing Node origin and return sanitized HTTP errors', async () => {
  const originalFetch = globalThis.fetch;
  try {
    let call;
    globalThis.fetch = async (url, options) => { call = { url, options }; return Response.json(feed()); };
    assert.equal((await fetchEvents()).events.length, 1);
    assert.equal(call.url, 'http://bayready.test:3000/api/events');
    assert.equal(call.options.headers.Accept, 'application/json');
    assert.ok(call.options.signal instanceof AbortSignal);
    globalThis.fetch = async () => new Response('private upstream details', { status: 502 });
    await assert.rejects(fetchEvents(), error => error.message === 'The event service is unavailable. Refresh to try again.');
  } finally { globalThis.fetch = originalFetch; }
});
