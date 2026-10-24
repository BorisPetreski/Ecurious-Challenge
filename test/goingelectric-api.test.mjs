import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchDirectory, normalizeStation, stationLink } from '../mobile/src/lib/goingelectric-api.ts';

const region = { latitude: 48, longitude: 11, latitudeDelta: 0.2, longitudeDelta: 0.4 };
const key = 'fictional-directory-key';
const station = {
  ge_id: 123,
  name: 'Demo charger',
  coordinates: { lat: 48, lng: 11 },
  address: { street: 'Demo street 1', postcode: '80000', city: 'Demo City', country: 'Deutschland' },
  chargepoints: [{ type: 'CCS', power: 150, count: 2 }, { type: 'Typ2', power: 22, count: 1 }],
  network: 'Demo network',
  url: '//www.goingelectric.de/stromtankstellen/Deutschland/Demo-City/Demo-charger/123/',
  fault_report: false,
  verified: true,
};
const reply = data => async () => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

test('directory fetch sends documented viewport filters directly and normalizes unique stations', async () => {
  let requested;
  const result = await fetchDirectory({
    apiKey: key, region, minPower: 50, plug: 'CCS',
    fetchImpl: async (url, options) => {
      requested = new URL(url);
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'error');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.headers.Accept, 'application/json');
      assert.ok(options.signal instanceof AbortSignal);
      return reply({ status: 'ok', chargelocations: [station, station, { ...station, ge_id: -1 }] })();
    },
  });
  assert.equal(requested.origin + requested.pathname, 'https://api.goingelectric.de/chargepoints/');
  assert.deepEqual(Object.fromEntries(requested.searchParams), {
    key, sw_lat: '47.9', sw_lng: '10.8', ne_lat: '48.1', ne_lng: '11.2',
    min_power: '50', clustering: 'false', plugs: 'CCS',
  });
  assert.equal(result.stations.length, 1);
  assert.equal(result.stations[0].maxPower, 150);
  assert.equal(result.stations[0].address, 'Demo street 1, 80000 Demo City, Deutschland');
  assert.equal(result.stations[0].url, `https:${station.url}`);
  assert.equal(result.stations[0].faultReported, false);
  assert.equal(result.stations[0].verified, true);
  assert.equal(result.hasMore, false);
  assert.ok(Number.isFinite(Date.parse(result.fetchedAt)));
});

test('station normalization rejects invalid entries and excludes unsupported connector values', () => {
  for (const patch of [
    { ge_id: 1.2 }, { name: '' }, { coordinates: { lat: 91, lng: 11 } },
    { coordinates: { lat: '48', lng: 11 } }, { url: undefined },
    { url: '//www.goingelectric.de/stromtankstellen/Deutschland/Demo/999/' },
  ]) assert.equal(normalizeStation({ ...station, ...patch }), null);
  const normalized = normalizeStation({
    ...station, network: {}, verified: 'yes', fault_report: { description: 'Reported' },
    chargepoints: [
      { type: 'CCS', power: 100, count: 2 },
      { type: 'CCS', power: -1, count: 2 },
      { type: 'CCS', power: 150, count: '2' },
      { type: '', power: 22, count: 1 },
      null,
    ],
  });
  assert.deepEqual(normalized.connectors, [{ type: 'CCS', power: 100, count: 2 }]);
  assert.equal(normalized.network, null);
  assert.equal(normalized.verified, false);
  assert.equal(normalized.faultReported, true);
  assert.equal(normalizeStation({ ...station, chargepoints: [] }).maxPower, null);
});

test('source links are restricted to canonical GoingElectric station pages without query credentials', () => {
  assert.equal(stationLink('/stromtankstellen/Deutschland/Demo/123/#details', 123), 'https://www.goingelectric.de/stromtankstellen/Deutschland/Demo/123/');
  for (const url of [
    'https://www.goingelectric.de.evil.example/stromtankstellen/Demo/123/',
    'https://user:secret@www.goingelectric.de/stromtankstellen/Demo/123/',
    'https://www.goingelectric.de:444/stromtankstellen/Demo/123/',
    'https://www.goingelectric.de/stromtankstellen/Demo/123/?key=secret',
    'https://www.goingelectric.de/stromtankstellen/',
    'http://www.goingelectric.de/stromtankstellen/Demo/123/',
    'javascript:alert(1)',
    'https://www.goingelectric.de/stromtankstellen/Demo/123/\n',
  ]) assert.equal(stationLink(url, 123), null);
});

test('invalid map areas and filters are rejected before making a request', async () => {
  const fetchImpl = async () => { assert.fail('invalid requests must not fetch'); };
  for (const changedRegion of [
    { ...region, longitude: 179.9, longitudeDelta: 1 },
    { ...region, latitudeDelta: 0 },
    { ...region, latitude: Infinity },
    { ...region, longitudeDelta: 360 },
  ]) {
    await assert.rejects(fetchDirectory({ apiKey: key, region: changedRegion, fetchImpl }), { code: 'INVALID_REGION' });
  }
  await assert.rejects(fetchDirectory({ apiKey: key, region, minPower: 1.5, fetchImpl }), { code: 'INVALID_FILTER' });
  await assert.rejects(fetchDirectory({ apiKey: '', region, fetchImpl }), { code: 'MISSING_KEY' });
  const result = await fetchDirectory({
    apiKey: key, region: { ...region, latitude: 89.9, latitudeDelta: 1 },
    fetchImpl: async url => {
      const params = new URL(url).searchParams;
      assert.equal(params.get('ne_lat'), '90');
      assert.equal(params.get('sw_lat'), '89.4');
      return reply({ status: 'ok', chargelocations: [] })();
    },
  });
  assert.deepEqual(result.stations, []);
});

test('provider, JSON, and network errors never repeat the API key or raw provider text', async () => {
  const cases = [
    { fetchImpl: async () => { throw new Error(`Failed URL https://example.test/?key=${key}`); }, code: 'NETWORK_ERROR' },
    { fetchImpl: reply({ status: 'error', message: `Invalid ${key}` }), code: 'API_ERROR' },
    { fetchImpl: reply({ status: 'ok', chargelocations: {} }), code: 'INVALID_RESPONSE' },
    { fetchImpl: async () => new Response(key), code: 'INVALID_RESPONSE' },
    { fetchImpl: async () => new Response(key, { status: 403 }), code: 'KEY_REJECTED' },
    { fetchImpl: async () => new Response(key, { status: 429 }), code: 'RATE_LIMITED' },
    { fetchImpl: async () => new Response(key, { status: 500 }), code: 'HTTP_ERROR' },
    { fetchImpl: async () => new Response('{}', { headers: { 'content-length': String(5 * 1024 * 1024) } }), code: 'RESPONSE_TOO_LARGE' },
  ];
  for (const entry of cases) {
    await assert.rejects(fetchDirectory({ apiKey: key, region, fetchImpl: entry.fetchImpl }), error => {
      assert.equal(error.code, entry.code);
      assert.equal(error.message.includes(key), false);
      assert.equal(error.message.includes('https://'), false);
      return true;
    });
  }
});

test('directory truncation is explicit and cancellation propagates without leaking URLs', async () => {
  const many = Array.from({ length: 501 }, (_, index) => ({
    ...station, ge_id: index + 1, url: `//www.goingelectric.de/stromtankstellen/Demo/${index + 1}/`,
  }));
  const result = await fetchDirectory({ apiKey: key, region, fetchImpl: reply({ status: 'ok', chargelocations: many }) });
  assert.equal(result.hasMore, true);
  assert.equal(result.stations.length, 500);
  const paged = await fetchDirectory({ apiKey: key, region, fetchImpl: reply({ status: 'ok', chargelocations: [station], startkey: 100 }) });
  assert.equal(paged.hasMore, true);
  const alreadyCancelled = new AbortController();
  alreadyCancelled.abort();
  await assert.rejects(fetchDirectory({ apiKey: key, region, signal: alreadyCancelled.signal }), { name: 'AbortError' });

  const controller = new AbortController();
  const search = fetchDirectory({
    apiKey: key, region, signal: controller.signal,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error(`Aborted ${key}`)), { once: true });
    }),
  });
  controller.abort();
  await assert.rejects(search, error => {
    assert.equal(error.name, 'AbortError');
    assert.equal(error.message.includes(key), false);
    return true;
  });
});
