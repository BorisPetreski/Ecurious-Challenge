import test from 'node:test';
import assert from 'node:assert/strict';
import { EcuriousAdapter, EcuriousApiError, ECURIOUS_BASE_URL, TELEMETRY_FRESHNESS_MS } from '../lib/ecurious-adapter.mjs';

const KEY = 'fictional_adapter_test_key';
const PLATE = 'M-DEMO-42';
const NOW = Date.parse('2026-10-24T10:00:00.000Z');
const clock = () => NOW;
const jsonResponse = (value, options = {}) => new Response(JSON.stringify(value), {
  ...options,
  headers: { 'content-type': 'application/json', ...options.headers },
});
const lock = (overrides = {}) => ({
  id: 'lock-demo-1', name: 'Fictional test bay', hasCamera: true,
  status: 'raised', carPresence: 'vacant', lastSeenAt: new Date(NOW - 1_000).toISOString(),
  ...overrides,
});
const reader = (value, options = {}) => new EcuriousAdapter({
  apiKey: KEY, clock, fetchImpl: async () => jsonResponse(value), ...options,
});
const rejectsWith = async (operation, code, forbidden = []) => {
  await assert.rejects(operation, error => {
    assert.ok(error instanceof EcuriousApiError);
    assert.equal(error.code, code);
    for (const value of forbidden) assert.ok(!`${error.message}${JSON.stringify(error)}`.includes(value));
    return true;
  });
};

test('authenticated reads use only the expected HTTPS GET route, header auth, and no redirects', async () => {
  const requests = [];
  const adapter = new EcuriousAdapter({
    apiKey: ` ${KEY} `, clock,
    fetchImpl: async (input, options) => {
      const url = new URL(input);
      assert.equal(url.origin, ECURIOUS_BASE_URL);
      assert.equal(url.search, '');
      assert.ok(!input.includes(KEY));
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers['X-API-Key'], KEY);
      assert.equal(options.headers.Accept, 'application/json');
      assert.ok(options.signal instanceof AbortSignal);
      requests.push(url.pathname);
      if (url.pathname === '/api/v1/locks') return jsonResponse({ team: 'Fictional team', locks: [lock()] });
      if (url.pathname.endsWith('/plate/latest')) {
        return jsonResponse({ lockId: 'lock-demo-1', timestamp: new Date(NOW - 1_000).toISOString(), licensePlate: PLATE });
      }
      return jsonResponse({ lock: lock() });
    },
  });

  assert.equal((await adapter.listLocks()).access, 'read-only');
  assert.equal((await adapter.getStatus('lock-demo-1')).id, 'lock-demo-1');
  const plate = await adapter.getLatestPlate('lock-demo-1');
  assert.deepEqual(plate, { lockId: 'lock-demo-1', timestamp: new Date(NOW - 1_000).toISOString(), detected: true });
  assert.deepEqual(requests, ['/api/v1/locks', '/api/v1/locks/lock-demo-1', '/api/v1/locks/lock-demo-1/plate/latest']);
});

test('projection retains diagnostic facts while removing raw plates, captures, unknown fields, and credential echoes', async () => {
  const observationAt = new Date(NOW - 5_000).toISOString();
  const upstream = {
    team: `Fictional team ${KEY}\n`, apiKey: KEY, cameraCapture: 'fictional-capture-payload',
    locks: [lock({
      name: `Test bay ${KEY}\n`, serialHex: 'internal-serial-not-needed',
      whitelist: [PLATE], licensePlate: PLATE, apiKey: KEY,
      latestPhoto: { licensePlate: PLATE, timestamp: observationAt, image: 'fictional-capture-payload', url: 'https://example.invalid/private-capture' },
      activeErrors: ['MOTOR_LOWERING_STALL', 'untrusted provider text'],
      battery12V: 12.5, battery3_7V: NaN, signalStrength4G: '28', waterIngress: false,
    })],
  };
  const result = await reader(upstream).listLocks();
  const serialized = JSON.stringify(result);
  for (const privateValue of [KEY, PLATE, 'fictional-capture-payload', 'private-capture', 'internal-serial-not-needed']) {
    assert.ok(!serialized.includes(privateValue), `Diagnostic response leaked ${privateValue}`);
  }
  assert.equal(result.team, 'Fictional team [REDACTED]');
  assert.equal(result.locks[0].name, 'Test bay [REDACTED]');
  assert.deepEqual(result.locks[0].whitelist, { mode: 'specific-plates', count: 1 });
  assert.deepEqual(result.locks[0].plateObservation, { detected: true, timestamp: observationAt });
  assert.deepEqual(result.locks[0].activeErrors, ['MOTOR_LOWERING_STALL', 'UNKNOWN_ERROR']);
  assert.equal(result.locks[0].battery12V, 12.5);
  assert.equal(result.locks[0].battery3_7V, null);
  assert.equal(result.locks[0].signalStrength4G, null);
});

test('freshness distinguishes offline, stale, future, unknown, and current sensor state', async t => {
  const cases = [
    { name: 'offline despite recent timestamp', value: { status: 'offline' }, fresh: false, barrier: 'unknown', occupancy: 'unknown' },
    { name: 'recent telemetry', value: {}, fresh: true, barrier: 'raised', occupancy: 'vacant' },
    { name: 'boundary telemetry', value: { lastSeenAt: new Date(NOW - TELEMETRY_FRESHNESS_MS).toISOString() }, fresh: true, barrier: 'raised', occupancy: 'vacant' },
    { name: 'stale telemetry', value: { lastSeenAt: new Date(NOW - TELEMETRY_FRESHNESS_MS - 1).toISOString() }, fresh: false, barrier: 'unknown', occupancy: 'unknown' },
    { name: 'future timestamp', value: { lastSeenAt: new Date(NOW + 1).toISOString() }, fresh: false, barrier: 'unknown', occupancy: 'unknown' },
    { name: 'missing timestamp', value: { lastSeenAt: undefined }, fresh: false, barrier: 'unknown', occupancy: 'unknown' },
    { name: 'unreadable timestamp', value: { lastSeenAt: 'unknown' }, fresh: false, barrier: 'unknown', occupancy: 'unknown' },
    { name: 'unknown status', value: { status: 'unexpected' }, fresh: false, barrier: 'unknown', occupancy: 'unknown' },
    { name: 'moving barrier', value: { status: 'lowering', carPresence: 'occupied' }, fresh: true, barrier: 'unknown', occupancy: 'occupied' },
    { name: 'missing occupancy is not vacancy', value: { carPresence: undefined }, fresh: true, barrier: 'raised', occupancy: 'unknown' },
  ];
  for (const item of cases) await t.test(item.name, async () => {
    const result = await reader({ lock: lock(item.value) }).getStatus('lock-demo-1');
    assert.equal(result.telemetryFresh, item.fresh);
    assert.equal(result.barrier, item.barrier);
    assert.equal(result.occupancy, item.occupancy);
    assert.equal(result.lastReportedPresence, item.value.carPresence === undefined && Object.hasOwn(item.value, 'carPresence')
      ? 'unknown' : item.value.carPresence ?? 'vacant');
  });
});

test('whitelist projection identifies wildcard, disabled and unknown without exposing entries', async () => {
  for (const [value, mode, count] of [[['*'], 'any-plate', 1], [[], 'disabled', 0], [undefined, 'unknown', null], [[42], 'unknown', null]]) {
    const result = await reader({ lock: lock({ whitelist: value }) }).getStatus('lock-demo-1');
    assert.deepEqual(result.whitelist, { mode, count });
  }
});

test('missing credential performs no network request and preserves diagnostics configuration state', async () => {
  let requests = 0;
  const adapter = new EcuriousAdapter({ apiKey: '   ', clock, fetchImpl: () => { requests++; throw new Error('No request expected'); } });
  assert.deepEqual(await adapter.listLocks(), {
    source: 'ecurious', access: 'read-only', configured: false,
    fetchedAt: new Date(NOW).toISOString(), team: null, locks: [], freshnessLimitMs: TELEMETRY_FRESHNESS_MS,
  });
  await rejectsWith(() => adapter.getStatus('lock-demo-1'), 'ECURIOUS_NOT_CONFIGURED');
  await rejectsWith(() => adapter.getLatestPlate('lock-demo-1'), 'ECURIOUS_NOT_CONFIGURED');
  assert.equal(requests, 0);
});

test('invalid configuration and lock IDs refuse before network access', async () => {
  let requests = 0;
  const fetchImpl = () => { requests++; throw new Error('No request expected'); };
  for (const baseUrl of ['http://example.invalid', `https://example.invalid/?apiKey=${KEY}`, `https://${KEY}@example.invalid`, 'https://example.invalid/api/v1', 'not a URL']) {
    assert.throws(() => new EcuriousAdapter({ apiKey: KEY, baseUrl, fetchImpl }), error => {
      assert.equal(error.code, 'ECURIOUS_CONFIGURATION');
      assert.ok(!error.message.includes(KEY));
      return true;
    });
  }
  const adapter = new EcuriousAdapter({ apiKey: KEY, fetchImpl });
  for (const id of ['', '../locks', `lock?apiKey=${KEY}`, 'lock/other', null]) {
    await rejectsWith(() => adapter.getStatus(id), 'ECURIOUS_LOCK_ID', [KEY]);
    await rejectsWith(() => adapter.getLatestPlate(id), 'ECURIOUS_LOCK_ID', [KEY]);
  }
  assert.equal(requests, 0);
});

test('authentication and HTTP failures do not propagate provider bodies', async () => {
  for (const [status, code] of [[401, 'ECURIOUS_AUTH'], [403, 'ECURIOUS_AUTH'], [404, 'ECURIOUS_NOT_FOUND'], [500, 'ECURIOUS_HTTP']]) {
    const adapter = reader(null, { fetchImpl: async () => jsonResponse({ error: `${KEY} ${PLATE}` }, { status }) });
    await rejectsWith(() => adapter.listLocks(), code, [KEY, PLATE]);
  }
});

test('network and redirect failures have fixed sanitized messages', async () => {
  const adapter = reader(null, { fetchImpl: async () => { throw new Error(`redirect or network error: ${KEY} ${PLATE}`); } });
  await rejectsWith(() => adapter.listLocks(), 'ECURIOUS_CONNECTION', [KEY, PLATE]);
});

test('malformed JSON, unsupported content, and malformed records fail closed', async () => {
  const responses = [
    () => new Response(`{"private":"${KEY} ${PLATE}"`, { headers: { 'content-type': 'application/json' } }),
    () => new Response(`${KEY} ${PLATE}`, { headers: { 'content-type': 'text/html' } }),
    () => jsonResponse([]),
    () => jsonResponse({ locks: [null] }),
    () => jsonResponse({ locks: [lock({ id: '../private' })] }),
    () => jsonResponse({ locks: Array.from({ length: 101 }, () => lock()) }),
  ];
  for (const response of responses) {
    await rejectsWith(() => reader(null, { fetchImpl: async () => response() }).listLocks(), 'ECURIOUS_RESPONSE', [KEY, PLATE]);
  }
});

test('latest-plate reads reject a malformed observation instead of claiming no recognition', async () => {
  const timestamp = new Date(NOW - 1_000).toISOString();
  for (const value of [
    {},
    { lockId: 'different-lock', timestamp, licensePlate: PLATE },
    { lockId: 'lock-demo-1', timestamp: 'unreadable', licensePlate: PLATE },
    { lockId: 'lock-demo-1', timestamp },
  ]) {
    await rejectsWith(() => reader(value).getLatestPlate('lock-demo-1'), 'ECURIOUS_RESPONSE', [KEY, PLATE]);
  }
  assert.equal((await reader({ lockId: 'lock-demo-1', timestamp, licensePlate: '' }).getLatestPlate('lock-demo-1')).detected, false);
});

test('single-lock reads reject telemetry for a different lock', async () => {
  await rejectsWith(() => reader({ lock: lock({ id: 'different-lock' }) }).getStatus('lock-demo-1'), 'ECURIOUS_RESPONSE');
});

test('request timeout aborts the read and reports no command was sent', async () => {
  let aborted = false;
  const adapter = reader(null, {
    timeoutMs: 20,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new Error(`${KEY} ${PLATE}`)); }, { once: true });
    }),
  });
  await assert.rejects(() => adapter.listLocks(), error => {
    assert.equal(error.code, 'ECURIOUS_TIMEOUT');
    assert.equal(error.status, 504);
    assert.match(error.message, /No hardware command was sent/);
    assert.ok(!error.message.includes(KEY));
    assert.ok(!error.message.includes(PLATE));
    return true;
  });
  assert.equal(aborted, true);
});

test('response size limit stops oversized reads without exposing the body', async () => {
  let signal;
  const adapter = reader(null, { fetchImpl: async (_url, options) => {
    signal = options.signal;
    return jsonResponse({ unexpected: 'x'.repeat(1024 * 1024), apiKey: KEY, licensePlate: PLATE });
  } });
  await rejectsWith(() => adapter.listLocks(), 'ECURIOUS_RESPONSE', [KEY, PLATE]);
  assert.equal(signal.aborted, true);
});

test('hardware write methods refuse without sending a request', async () => {
  let requests = 0;
  const adapter = reader(null, { fetchImpl: () => { requests++; throw new Error('No request expected'); } });
  await assert.rejects(() => adapter.reserve(), /not implemented/);
  await assert.rejects(() => adapter.release(), /not implemented/);
  assert.equal(requests, 0);
});
