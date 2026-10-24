import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

// Run the actual TypeScript client/hook with controlled module dependencies.
// No renderer, native module, credentials, network, or new dependency is used.
const require = createRequire(new URL('../mobile/package.json', import.meta.url));
const ts = require('typescript');
const hookSource = await readFile(new URL('../mobile/src/hooks/use-hardware-workflows.ts', import.meta.url), 'utf8');
const clientSource = await readFile(new URL('../mobile/src/lib/hardware-workflow-api.ts', import.meta.url), 'utf8');
const fixtureKey = '__bayReadyHardwareMobileFixtures';
globalThis[fixtureKey] = new Map();
let nextId = 0;
const NOW = '2026-10-24T12:00:00.000Z';
const bayId = '11111111-1111-4111-8111-111111111111';
const connectorId = '22222222-2222-4222-8222-222222222222';
const reservationId = '33333333-3333-4333-8333-333333333333';
const operationId = '44444444-4444-4444-8444-444444444444';
const future = '2026-10-24T12:10:00.000Z';
const snapshot = () => ({
  source: 'ecurious', commandsEnabled: true, reason: null, serverNow: NOW,
  workflows: [{ serverNow: NOW, bay: { id: bayId, label: 'Designated test bay', lockId: 'lock-test', connectors: [{ id: connectorId, label: 'Test CCS', type: 'CCS', powerKw: 150, enabled: true }] }, reservation: { id: null, isMine: false, expiresAt: null }, phase: 'idle', reason: null, operation: null, capabilities: { canReserve: true, canRequestEntry: false, canRequestRelease: false } }], observations: [],
});
const owned = () => {
  const value = snapshot();
  Object.assign(value.workflows[0], { phase: 'protected', reservation: { id: reservationId, isMine: true, expiresAt: future }, capabilities: { canReserve: false, canRequestEntry: true, canRequestRelease: true } });
  return value;
};
const uncertain = () => {
  const value = owned();
  Object.assign(value.workflows[0], { phase: 'uncertain', reason: 'COMMAND_DELIVERY_UNRESOLVED', capabilities: { canReserve: false, canRequestEntry: false, canRequestRelease: false }, operation: { id: operationId, kind: 'protect', target: 'raised', status: 'uncertain', requestedAt: '2026-10-24T11:59:58.000Z', dispatchedAt: '2026-10-24T11:59:59.000Z' } });
  return value;
};
const disabled = () => ({ source: 'ecurious', commandsEnabled: false, reason: 'HARDWARE_SETUP_REQUIRED', serverNow: NOW, workflows: [], observations: [] });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
const settleTurn = () => new Promise(resolve => setImmediate(resolve));

async function hookFixture() {
  const id = ++nextId;
  let runner;
  const fixture = { now: Date.parse(NOW), reads: [], reserves: [], actions: [], timers: new Map(), listeners: new Set(), readImpl: async () => snapshot(), reserveImpl: async () => owned(), actionImpl: async () => owned() };
  fixture.react = {
    useState(initial) {
      const index = runner.cursor++;
      if (!(index in runner.cells)) runner.cells[index] = typeof initial === 'function' ? initial() : initial;
      return [runner.cells[index], value => { runner.cells[index] = typeof value === 'function' ? value(runner.cells[index]) : value; }];
    },
    useRef(initial) { const index = runner.cursor++; return runner.cells[index] ??= { current: initial }; },
    useCallback(callback, dependencies) {
      const index = runner.cursor++, previous = runner.cells[index];
      if (previous && same(previous.dependencies, dependencies)) return previous.callback;
      runner.cells[index] = { callback, dependencies }; return callback;
    },
    useEffect(effect, dependencies) {
      const index = runner.cursor++, previous = runner.cells[index];
      if (!previous || !same(previous.dependencies, dependencies)) {
        runner.cells[index] = { dependencies, cleanup: previous?.cleanup };
        runner.effects.push(() => { previous?.cleanup?.(); runner.cells[index].cleanup = effect(); });
      }
    },
  };
  fixture.AppState = { currentState: 'active', addEventListener(_name, listener) { fixture.listeners.add(listener); return { remove: () => fixture.listeners.delete(listener) }; } };
  fixture.setInterval = (callback, ms) => { const key = Symbol('interval'); fixture.timers.set(key, { callback, ms }); return key; };
  fixture.clearInterval = key => fixture.timers.delete(key);
  fixture.api = {
    fetchHardwareWorkflows(signal) { fixture.reads.push({ signal }); return fixture.readImpl(signal); },
    reserveHardwareBay(...args) { fixture.reserves.push(args); return fixture.reserveImpl(...args); },
    requestHardwareAction(...args) { fixture.actions.push(args); return fixture.actionImpl(...args); },
  };
  globalThis[fixtureKey].set(id, fixture);
  const transformed = hookSource.replace(/import\s*\{([^;]+?)\}\s*from\s*'([^']+)';/g, (statement, _bindings, name) => {
    if (name === 'react') return 'const { useCallback, useEffect, useRef, useState } = fixture.react;';
    if (name === 'react-native') return 'const { AppState } = fixture;';
    if (name === '@/lib/hardware-workflow-api') return 'const { fetchHardwareWorkflows, requestHardwareAction, reserveHardwareBay } = fixture.api;';
    return statement;
  });
  const compiled = ts.transpileModule(transformed, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const code = `const fixture = globalThis.${fixtureKey}.get(${id});\nconst { setInterval, clearInterval } = fixture;\nconst Date = class extends globalThis.Date { static now() { return fixture.now; } };\n${compiled}`;
  const { useHardwareWorkflows } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  runner = { cursor: 0, cells: [], effects: [], value: null };
  fixture.render = () => { runner.cursor = 0; runner.value = useHardwareWorkflows(); for (const effect of runner.effects.splice(0)) effect(); return runner.value; };
  fixture.settle = async () => { for (let tick = 0; tick < 4; tick++) { await settleTurn(); fixture.render(); } return runner.value; };
  fixture.foreground = state => { fixture.AppState.currentState = state; for (const listener of fixture.listeners) listener(state); };
  fixture.cleanup = () => { for (const cell of runner.cells) cell?.cleanup?.(); globalThis[fixtureKey].delete(id); };
  return fixture;
}

async function clientFixture() {
  const id = ++nextId;
  const fixture = { calls: [], authCalls: 0, timers: new Map(), fetchImpl: async () => Response.json(disabled()), tokenImpl: async () => 'fictional-guest-token' };
  fixture.fetch = async (...args) => { fixture.calls.push(args); return fixture.fetchImpl(...args); };
  fixture.getBookingAccessToken = () => { fixture.authCalls++; return fixture.tokenImpl(); };
  fixture.setTimeout = callback => { const key = Symbol('timeout'); fixture.timers.set(key, callback); return key; };
  fixture.clearTimeout = key => fixture.timers.delete(key);
  globalThis[fixtureKey].set(id, fixture);
  const transformed = clientSource.replace(/import\s*\{([^;]+?)\}\s*from\s*'([^']+)';/g, (statement, _bindings, name) => {
    if (name === 'expo-crypto') return `const randomUUID = () => '${operationId}';`;
    if (name === '@/lib/bookings-api') return 'const BOOKINGS_CONFIGURED = true; const { getBookingAccessToken } = fixture;';
    if (name === '@/lib/reservation-api') return "const API_BASE_URL = 'http://127.0.0.1:3000';";
    return statement;
  });
  const compiled = ts.transpileModule(transformed, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const code = `const fixture = globalThis.${fixtureKey}.get(${id});\nconst { fetch, setTimeout, clearTimeout } = fixture;\n${compiled}`;
  fixture.client = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  fixture.cleanup = () => globalThis[fixtureKey].delete(id);
  return fixture;
}

// A failed connection never turns retained state into permission for movement.
test('hardware hook keeps failed reads stale and rejects writes', async t => {
  const f = await hookFixture(); t.after(f.cleanup); f.render(); let state = await f.settle();
  assert.equal(state.fresh, true);
  f.readImpl = async () => { throw new Error('Controlled read failure'); };
  await state.refresh(); state = await f.settle();
  assert.equal(state.fresh, false); assert.equal(state.snapshot.workflows[0].phase, 'idle');
  await state.reserve(bayId, connectorId, 10); assert.equal(f.reserves.length, 0);
});

test('duplicate hardware reserve taps send one write and reconcile one ownership result', async t => {
  const f = await hookFixture(); t.after(f.cleanup); f.render(); let state = await f.settle();
  const pending = deferred(); f.reserveImpl = () => pending.promise;
  const first = state.reserve(bayId, connectorId, 10); await state.reserve(bayId, connectorId, 10);
  assert.equal(f.reserves.length, 1); assert.deepEqual(f.reserves[0], [bayId, connectorId, 10]);
  f.readImpl = async () => owned(); pending.resolve(owned()); await first; state = await f.settle();
  assert.equal(state.busy, false); assert.equal(state.snapshot.workflows[0].reservation.isMine, true);
});

test('unknown hardware writes trigger GET reconciliation and never repeat a movement', async t => {
  const f = await hookFixture(); t.after(f.cleanup); f.render(); let state = await f.settle();
  f.reserveImpl = async () => { throw new Error('Controlled unknown command'); }; f.readImpl = async () => uncertain();
  const reads = f.reads.length; await state.reserve(bayId, connectorId, 10); state = await f.settle();
  assert.equal(f.reserves.length, 1); assert.equal(f.actions.length, 0); assert.equal(f.reads.length, reads + 1);
  assert.equal(state.snapshot.workflows[0].phase, 'uncertain'); assert.match(state.error, /unknown/);
  await state.reserve(bayId, connectorId, 10); assert.equal(f.reserves.length, 1);
});

test('hardware foreground and 15-second age guards prevent stale movement', async t => {
  const f = await hookFixture(); t.after(f.cleanup); f.render(); let state = await f.settle();
  const foregroundReads = f.reads.length;
  f.foreground('background'); state = f.render(); await state.reserve(bayId, connectorId, 10);
  for (const timer of f.timers.values()) timer.callback(); await f.settle();
  assert.equal(f.reserves.length, 0); assert.equal(f.reads.length, foregroundReads); const reads = f.reads.length;
  f.foreground('active'); state = await f.settle(); assert.ok(f.reads.length > reads); assert.equal(state.fresh, true);
  f.now += 15_001; await state.reserve(bayId, connectorId, 10); assert.equal(f.reserves.length, 0);
  state = f.render(); assert.equal(state.fresh, false);
});

test('hardware hook rejects another reservation ID and connectors from another bay', async t => {
  const f = await hookFixture(); t.after(f.cleanup); f.readImpl = async () => owned(); f.render(); const state = await f.settle();
  await state.act('release', bayId, operationId); await state.reserve(bayId, operationId, 10);
  assert.equal(f.actions.length, 0); assert.equal(f.reserves.length, 0);
});

test('public disabled hardware GET works without a guest session', async t => {
  const f = await clientFixture(); t.after(f.cleanup);
  f.tokenImpl = async () => { throw new Error('Guest auth must not run'); };
  assert.deepEqual(await f.client.fetchHardwareWorkflows(), disabled());
  assert.equal(f.authCalls, 0); assert.equal(f.calls.length, 1); assert.equal(f.calls[0][1].method, 'GET'); assert.equal(f.calls[0][1].headers.Authorization, undefined);
});

test('enabled hardware GET authenticates after one 401 and keeps the token in the header', async t => {
  const f = await clientFixture(); t.after(f.cleanup);
  f.fetchImpl = async (_url, init) => init.headers.Authorization ? Response.json(snapshot()) : Response.json({ error: { code: 'AUTH_REQUIRED', message: 'Sign in' } }, { status: 401 });
  assert.equal((await f.client.fetchHardwareWorkflows()).commandsEnabled, true);
  assert.equal(f.calls.length, 2); assert.equal(f.authCalls, 1);
  assert.equal(f.calls[1][1].headers.Authorization, 'Bearer fictional-guest-token');
  assert.equal(f.calls.some(([url]) => url.includes('fictional-guest-token')), false);
});

test('the hardware client sends one reserve intent with no profile fields and never retries an unknown POST', async t => {
  const f = await clientFixture(); t.after(f.cleanup); f.fetchImpl = async () => { throw new Error('Controlled transport failure'); };
  await assert.rejects(f.client.reserveHardwareBay(bayId, connectorId, 10), /outcome is unknown/);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0][1].method, 'POST');
  assert.deepEqual(JSON.parse(f.calls[0][1].body), { bayId, connectorId, holdMinutes: 10, requestId: operationId });
});

test('hardware snapshots reject ownership, capability, identity, target and time contradictions', async t => {
  const f = await clientFixture(); t.after(f.cleanup); const validate = f.client.isHardwareWorkflowSnapshot;
  assert.equal(validate(snapshot()), true); assert.equal(validate(owned()), true); assert.equal(validate(uncertain()), true);
  const invalid = [
    value => { value.workflows[0].reservation = { id: reservationId, isMine: false, expiresAt: future }; },
    value => { value.workflows[0].capabilities.canRequestRelease = true; },
    value => { value.workflows.push(structuredClone(value.workflows[0])); },
    value => { value.workflows[0].bay.connectors.push(structuredClone(value.workflows[0].bay.connectors[0])); },
    value => { value.workflows[0].operation = { ...uncertain().workflows[0].operation, target: 'lowered' }; },
    value => { value.workflows[0].operation = { ...uncertain().workflows[0].operation, requestedAt: '2026-10-24T12:01:00Z' }; },
    value => { value.workflows[0].operation = { ...uncertain().workflows[0].operation, dispatchedAt: '2026-10-24T11:59:00Z' }; },
    value => { value.commandsEnabled = false; },
  ];
  for (const change of invalid) { const value = snapshot(); change(value); assert.equal(validate(value), false); }
});
