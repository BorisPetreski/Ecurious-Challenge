import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulator, DomainError } from '../lib/simulator.mjs';
import { EcuriousAdapter } from '../lib/ecurious-adapter.mjs';

function fixture() {
  let now = Date.parse('2026-10-23T10:00:00.000Z');
  let nextId = 0;
  return {
    simulator: createSimulator({ clock: () => now, idFactory: () => `test-${++nextId}` }),
    advance: milliseconds => { now += milliseconds; },
  };
}

function expectError(run, code, status = 409) {
  assert.throws(run, error => error instanceof DomainError && error.code === code && error.status === status);
}

test('happy path reserves, authorizes, simulates charge, departs and safely releases', () => {
  const { simulator } = fixture();
  const held = simulator.reserve({ plate: 'B-EC 2026' });
  assert.equal(held.reservation.status, 'awaiting-arrival');
  assert.equal(held.reservation.expiresAt, '2026-10-23T10:10:00.000Z');
  assert.equal(held.bay.barrier, 'raised');
  assert.equal(held.capabilities.canReserve, false);
  assert.equal(held.capabilities.canArrive, true);
  const arrived = simulator.action({ action: 'arrive', plate: 'bec2026', confidence: 0.99 });
  assert.equal(arrived.reservation.status, 'authorized');
  assert.equal(arrived.bay.occupied, true);
  assert.equal(arrived.bay.barrier, 'lowered');
  assert.equal(arrived.capabilities.canRelease, false);
  assert.equal(simulator.action({ action: 'start-charge' }).reservation.status, 'charging');
  const departed = simulator.action({ action: 'depart' });
  assert.equal(departed.reservation.status, 'completed');
  assert.equal(departed.bay.occupied, false);
  assert.equal(departed.bay.barrier, 'lowered');
  assert.equal(departed.capabilities.canRelease, true);
  const released = simulator.action({ action: 'release' });
  assert.equal(released.reservation, null);
  assert.equal(released.bay.status, 'free');
  assert.equal(released.bay.barrier, 'raised');
});

test('the injected clock expires only a no-show hold, freeing the empty bay', () => {
  const { simulator, advance } = fixture();
  simulator.reserve({ plate: 'B-EC 2026', holdMinutes: 1 });
  advance(60_000);
  const state = simulator.getState();
  assert.equal(state.reservation, null);
  assert.equal(state.bay.status, 'free');
  assert.equal(state.events[0].type, 'expired');
  assert.equal(state.capabilities.canReserve, true);
});

test('an authorized or charging vehicle is not expired by the arrival deadline', () => {
  const { simulator, advance } = fixture();
  simulator.reserve({ plate: 'B-EC 2026', holdMinutes: 1 });
  simulator.action({ action: 'arrive', plate: 'B-EC 2026' });
  advance(120_000);
  assert.equal(simulator.getState().reservation.status, 'authorized');
  expectError(() => simulator.action({ action: 'expire' }), 'NOT_AWAITING_ARRIVAL');
  simulator.action({ action: 'start-charge' });
  advance(120_000);
  assert.equal(simulator.getState().reservation.status, 'charging');
  expectError(() => simulator.action({ action: 'release' }), 'BAY_OCCUPIED');
  assert.equal(simulator.getState().bay.barrier, 'lowered');
});

test('mismatched plates and low confidence retain the hold without authorizing entry', () => {
  for (const observation of [
    { plate: 'WRONG12', confidence: 0.99, reason: 'plate-mismatch' },
    { plate: 'B-EC 2026', confidence: 0.89, reason: 'low-confidence' },
  ]) {
    const { simulator } = fixture();
    const held = simulator.reserve({ plate: 'B-EC 2026' });
    const denied = simulator.action({ action: 'arrive', ...observation });
    assert.equal(denied.reservation.id, held.reservation.id);
    assert.equal(denied.reservation.status, 'manual-review');
    assert.equal(denied.reservation.reviewReason, observation.reason);
    assert.equal(denied.bay.occupied, false);
    assert.equal(denied.bay.barrier, 'raised');
    assert.equal(denied.capabilities.canStartCharge, false);
    expectError(() => simulator.action({ action: 'start-charge' }), 'NOT_AUTHORIZED');
    const retry = simulator.action({ action: 'arrive', plate: 'B-EC 2026', confidence: 0.9 });
    assert.equal(retry.reservation.status, 'authorized');
    assert.equal(retry.reservation.reviewReason, undefined);
  }
});

test('manual-review no-show still expires instead of holding the bay indefinitely', () => {
  const { simulator } = fixture();
  simulator.reserve({ plate: 'B-EC 2026' });
  simulator.action({ action: 'arrive', plate: 'WRONG12' });
  assert.equal(simulator.action({ action: 'expire' }).reservation, null);
});

test('an occupied bay cannot be reserved, released or used for another arrival', () => {
  const { simulator } = fixture();
  simulator.action({ action: 'block' });
  expectError(() => simulator.reserve({ plate: 'B-EC 2026' }), 'BAY_OCCUPIED');
  expectError(() => simulator.action({ action: 'release' }), 'BAY_OCCUPIED');
  simulator.action({ action: 'clear' });
  simulator.reserve({ plate: 'B-EC 2026' });
  simulator.action({ action: 'block' });
  expectError(() => simulator.action({ action: 'arrive', plate: 'B-EC 2026' }), 'BAY_OCCUPIED');
  expectError(() => simulator.action({ action: 'release' }), 'BAY_OCCUPIED');
  assert.equal(simulator.getState().bay.barrier, 'lowered');
  assert.equal(simulator.getState().reservation.status, 'awaiting-arrival');
  const cleared = simulator.action({ action: 'clear' });
  assert.equal(cleared.bay.barrier, 'raised');
  assert.equal(cleared.reservation.status, 'awaiting-arrival');
});

test('a no-show expiry while occupied waits for the empty sensor before releasing', () => {
  const { simulator } = fixture();
  const held = simulator.reserve({ plate: 'B-EC 2026' });
  simulator.action({ action: 'block' });
  const expired = simulator.action({ action: 'expire' });
  assert.equal(expired.reservation.id, held.reservation.id);
  assert.equal(expired.reservation.status, 'expired-occupied');
  assert.equal(expired.bay.occupied, true);
  assert.equal(expired.bay.barrier, 'lowered');
  assert.equal(expired.capabilities.canRelease, false);
  expectError(() => simulator.action({ action: 'release' }), 'BAY_OCCUPIED');
  const cleared = simulator.action({ action: 'clear' });
  assert.equal(cleared.reservation, null);
  assert.equal(cleared.bay.barrier, 'raised');
});

test('a second reservation is rejected and the first hold is unchanged', () => {
  const { simulator } = fixture();
  const held = simulator.reserve({ plate: 'B-EC 2026' });
  expectError(() => simulator.reserve({ plate: 'SECOND12' }), 'RESERVATION_EXISTS');
  assert.deepEqual(simulator.getState().reservation, held.reservation);
});

test('invalid inputs are rejected before creating or authorizing a reservation', () => {
  const { simulator } = fixture();
  for (const input of [null, [], {}, { plate: '' }, { plate: '<script>' }, { plate: 'A' }, { plate: 'ABCDEFGHIJKLM' },
    { plate: 'VALID12', holdMinutes: 0 }, { plate: 'VALID12', holdMinutes: 31 }, { plate: 'VALID12', holdMinutes: 1.5 },
    { plate: 'VALID12', holdMinutes: '10' }, { plate: 'VALID12', holdMinutes: null }]) {
    expectError(() => simulator.reserve(input), 'INVALID_INPUT', 400);
    assert.equal(simulator.getState().reservation, null);
  }
  simulator.reserve({ plate: 'VALID12' });
  for (const confidence of [-0.1, 1.1, '0.99', Number.NaN, null]) {
    expectError(() => simulator.action({ action: 'arrive', plate: 'VALID12', confidence }), 'INVALID_INPUT', 400);
    assert.equal(simulator.getState().reservation.status, 'awaiting-arrival');
  }
  expectError(() => simulator.action({ action: 'surprise' }), 'INVALID_INPUT', 400);
  expectError(() => simulator.action(null), 'INVALID_INPUT', 400);
});

test('private plates are redacted and returned state cannot mutate internal state', () => {
  const { simulator } = fixture();
  const state = simulator.reserve({ plate: 'SECRET1234' });
  simulator.action({ action: 'arrive', plate: 'UNKNOWN567' });
  const serialized = JSON.stringify(simulator.getState());
  assert.ok(!serialized.includes('SECRET1234'));
  assert.ok(!serialized.includes('UNKNOWN567'));
  assert.equal(state.reservation.maskedPlate, '••••••••34');
  state.reservation.status = 'charging';
  state.events[0].message = 'tampered';
  assert.equal(simulator.getState().reservation.status, 'manual-review');
  assert.ok(!JSON.stringify(simulator.getState()).includes('tampered'));
});

test('event history is bounded and reset replaces the simulated environment', () => {
  const { simulator } = fixture();
  for (let i = 0; i < 30; i++) {
    simulator.action({ action: 'block' });
    simulator.action({ action: 'clear' });
  }
  assert.equal(simulator.getState().events.length, 40);
  simulator.reserve({ plate: 'VALID12' });
  simulator.action({ action: 'arrive', plate: 'VALID12' });
  const reset = simulator.action({ action: 'reset' });
  assert.equal(reset.reservation, null);
  assert.equal(reset.bay.occupied, false);
  assert.equal(reset.bay.barrier, 'raised');
  assert.equal(reset.events.length, 1);
  assert.equal(reset.events[0].type, 'reset');
});

test('live adapter writes fail explicitly while reservations remain simulated', async () => {
  const adapter = new EcuriousAdapter();
  for (const method of ['reserve', 'release']) {
    await assert.rejects(adapter[method](), /not implemented/);
  }
});
