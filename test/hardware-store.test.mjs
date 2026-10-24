import test from 'node:test';
import assert from 'node:assert/strict';
import { HardwareWorkflowError, SupabaseHardwareStore, isHardwareServerKey } from '../lib/hardware-store.mjs';

const URL = 'https://fictional-project.supabase.co';
const PUBLIC_KEY = 'sb_publishable_fictional_public_key_123';
const PRIVATE_KEY = 'sb_secret_fictional_private_key_123';
const PLATE = 'M-DEMO-42';
const jwt = role => [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ role, sub: '20000000-0000-4000-8000-000000000001' })).toString('base64url'),
  'fictional_signature',
].join('.');
const USER_JWT = jwt('authenticated');
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const makeStore = options => new SupabaseHardwareStore({ url: URL, publicKey: PUBLIC_KEY, serverKey: PRIVATE_KEY, ...options });

test('user RPCs forward only the public key and the original guest JWT; worker RPCs use the private key', async () => {
  const calls = [];
  const store = makeStore({ fetchImpl: async (input, options) => {
    calls.push({ input, options });
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
    return json({ serverNow: '2026-10-24T12:00:00.000Z', workflows: [] });
  } });
  await store.userRpc('get_hardware_workflow', { p_bay_id: 'fictional-bay-reference' }, USER_JWT);
  assert.equal(calls[0].input, `${URL}/rest/v1/rpc/get_hardware_workflow`);
  assert.equal(calls[0].options.headers.apikey, PUBLIC_KEY);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${USER_JWT}`);
  assert.ok(!JSON.stringify(calls[0]).includes(PRIVATE_KEY));
  assert.deepEqual(JSON.parse(calls[0].options.body), { p_bay_id: 'fictional-bay-reference' });
  await store.workerRpc('list_hardware_operations');
  assert.equal(calls[1].options.headers.apikey, PRIVATE_KEY);
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert.equal(calls.length, 2);
});

test('legacy service-role JWT is restricted to worker transport and key roles cannot be swapped', async () => {
  const serverJwt = jwt('service_role');
  assert.equal(isHardwareServerKey(serverJwt), true);
  assert.equal(isHardwareServerKey(USER_JWT), false);
  assert.equal(isHardwareServerKey(jwt('anon')), false);
  const store = makeStore({ serverKey: serverJwt, fetchImpl: async (_input, options) => {
    assert.equal(options.headers.apikey, serverJwt);
    assert.equal(options.headers.Authorization, `Bearer ${serverJwt}`);
    return json({ operations: [] });
  } });
  await store.workerRpc('list_hardware_operations');
  for (const options of [{ publicKey: PRIVATE_KEY }, { serverKey: PUBLIC_KEY }, { publicKey: USER_JWT }]) {
    assert.throws(() => makeStore(options), error => error.code === 'HARDWARE_CONFIGURATION');
  }
});

test('allowlists, invalid JWTs, missing configuration, and origin validation reject before network access', async () => {
  let calls = 0;
  const fetchImpl = () => { calls++; throw new Error('No network expected'); };
  const store = makeStore({ fetchImpl });
  await assert.rejects(() => store.userRpc('mark_hardware_dispatch', {}, USER_JWT), error => error.code === 'HARDWARE_CONFIGURATION');
  await assert.rejects(() => store.workerRpc('request_hardware_reservation'), error => error.code === 'HARDWARE_CONFIGURATION');
  for (const token of [undefined, 'not-a-jwt', 'a.b.c\nprivate', 'a'.repeat(8193)]) {
    await assert.rejects(() => store.userRpc('list_hardware_workflows', {}, token), error => error.code === 'AUTH_REQUIRED' && error.status === 401);
  }
  const missing = new SupabaseHardwareStore({ fetchImpl });
  assert.equal(missing.configured, false);
  await assert.rejects(() => missing.workerRpc('list_hardware_operations'), error => error.code === 'HARDWARE_CONFIGURATION');
  for (const url of ['http://example.invalid', `https://${PRIVATE_KEY}@example.invalid`, `https://example.invalid/?key=${PRIVATE_KEY}`, 'https://example.invalid/rest/v1']) {
    assert.throws(() => makeStore({ url }), error => error.code === 'HARDWARE_CONFIGURATION' && !error.message.includes(PRIVATE_KEY));
  }
  assert.equal(calls, 0);
});

test('known SQL errors become fixed messages; arbitrary provider content and credentials are never returned', async () => {
  const cases = [
    [401, { message: `${PRIVATE_KEY} ${PLATE}` }, 'AUTH_REQUIRED', 401],
    [403, { message: `${PRIVATE_KEY} ${PLATE}` }, 'AUTH_REQUIRED', 401],
    [404, { code: 'PGRST202', message: `${PRIVATE_KEY} ${PLATE}` }, 'HARDWARE_SCHEMA_MISSING', 503],
    [400, { message: 'BAY_RESERVED', details: `${PRIVATE_KEY} ${PLATE}` }, 'BAY_RESERVED', 409],
    [500, { message: `${PRIVATE_KEY} ${PLATE}` }, 'HARDWARE_STORE_FAILED', 502],
  ];
  for (const [status, body, code, expectedStatus] of cases) {
    let calls = 0;
    const store = makeStore({ fetchImpl: async () => { calls++; return json(body, status); } });
    await assert.rejects(() => store.workerRpc('record_hardware_result'), error => {
      assert.ok(error instanceof HardwareWorkflowError);
      assert.equal(error.code, code);
      assert.equal(error.status, expectedStatus);
      for (const secret of [PRIVATE_KEY, PUBLIC_KEY, USER_JWT, PLATE]) assert.ok(!`${error.message}${JSON.stringify(error)}`.includes(secret));
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('malformed, oversized, failed and timed-out RPC reads stay bounded and do not retry', async () => {
  const cases = [
    { fetch: async () => new Response(`{"private":"${PRIVATE_KEY} ${PLATE}"`), code: 'HARDWARE_STORE_RESPONSE' },
    { fetch: async () => json({ private: 'x'.repeat(1024 * 1024) }), code: 'HARDWARE_STORE_RESPONSE' },
    { fetch: async () => { throw new Error(`${PRIVATE_KEY} ${PLATE}`); }, code: 'HARDWARE_STORE_UNAVAILABLE' },
    { fetch: async (_input, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error(`${PRIVATE_KEY} ${PLATE}`)), { once: true });
    }), code: 'HARDWARE_STORE_TIMEOUT', status: 504 },
  ];
  for (const item of cases) {
    let calls = 0;
    const store = makeStore({ timeoutMs: 20, fetchImpl: async (...args) => { calls++; return item.fetch(...args); } });
    await assert.rejects(() => store.workerRpc('mark_hardware_dispatch'), error => {
      assert.equal(error.code, item.code);
      if (item.status) assert.equal(error.status, item.status);
      assert.ok(!error.message.includes(PRIVATE_KEY));
      assert.ok(!error.message.includes(PLATE));
      return true;
    });
    assert.equal(calls, 1);
  }
});
