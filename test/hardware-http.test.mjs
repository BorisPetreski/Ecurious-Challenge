import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../server.mjs';
import { HardwareWorkflowError } from '../lib/hardware-store.mjs';

const TOKEN = 'fictional.user.signature';
const BAY = '30000000-0000-4000-8000-000000000001';
const CONNECTOR = '30000000-0000-4000-8000-000000000002';
const REQUEST = '30000000-0000-4000-8000-000000000003';
const RESERVATION = '30000000-0000-4000-8000-000000000004';

async function serve(t, options = {}) {
  const server = createServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  return `http://127.0.0.1:${server.address().port}`;
}
const post = (base, path, body, headers = {}) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const snapshot = { source: 'ecurious', commandsEnabled: true, serverNow: '2026-10-24T12:00:00.000Z', reason: null, workflows: [], observations: [] };

test('scheduled slot HTTP routes gate writes, forward scoped identity and return a mock quote', async t => {
  const calls = [];
  const slots = { configured: true, serverNow: '2026-10-24T12:00:00Z', slots: [], policy: { mock: true } };
  const base = await serve(t, { hardwareSlots: {
    configured: true,
    snapshot: async (...args) => { calls.push(['read', ...args]); return slots; },
    reserve: async (...args) => { calls.push(['reserve', ...args]); return slots; },
    cancel: async (...args) => { calls.push(['cancel', ...args]); return slots; },
  } });
  assert.equal((await post(base, '/api/hardware/slots', {})).status, 401);
  const headers = { authorization: `Bearer ${TOKEN}` };
  assert.equal((await fetch(`${base}/api/hardware/slots?bayId=${BAY}`, { headers })).status, 200);
  const body = { bayId: BAY, connectorId: CONNECTOR, requestId: REQUEST, startsAt: '2026-10-24T12:00:00Z', endsAt: '2026-10-24T12:30:00Z', licensePlate: 'M-DEMO-42' };
  assert.equal((await post(base, '/api/hardware/slots', body, headers)).status, 202);
  assert.equal((await post(base, '/api/hardware/slots/cancel', { slotId: RESERVATION }, headers)).status, 202);
  assert.deepEqual(calls, [['read', TOKEN, BAY], ['reserve', TOKEN, body], ['cancel', TOKEN, { slotId: RESERVATION }]]);
  const unavailable = await serve(t);
  assert.equal((await post(unavailable, '/api/hardware/slots', {})).status, 503);
  assert.equal((await fetch(`${unavailable}/api/hardware/slots`)).status, 200);
  const start = new Date(Date.now() + 60_000).toISOString();
  const end = new Date(Date.parse(start) + 30 * 60_000).toISOString();
  const quote = await post(unavailable, '/api/hardware/quote', { startsAt: start, endsAt: end });
  assert.equal(quote.status, 200);
  assert.equal((await quote.json()).mock, true);
  assert.equal((await fetch(`${unavailable}/api/hardware/quote`)).status, 405);
});

test('hardware command routes require activation and a valid bearer shape before accepting intent', async t => {
  const disabled = await serve(t);
  const setup = await fetch(`${disabled}/api/hardware/bookings`);
  assert.equal(setup.status, 200);
  assert.equal((await setup.json()).commandsEnabled, false);
  const unavailable = await post(disabled, '/api/hardware/bookings', {});
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).error.code, 'HARDWARE_SETUP_REQUIRED');

  let intents = 0;
  const enabled = await serve(t, { hardwareWorkflow: {
    configured: true,
    reserve: async () => { intents++; return snapshot; },
    act: async () => { intents++; return snapshot; },
  } });
  for (const authorization of [undefined, 'Basic fictional.user.signature', 'Bearer not-a-jwt']) {
    const response = await post(enabled, '/api/hardware/bookings', {}, authorization ? { authorization } : {});
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'AUTH_REQUIRED');
  }
  assert.equal(intents, 0);
});

test('hardware HTTP routes forward the caller identity and return 202 intent snapshots without claiming movement', async t => {
  const calls = [];
  let physicalCommands = 0;
  const base = await serve(t, {
    hardware: { raiseBarrier: async () => { physicalCommands++; }, lowerBarrier: async () => { physicalCommands++; } },
    hardwareWorkflow: {
      configured: true,
      snapshot: async token => { calls.push({ kind: 'snapshot', token }); return snapshot; },
      reserve: async (token, body) => { calls.push({ kind: 'reserve', token, body }); return snapshot; },
      act: async (token, body) => { calls.push({ kind: 'act', token, body }); return snapshot; },
    },
  });
  const headers = { authorization: `Bearer ${TOKEN}` };
  const listed = await fetch(`${base}/api/hardware/bookings`, { headers });
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), snapshot);
  const reserveBody = { bayId: BAY, connectorId: CONNECTOR, requestId: REQUEST, holdMinutes: 10 };
  const reserved = await post(base, '/api/hardware/bookings', reserveBody, headers);
  assert.equal(reserved.status, 202);
  assert.equal(reserved.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await reserved.json(), snapshot);
  const actionBody = { action: 'entry', bayId: BAY, reservationId: RESERVATION };
  const action = await post(base, '/api/hardware/actions', actionBody, headers);
  assert.equal(action.status, 202);
  assert.deepEqual(await action.json(), snapshot);
  assert.deepEqual(calls, [
    { kind: 'snapshot', token: TOKEN }, { kind: 'reserve', token: TOKEN, body: reserveBody }, { kind: 'act', token: TOKEN, body: actionBody },
  ]);
  assert.equal(physicalCommands, 0);
  assert.ok(!JSON.stringify(snapshot).includes(TOKEN));
});

test('no raw lock routes or wrong HTTP methods can bypass the workflow', async t => {
  let calls = 0;
  const base = await serve(t, { hardwareWorkflow: { configured: true, reserve: () => { calls++; }, act: () => { calls++; } } });
  for (const path of ['/api/hardware/fictional-lock/lock', '/api/hardware/fictional-lock/unlock', '/api/v1/locks/fictional-lock/lock', '/api/hardware/commands']) {
    assert.equal((await post(base, path, { lockId: 'arbitrary-lock' }, { authorization: `Bearer ${TOKEN}` })).status, 404);
  }
  for (const [path, method, allow] of [['/api/hardware/bookings', 'DELETE', 'GET, POST'], ['/api/hardware/actions', 'GET', 'POST'], ['/api/hardware', 'POST', 'GET']]) {
    const response = await fetch(`${base}${path}`, { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), allow);
  }
  assert.equal(calls, 0);
});

test('hardware intent body limits and sanitized workflow failures use the existing JSON error envelope', async t => {
  const privateText = 'fictional_private_backend_key M-DEMO-42';
  const base = await serve(t, { hardwareWorkflow: {
    configured: true,
    reserve: async () => { throw new Error(privateText); },
    act: async () => { throw new HardwareWorkflowError('HARDWARE_BUSY', 'The designated bay has an unresolved operation.', 409); },
  } });
  const headers = { authorization: `Bearer ${TOKEN}` };
  const invalid = await fetch(`${base}/api/hardware/bookings`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{broken' });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'INVALID_JSON');
  const oversized = await post(base, '/api/hardware/bookings', { value: 'x'.repeat(9000) }, headers);
  assert.equal(oversized.status, 413);
  const failure = await post(base, '/api/hardware/bookings', {}, headers);
  assert.equal(failure.status, 500);
  const body = await failure.text();
  assert.ok(!body.includes(privateText));
  assert.ok(!body.includes(TOKEN));
  assert.equal(JSON.parse(body).error.code, 'INTERNAL_ERROR');
  const conflict = await post(base, '/api/hardware/actions', {}, headers);
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, 'HARDWARE_BUSY');
});
