import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { canonicalDirectoryStationIds, isDirectorySlotKey } from '../mobile/src/lib/directory-booking-contract.ts';

// Exercise the real hook with controlled React state/effects and network timing.
// TypeScript is already a mobile dependency; no renderer or new test framework is
// needed. No native modules, environment files, real credentials or APIs load.
const require = createRequire(new URL('../mobile/package.json', import.meta.url));
const ts = require('typescript');
const source = await readFile(new URL('../mobile/src/hooks/use-directory-bookings.ts', import.meta.url), 'utf8');
const fixtureKey = '__bayReadyDirectoryHookFixtures';
globalThis[fixtureKey] = new Map();
let fixtureId = 0;

const slotKey = 'a'.repeat(64);
const reservationId = '11111111-1111-4111-8111-111111111111';
const held = { id: reservationId, stationId: 123, slotKey, status: 'held', createdAt: '2026-10-24T12:00:00Z', expiresAt: '2026-10-24T12:10:00Z' };
const ownHold = { stationId: 123, slotKey, reservedUntil: held.expiresAt, isMine: true, myReservationId: reservationId };
const snapshot = (holds = []) => ({ serverNow: held.createdAt, holds });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const sameDependencies = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));

async function createFixture(stationIds = [123]) {
  const id = ++fixtureId;
  let runner;
  const fixture = {
    readCalls: [], reserveCalls: [], cancelCalls: [],
    readImpl: async () => snapshot(),
    reserveImpl: async () => held,
    cancelImpl: async () => ({ ...held, status: 'cancelled' }),
    timers: new Map(), listeners: new Set(),
  };
  class BookingApiError extends Error {}
  fixture.BookingApiError = BookingApiError;
  fixture.react = {
    useState(initial) {
      const index = runner.cursor++;
      if (!(index in runner.cells)) runner.cells[index] = typeof initial === 'function' ? initial() : initial;
      return [runner.cells[index], value => { runner.cells[index] = typeof value === 'function' ? value(runner.cells[index]) : value; }];
    },
    useRef(initial) {
      const index = runner.cursor++;
      return runner.cells[index] ??= { current: initial };
    },
    useCallback(callback, dependencies) {
      const index = runner.cursor++;
      const previous = runner.cells[index];
      if (previous && sameDependencies(previous.dependencies, dependencies)) return previous.callback;
      runner.cells[index] = { callback, dependencies };
      return callback;
    },
    useEffect(effect, dependencies) {
      const index = runner.cursor++;
      const previous = runner.cells[index];
      if (!previous || !sameDependencies(previous.dependencies, dependencies)) {
        runner.cells[index] = { dependencies, cleanup: previous?.cleanup };
        runner.effects.push(() => { previous?.cleanup?.(); runner.cells[index].cleanup = effect(); });
      }
    },
  };
  fixture.AppState = { currentState: 'active', addEventListener(_name, listener) { fixture.listeners.add(listener); return { remove: () => fixture.listeners.delete(listener) }; } };
  fixture.setInterval = callback => { const key = Symbol('timer'); fixture.timers.set(key, callback); return key; };
  fixture.clearInterval = key => fixture.timers.delete(key);
  fixture.api = {
    BOOKINGS_CONFIGURED: true, BookingApiError,
    fetchDirectoryHolds(ids, signal) { fixture.readCalls.push({ ids, signal }); return fixture.readImpl(ids, signal); },
    reserveDirectoryPlug(stationId, key, minutes) { fixture.reserveCalls.push({ stationId, slotKey: key, minutes }); return fixture.reserveImpl(stationId, key, minutes); },
    cancelDirectoryHold(value) { fixture.cancelCalls.push(value); return fixture.cancelImpl(value); },
  };
  fixture.contract = { canonicalDirectoryStationIds, isDirectorySlotKey };
  globalThis[fixtureKey].set(id, fixture);
  const transformed = source.replace(/import\s*\{([^;]+?)\}\s*from\s*'([^']+)';/g, (statement, _bindings, specifier) => {
    if (specifier === 'react') return 'const { useCallback, useEffect, useRef, useState } = fixture.react;';
    if (specifier === 'react-native') return 'const { AppState } = fixture;';
    if (specifier === '@/lib/bookings-api') return 'const { BOOKINGS_CONFIGURED, BookingApiError, cancelDirectoryHold, fetchDirectoryHolds, reserveDirectoryPlug } = fixture.api;';
    if (specifier === '@/lib/directory-booking-contract') return 'const { canonicalDirectoryStationIds, isDirectorySlotKey } = fixture.contract;';
    return statement;
  });
  const compiled = ts.transpileModule(transformed, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleSource = `const fixture = globalThis.${fixtureKey}.get(${id});\nconst { setInterval, clearInterval } = fixture;\n${compiled}`;
  const { useDirectoryBookings } = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);
  runner = { cursor: 0, cells: [], effects: [], stationIds, value: null };
  fixture.render = (ids = runner.stationIds, runEffects = true) => {
    runner.stationIds = ids;
    runner.cursor = 0;
    runner.value = useDirectoryBookings(ids);
    if (runEffects) fixture.runEffects();
    return runner.value;
  };
  fixture.runEffects = () => { for (const effect of runner.effects.splice(0)) effect(); };
  fixture.settle = async () => {
    for (let tick = 0; tick < 4; tick += 1) { await new Promise(resolve => setImmediate(resolve)); fixture.render(); }
    return runner.value;
  };
  fixture.cleanup = () => {
    for (const cell of runner.cells) cell?.cleanup?.();
    globalThis[fixtureKey].delete(id);
  };
  return fixture;
}

test('viewport changes invalidate availability and actions before effects run', async t => {
  const fixture = await createFixture(); t.after(fixture.cleanup);
  fixture.render();
  let state = await fixture.settle();
  assert.equal(state.fresh, true);
  const nextRead = deferred();
  fixture.readImpl = () => nextRead.promise;
  state = fixture.render([456], false);
  assert.equal(state.fresh, false);
  assert.deepEqual(state.queriedStationIds, [123]);
  assert.equal(await state.reserve(456, slotKey, 10), null);
  assert.equal(fixture.reserveCalls.length, 0);
  fixture.runEffects();
  nextRead.resolve(snapshot());
  state = await fixture.settle();
  assert.equal(state.fresh, true);
  assert.deepEqual(state.queriedStationIds, [456]);
});

test('failed reads never turn retained or missing holds into fresh availability', async t => {
  const fixture = await createFixture(); t.after(fixture.cleanup);
  fixture.readImpl = async () => { throw new fixture.BookingApiError('Read unavailable'); };
  fixture.render();
  let state = await fixture.settle();
  assert.equal(state.fresh, false); assert.equal(state.snapshot, null);
  assert.equal(await state.reserve(123, slotKey, 10), null); assert.equal(fixture.reserveCalls.length, 0);
  fixture.readImpl = async () => snapshot([ownHold]);
  await state.refresh(); state = await fixture.settle(); assert.equal(state.fresh, true);
  fixture.readImpl = async () => { throw new fixture.BookingApiError('Read unavailable'); };
  await state.refresh(); state = await fixture.settle();
  assert.equal(state.fresh, false); assert.deepEqual(state.snapshot.holds, [ownHold]); assert.ok(state.error);
});

test('duplicate reserve taps send one write and reconcile its server hold', async t => {
  const fixture = await createFixture(); t.after(fixture.cleanup);
  fixture.render(); let state = await fixture.settle();
  const write = deferred(); fixture.reserveImpl = () => write.promise;
  const first = state.reserve(123, slotKey, 10);
  assert.equal(await state.reserve(123, slotKey, 10), null);
  assert.equal(fixture.reserveCalls.length, 1);
  assert.deepEqual(fixture.reserveCalls[0], { stationId: 123, slotKey, minutes: 10 });
  fixture.readImpl = async () => snapshot([ownHold]); write.resolve(held);
  assert.deepEqual(await first, held); state = await fixture.settle();
  assert.equal(state.fresh, true); assert.equal(state.busy, false); assert.deepEqual(state.snapshot.holds, [ownHold]);
});

test('unknown write outcomes reconcile without repeating the write', async t => {
  const fixture = await createFixture(); t.after(fixture.cleanup);
  fixture.render(); let state = await fixture.settle();
  fixture.reserveImpl = async () => { throw new fixture.BookingApiError('Reservation outcome unknown'); };
  fixture.readImpl = async () => snapshot([ownHold]);
  assert.equal(await state.reserve(123, slotKey, 10), null);
  state = await fixture.settle();
  assert.equal(fixture.reserveCalls.length, 1); assert.equal(state.fresh, true);
  assert.deepEqual(state.snapshot.holds, [ownHold]); assert.equal(state.error, 'Reservation outcome unknown');
});

test('owned holds outside the viewport remain cancellable without catalog records', async t => {
  const fixture = await createFixture([456]); t.after(fixture.cleanup);
  fixture.readImpl = async () => snapshot([ownHold]);
  fixture.render(); let state = await fixture.settle();
  fixture.cancelImpl = async () => { fixture.readImpl = async () => snapshot(); return { ...held, status: 'cancelled' }; };
  assert.equal(await state.cancel(reservationId), true); state = await fixture.settle();
  assert.deepEqual(fixture.cancelCalls, [reservationId]); assert.deepEqual(state.queriedStationIds, [456]);
  assert.equal(state.fresh, true); assert.deepEqual(state.snapshot.holds, []);
});

test('a viewport change during a write reconciles the latest scope and retains the owned hold', async t => {
  const fixture = await createFixture(); t.after(fixture.cleanup);
  fixture.render(); let state = await fixture.settle();
  const write = deferred(); fixture.reserveImpl = () => write.promise;
  const pending = state.reserve(123, slotKey, 10);
  state = fixture.render([456]); assert.equal(state.fresh, false);
  fixture.readImpl = async () => snapshot([ownHold]); write.resolve(held);
  await pending; state = await fixture.settle();
  assert.deepEqual(fixture.readCalls.at(-1).ids, [456]); assert.deepEqual(state.queriedStationIds, [456]);
  assert.equal(state.fresh, true); assert.deepEqual(state.snapshot.holds, [ownHold]);
});
