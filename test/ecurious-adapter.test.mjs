import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { EcuriousAdapter, EcuriousApiError, ECURIOUS_BASE_URL, TELEMETRY_FRESHNESS_MS } from '../lib/ecurious-adapter.mjs';

const KEY = 'fictional_adapter_test_key';
const PLATE = 'M-DEMO-42';
const NOW = Date.parse('2026-10-24T10:00:00.000Z');
const clock = () => NOW;
const NORMALIZED_PLATE = 'MDEMO42';
const TEST_COMPARISON_SECRET = 'fictional_private_plate_comparison_secret';
const plateFingerprint = plate => createHmac('sha256', TEST_COMPARISON_SECRET).update(plate.normalize('NFKC').toUpperCase().replace(/[ -]/g, '')).digest('hex');
const EXPECTED_FINGERPRINT = plateFingerprint(NORMALIZED_PLATE);
const comparePlate = (observed, expected) => timingSafeEqual(Buffer.from(plateFingerprint(observed), 'hex'), Buffer.from(expected, 'hex'));
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

test('fault projection distinguishes an explicitly empty list from missing or malformed fault telemetry', async () => {
  for (const [activeErrors, known] of [[[], true], [undefined, false], [null, false], ['not-a-list', false]]) {
    const result = await reader({ lock: lock({ activeErrors }) }).getStatus('lock-demo-1');
    assert.equal(result.faultsKnown, known);
    assert.deepEqual(result.activeErrors, []);
  }
});

test('occupancy uses the documented string field and never guesses from boolean or raw numeric aliases', async () => {
  for (const fields of [
    { carPresence: true },
    { carPresence: undefined, carPresent: true },
    { carPresence: undefined, carPresenceRaw: 1 },
  ]) {
    const result = await reader({ lock: lock(fields) }).getStatus('lock-demo-1');
    assert.equal(result.occupancy, 'unknown');
    assert.equal(result.lastReportedPresence, 'unknown');
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

test('ambiguous booking reserve/release methods refuse without sending a request', async () => {
  let requests = 0;
  const adapter = reader(null, { fetchImpl: () => { requests++; throw new Error('No request expected'); } });
  await assert.rejects(() => adapter.reserve(), /not implemented/);
  await assert.rejects(() => adapter.release(), /not implemented/);
  assert.equal(requests, 0);
});

test('explicit barrier methods send one bounded authenticated POST and return only an unconfirmed acknowledgement', async () => {
  for (const [method, action, target] of [['raiseBarrier', 'lock', 'raised'], ['lowerBarrier', 'unlock', 'lowered']]) {
    const requests = [];
    const adapter = reader(null, { fetchImpl: async (input, options) => {
      const url = new URL(input);
      assert.equal(url.origin, ECURIOUS_BASE_URL);
      assert.equal(url.pathname, `/api/v1/locks/lock-demo-1/${action}`);
      assert.equal(url.search, '');
      assert.ok(!input.includes(KEY));
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers['X-API-Key'], KEY);
      assert.equal(options.headers['Content-Type'], 'application/json');
      assert.ok(options.signal instanceof AbortSignal);
      assert.deepEqual(JSON.parse(options.body), { cancelAutoLift: false });
      requests.push(input);
      return jsonResponse({
        success: true, message: `${KEY} ${PLATE}`,
        // This intentionally contradicts one target. An acknowledgement must
        // never become proof of physical position from its numeric status.
        result: { success: true, deviceStatus: 2, licensePlate: PLATE, apiKey: KEY, capture: 'fictional-private-capture' },
      });
    } });
    const result = await adapter[method]('lock-demo-1');
    assert.deepEqual(result, {
      lockId: 'lock-demo-1', requestedBarrier: target,
      acknowledged: true, confirmed: false, requestedAt: new Date(NOW).toISOString(),
    });
    for (const value of [KEY, PLATE, 'fictional-private-capture', 'deviceStatus']) assert.ok(!JSON.stringify(result).includes(value));
    assert.equal(requests.length, 1);
  }
});

test('barrier methods validate IDs and missing credentials without a network request', async () => {
  let requests = 0;
  const fetchImpl = () => { requests++; throw new Error('No request expected'); };
  const adapter = reader(null, { fetchImpl });
  const unconfigured = new EcuriousAdapter({ apiKey: '', clock, fetchImpl });
  for (const method of ['raiseBarrier', 'lowerBarrier']) {
    await rejectsWith(() => adapter[method](`../${KEY}`), 'ECURIOUS_LOCK_ID', [KEY]);
    await rejectsWith(() => unconfigured[method]('lock-demo-1'), 'ECURIOUS_NOT_CONFIGURED');
  }
  assert.equal(requests, 0);
});

test('command authentication and missing-route failures stay sanitized and are not retried', async () => {
  for (const [status, code] of [[401, 'ECURIOUS_AUTH'], [403, 'ECURIOUS_AUTH'], [404, 'ECURIOUS_NOT_FOUND']]) {
    let requests = 0;
    const adapter = reader(null, { fetchImpl: async () => {
      requests++;
      return jsonResponse({ error: `${KEY} ${PLATE}` }, { status });
    } });
    await rejectsWith(() => adapter.raiseBarrier('lock-demo-1'), code, [KEY, PLATE]);
    assert.equal(requests, 1);
  }
});

test('unacknowledged, malformed, oversized, network and server failures preserve uncertain command outcomes without retries', async t => {
  const cases = [
    { name: 'negative provider acknowledgement', response: () => jsonResponse({ success: false, result: { success: false }, message: `${KEY} ${PLATE}` }) },
    { name: 'missing acknowledgement result', response: () => jsonResponse({ success: true }) },
    { name: 'nested failure despite top-level success', response: () => jsonResponse({ success: true, result: { success: false } }) },
    { name: 'non-boolean success', response: () => jsonResponse({ success: 'true', result: { success: true } }) },
    { name: 'malformed response', response: () => new Response(`{"private":"${KEY} ${PLATE}"`, { headers: { 'content-type': 'application/json' } }) },
    { name: 'unsupported response', response: () => new Response(`${KEY} ${PLATE}`, { headers: { 'content-type': 'text/html' } }) },
    { name: 'oversized response', response: () => jsonResponse({ success: true, result: { success: true }, private: 'x'.repeat(1024 * 1024) }) },
    { name: 'server error', response: () => jsonResponse({ error: `${KEY} ${PLATE}` }, { status: 503 }) },
    { name: 'connection or redirect failure', response: () => { throw new Error(`private connection error ${KEY} ${PLATE}`); } },
  ];
  for (const item of cases) await t.test(item.name, async () => {
    let requests = 0;
    const adapter = reader(null, { fetchImpl: async () => { requests++; return item.response(); } });
    await assert.rejects(() => adapter.lowerBarrier('lock-demo-1'), error => {
      assert.ok(error instanceof EcuriousApiError);
      assert.equal(error.code, 'ECURIOUS_COMMAND_UNCERTAIN');
      assert.equal(error.uncertain, true);
      assert.equal(error.status, 502);
      assert.match(error.message, /Physical outcome is unknown/);
      assert.match(error.message, /Reconcile authenticated status/);
      assert.ok(!error.message.includes(KEY));
      assert.ok(!error.message.includes(PLATE));
      assert.ok(!error.message.includes('No hardware command was sent'));
      return true;
    });
    assert.equal(requests, 1);
  });
});

test('command timeout aborts once and explicitly preserves the possibility of an accepted movement', async () => {
  let requests = 0;
  let aborted = false;
  const adapter = reader(null, { timeoutMs: 20, fetchImpl: async (_url, { signal }) => {
    requests++;
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new Error(`${KEY} ${PLATE}`)); }, { once: true });
    });
  } });
  await assert.rejects(() => adapter.raiseBarrier('lock-demo-1'), error => {
    assert.equal(error.code, 'ECURIOUS_COMMAND_UNCERTAIN');
    assert.equal(error.status, 504);
    assert.equal(error.uncertain, true);
    assert.match(error.message, /may already have been accepted/);
    assert.ok(!error.message.includes('No hardware command was sent'));
    assert.ok(!error.message.includes(KEY));
    assert.ok(!error.message.includes(PLATE));
    return true;
  });
  assert.equal(requests, 1);
  assert.equal(aborted, true);
});

test('plate access methods replace the policy with one normalized plate or an empty list, acknowledging without exposing plates', async () => {
  for (const [method, requestedPlate, expectedAccess] of [['setPlateAccess', NORMALIZED_PLATE, 'specific-plates'], ['clearPlateAccess', undefined, 'disabled']]) {
    let calls = 0;
    const adapter = reader(null, { fetchImpl: async (input, options) => {
      calls++;
      const url = new URL(input);
      assert.equal(url.pathname, '/api/v1/locks/lock-demo-1/whitelist');
      assert.equal(url.search, '');
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers['X-API-Key'], KEY);
      const plates = requestedPlate ? [requestedPlate] : [];
      assert.deepEqual(JSON.parse(options.body), { plates });
      return jsonResponse({ success: true, whitelist: plates, message: `${KEY} ${PLATE}`, latestPhoto: { licensePlate: PLATE } });
    } });
    const result = await adapter[method]('lock-demo-1', requestedPlate);
    assert.deepEqual(result, { lockId: 'lock-demo-1', requestedAccess: expectedAccess, acknowledged: true, confirmed: false, requestedAt: new Date(NOW).toISOString() });
    for (const value of [KEY, PLATE, NORMALIZED_PLATE, 'latestPhoto']) assert.ok(!JSON.stringify(result).includes(value));
    assert.equal(calls, 1);
  }
});

test('plate access rejects wildcard, unnormalized, invalid, overlong and missing-config inputs before dispatch', async () => {
  let calls = 0;
  const fetchImpl = () => { calls++; throw new Error('No network expected'); };
  const adapter = reader(null, { fetchImpl });
  for (const value of ['*', 'm-demo-42', 'M-DEMO-42', 'M DEMO42', 'A', 'A'.repeat(16), '\nMDEMO42', undefined, [NORMALIZED_PLATE]]) {
    await rejectsWith(() => adapter.setPlateAccess('lock-demo-1', value), 'ECURIOUS_PLATE_INVALID', [KEY]);
  }
  const missing = new EcuriousAdapter({ fetchImpl });
  await rejectsWith(() => missing.setPlateAccess('lock-demo-1', NORMALIZED_PLATE), 'ECURIOUS_NOT_CONFIGURED');
  await rejectsWith(() => missing.clearPlateAccess('lock-demo-1'), 'ECURIOUS_NOT_CONFIGURED');
  await rejectsWith(() => adapter.clearPlateAccess('../untrusted-lock'), 'ECURIOUS_LOCK_ID');
  assert.equal(calls, 0);
});

test('negative or mismatched whitelist echoes remain uncertain and are never retried', async () => {
  for (const response of [
    { success: true },
    { success: false, whitelist: [NORMALIZED_PLATE] },
    { success: true, whitelist: ['*'] },
    { success: true, whitelist: [NORMALIZED_PLATE, 'OTHERDEMO'] },
    { success: true, whitelist: [] },
  ]) {
    let calls = 0;
    const adapter = reader(response, { fetchImpl: async () => { calls++; return jsonResponse(response); } });
    await assert.rejects(() => adapter.setPlateAccess('lock-demo-1', NORMALIZED_PLATE), error => {
      assert.equal(error.code, 'ECURIOUS_COMMAND_UNCERTAIN');
      assert.equal(error.uncertain, true);
      assert.ok(!error.message.includes(NORMALIZED_PLATE));
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('a whitelist timeout preserves unknown future access instead of claiming the plate was removed', async () => {
  let calls = 0;
  const adapter = reader(null, { timeoutMs: 20, fetchImpl: async (_url, { signal }) => {
    calls++;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error(`${KEY} ${PLATE}`)), { once: true }));
  } });
  await assert.rejects(() => adapter.clearPlateAccess('lock-demo-1'), error => error.code === 'ECURIOUS_COMMAND_UNCERTAIN' && error.uncertain === true && error.status === 504 && !error.message.includes(KEY) && !error.message.includes(PLATE));
  assert.equal(calls, 1);
});

test('private plate matching uses the backend comparator only for a newer observation and returns no raw plate or fingerprint', async () => {
  let calls = 0;
  const observedAt = new Date(NOW - 500).toISOString();
  const adapter = reader({ lockId: 'lock-demo-1', timestamp: observedAt, licensePlate: PLATE }, {
    fetchImpl: async (input, options) => {
      assert.equal(new URL(input).pathname, '/api/v1/locks/lock-demo-1/plate/latest');
      assert.equal(options.method, 'GET');
      return jsonResponse({ lockId: 'lock-demo-1', timestamp: observedAt, licensePlate: PLATE, image: 'fictional-photo' });
    },
  });
  const result = await adapter.getPlateMatch('lock-demo-1', {
    expectedFingerprint: EXPECTED_FINGERPRINT,
    comparePlate: (observed, fingerprint) => { calls++; return comparePlate(observed, fingerprint); },
    notBefore: new Date(NOW - 1_000).toISOString(),
  });
  assert.deepEqual(result, { lockId: 'lock-demo-1', timestamp: observedAt, matched: true });
  assert.equal(calls, 1);
  for (const value of [PLATE, NORMALIZED_PLATE, KEY, EXPECTED_FINGERPRINT, TEST_COMPARISON_SECRET, 'fictional-photo']) assert.ok(!JSON.stringify(result).includes(value));
  const publicObservation = await adapter.getLatestPlate('lock-demo-1');
  assert.deepEqual(publicObservation, { lockId: 'lock-demo-1', timestamp: observedAt, detected: true });
});

test('old, equal-boundary, future and missing plate events cannot become arrival matches', async () => {
  let comparisons = 0;
  const notBefore = new Date(NOW - 1_000).toISOString();
  for (const observedAt of [NOW - 1_001, NOW - 1_000, NOW + 1]) {
    const adapter = reader({ lockId: 'lock-demo-1', timestamp: new Date(observedAt).toISOString(), licensePlate: PLATE });
    const result = await adapter.getPlateMatch('lock-demo-1', { expectedFingerprint: EXPECTED_FINGERPRINT, comparePlate: () => { comparisons++; return true; }, notBefore });
    assert.equal(result.matched, false);
  }
  const missing = reader(null, { fetchImpl: async () => jsonResponse({ error: 'No recognition yet' }, { status: 404 }) });
  assert.deepEqual(await missing.getPlateMatch('lock-demo-1', { expectedFingerprint: EXPECTED_FINGERPRINT, comparePlate, notBefore }), { lockId: 'lock-demo-1', timestamp: null, matched: false });
  await rejectsWith(() => missing.getLatestPlate('lock-demo-1'), 'ECURIOUS_NOT_FOUND');
  const photoOnly = reader({ lockId: 'lock-demo-1', latestPhoto: { licensePlate: PLATE, timestamp: new Date(NOW - 1).toISOString() } });
  await rejectsWith(() => photoOnly.getPlateMatch('lock-demo-1', { expectedFingerprint: EXPECTED_FINGERPRINT, comparePlate, notBefore }), 'ECURIOUS_RESPONSE');
  assert.equal(comparisons, 0);
});

test('malformed/wrong-lock recognition and comparator exceptions stay sanitized', async () => {
  const options = { expectedFingerprint: EXPECTED_FINGERPRINT, comparePlate, notBefore: new Date(NOW - 1_000).toISOString() };
  await rejectsWith(() => reader({ lockId: 'different-lock', timestamp: new Date(NOW - 1).toISOString(), licensePlate: PLATE }).getPlateMatch('lock-demo-1', options), 'ECURIOUS_RESPONSE', [PLATE]);
  const adapter = reader({ lockId: 'lock-demo-1', timestamp: new Date(NOW - 1).toISOString(), licensePlate: PLATE });
  for (const compare of [() => { throw new Error(`${PLATE} ${TEST_COMPARISON_SECRET}`); }, () => 'true']) {
    await rejectsWith(() => adapter.getPlateMatch('lock-demo-1', { ...options, comparePlate: compare }), 'ECURIOUS_PLATE_MATCH_FAILED', [PLATE, TEST_COMPARISON_SECRET]);
  }
  let requests = 0;
  const noFetch = reader(null, { fetchImpl: () => { requests++; throw new Error('No request expected'); } });
  await rejectsWith(() => noFetch.getPlateMatch('lock-demo-1', { ...options, expectedFingerprint: PLATE }), 'ECURIOUS_PLATE_MATCH_CONFIGURATION', [PLATE]);
  await rejectsWith(() => noFetch.getPlateMatch('lock-demo-1', { ...options, notBefore: 'unreadable' }), 'ECURIOUS_PLATE_MATCH_CONFIGURATION');
  assert.equal(requests, 0);
});

test('private access verification requires exactly the expected sole plate and returns policy metadata only', async () => {
  let comparisons = 0;
  const options = { expectedFingerprint: EXPECTED_FINGERPRINT, comparePlate: (plate, fingerprint) => { comparisons++; return comparePlate(plate, fingerprint); } };
  for (const [whitelist, accessMode, expected] of [
    [[NORMALIZED_PLATE], 'specific-plates', true],
    [['OTHERDEMO'], 'specific-plates', false],
    [['*'], 'any-plate', false],
    [[], 'disabled', false],
    [[NORMALIZED_PLATE, 'OTHERDEMO'], 'specific-plates', false],
    [undefined, 'unknown', false],
  ]) {
    const adapter = reader({ lock: lock({ whitelist, latestPhoto: { licensePlate: PLATE } }) });
    const result = await adapter.getPlateAccessMatch('lock-demo-1', options);
    assert.deepEqual(result, { lockId: 'lock-demo-1', accessMode, matched: expected, observedAt: new Date(NOW - 1_000).toISOString() });
    for (const value of [PLATE, NORMALIZED_PLATE, EXPECTED_FINGERPRINT, TEST_COMPARISON_SECRET]) assert.ok(!JSON.stringify(result).includes(value));
  }
  assert.equal(comparisons, 2);
  await rejectsWith(() => reader({ lock: lock({ id: 'different-lock' }) }).getPlateAccessMatch('lock-demo-1', options), 'ECURIOUS_RESPONSE');
  await rejectsWith(() => reader({ lock: lock({ whitelist: [NORMALIZED_PLATE] }) }).getPlateAccessMatch('lock-demo-1', { ...options, comparePlate: () => { throw new Error(`${PLATE} ${TEST_COMPARISON_SECRET}`); } }), 'ECURIOUS_PLATE_MATCH_FAILED', [PLATE, TEST_COMPARISON_SECRET]);
});
