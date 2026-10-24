import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from '../server.mjs';

// Load the actual native contract without React Native, environment files or new
// dependencies. Only its address import is replaced; validation stays unchanged.
const require = createRequire(new URL('../mobile/package.json', import.meta.url));
const ts = require('typescript');
const source = await readFile(new URL('../mobile/src/lib/simulation-api.ts', import.meta.url), 'utf8');
const addressImport = "import { API_BASE_URL } from '@/lib/reservation-api';";
assert.ok(source.includes(addressImport));
const compiled = ts.transpileModule(source.replace(addressImport, "const API_BASE_URL = 'http://127.0.0.1';"), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { isLabSnapshot } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

async function serve(t) {
  const externalAccess = [];
  const forbidden = label => new Proxy({}, { get(_target, field) {
    externalAccess.push(`${label}.${String(field)}`);
    throw new Error('A simulation route reached a forbidden live dependency.');
  } });
  const server = createServer({
    simulator: forbidden('independentSimulator'), hardware: forbidden('hardware'),
    hardwareWorkflow: forbidden('databaseWorkflow'), hardwareSlots: forbidden('databaseSlots'),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  t.after(() => assert.deepEqual(externalAccess, [], 'lab routes never touch hardware, database or the independent simulator'));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = body => fetch(`${base}/api/simulation/actions`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { base, post };
}

test('simulation HTTP snapshots and all seven scenarios pass the actual mobile validator without live dependencies', async t => {
  const { base, post } = await serve(t);
  const response = await fetch(`${base}/api/simulation`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const initial = await response.json();
  assert.equal(isLabSnapshot(initial), true);
  assert.equal(initial.scenarios.length, 7);
  for (const scenario of initial.scenarios) {
    const run = await post({ action: 'scenario', scenarioId: scenario.id });
    assert.equal(run.status, 200, scenario.id);
    const state = await run.json();
    assert.equal(isLabSnapshot(state), true, scenario.id);
    assert.equal(state.scenarioId, scenario.id);
    assert.ok(state.checks.length > 0 && state.checks.every(check => check.passed), scenario.id);
  }
  const advanced = await post({ action: 'advance', minutes: 1 });
  const changed = await advanced.json();
  assert.equal(isLabSnapshot(changed), true);
  assert.equal(changed.scenarioId, null);
  assert.deepEqual(changed.checks, []);
});

test('simulation HTTP methods, strict controls and JSON body limits keep the world unchanged on refusal', async t => {
  const { base, post } = await serve(t);
  const read = async () => (await fetch(`${base}/api/simulation`)).json();
  const initial = await read();
  for (const [path, method, allow] of [
    ['/api/simulation', 'POST', 'GET'], ['/api/simulation', 'DELETE', 'GET'],
    ['/api/simulation/actions', 'GET', 'POST'], ['/api/simulation/actions', 'PUT', 'POST'],
  ]) {
    const response = await fetch(`${base}${path}`, { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), allow);
    assert.equal((await response.json()).error.code, 'METHOD_NOT_ALLOWED');
  }
  for (const body of [null, [], { action: '__proto__' }, { action: 'reset', licensePlate: 'M-DEMO-42' },
    { action: 'advance', minutes: 0 }, { action: 'advance', minutes: 181 }, { action: 'scenario', scenarioId: 'not-a-scenario' },
    { action: 'reserve', carId: 'real-profile', bayId: 'bay-1', bookingMode: 'now' },
    { action: 'scan', carId: 'car-a', bayId: 'bay-1', confidence: 1.1 }]) {
    const response = await post(body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_LAB_ACTION');
  }
  const invalidJson = await fetch(`${base}/api/simulation/actions`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{invalid',
  });
  assert.equal(invalidJson.status, 400);
  assert.equal((await invalidJson.json()).error.code, 'INVALID_JSON');
  const wrongType = await fetch(`${base}/api/simulation/actions`, { method: 'POST', body: '{}' });
  assert.equal(wrongType.status, 415);
  const oversized = await post({ action: 'reset', padding: 'x'.repeat(9000) });
  assert.equal(oversized.status, 413);
  assert.deepEqual(await read(), initial);
});

test('simulation HTTP preserves one bay owner and the mobile parser rejects coerced enum values', async t => {
  const { base, post } = await serve(t);
  const held = await post({ action: 'reserve', carId: 'car-a', bayId: 'bay-1', bookingMode: 'now' });
  assert.equal(held.status, 200);
  const snapshot = await held.json();
  assert.equal(isLabSnapshot(snapshot), true);
  const second = await post({ action: 'reserve', carId: 'car-b', bayId: 'bay-1', bookingMode: 'now' });
  assert.equal(second.status, 409);
  assert.equal((await second.json()).error.code, 'BAY_ALREADY_BOOKED');
  assert.deepEqual(await (await fetch(`${base}/api/simulation`)).json(), snapshot);
  for (const change of [
    state => { state.bays[0].barrier = ['lowered']; },
    state => { state.bays[0].pendingCommand.target = ['raised']; },
    state => { state.bookings[0].bookingMode = ['now']; },
  ]) {
    const malformed = structuredClone(snapshot);
    change(malformed);
    assert.equal(isLabSnapshot(malformed), false);
  }
});
