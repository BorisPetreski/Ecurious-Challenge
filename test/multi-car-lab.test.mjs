import test from 'node:test';
import assert from 'node:assert/strict';
import { LabError, MultiCarLab } from '../lib/multi-car-lab.mjs';
import { RESERVATION_POLICY } from '../lib/hardware-slots.mjs';

function fixture() {
  const lab = new MultiCarLab();
  const act = (action, values = {}) => lab.act({ action, ...values });
  const reserve = (carId = 'car-a', bayId = 'bay-1', extra = {}) =>
    act('reserve', { carId, bayId, bookingMode: 'now', ...extra }).bookings.at(-1);
  const bay = id => lab.snapshot().bays.find(item => item.id === id);
  const booking = id => lab.snapshot().bookings.find(item => item.id === id);
  return { lab, act, reserve, bay, booking };
}

test('multi-car lab resets a bounded fictional world and uses the shared pricing/timing policy', () => {
  const { lab, act, reserve } = fixture();
  const initial = lab.snapshot();
  assert.equal(initial.mode, 'simulation');
  assert.equal(initial.now, '2026-10-24T12:40:00.000Z');
  assert.deepEqual(initial.policy, RESERVATION_POLICY);
  assert.equal(initial.cars.length, 3);
  assert.equal(initial.bays.length, 3);
  assert.equal(initial.locations.length, 2);
  assert.equal(initial.bays[0].connectors.length, 2);
  initial.bays[0].barrier = 'raised';
  assert.equal(lab.snapshot().bays[0].barrier, 'lowered', 'snapshot mutations do not change the world');
  reserve();
  act('advance', { minutes: 3 });
  const reset = act('reset');
  assert.equal(reset.now, initial.now);
  assert.equal(reset.bookings.length, 0);
  assert.equal(reset.events.length, 1);
  assert.ok(reset.revision > initial.revision);
});

test('one car owns the entire physical bay, and acknowledgement does not confirm position', () => {
  const { act, reserve, bay, lab } = fixture();
  const held = reserve();
  assert.equal(bay('bay-1').barrier, 'lowered');
  assert.equal(bay('bay-1').pendingCommand.target, 'raised');
  assert.equal(bay('bay-1').activeBookingId, held.id);
  assert.throws(() => reserve('car-b'), error => error instanceof LabError && error.code === 'BAY_ALREADY_BOOKED');
  assert.equal(lab.snapshot().bookings.length, 1);
  act('observe', { bayId: 'bay-1' });
  assert.equal(bay('bay-1').barrier, 'raised');
  assert.equal(bay('bay-1').pendingCommand, null);
  assert.ok(Date.parse(bay('bay-1').observedAt) > Date.parse(held.protectionStartsAt));
});

test('wrong/uncertain scans cannot admit a car, matching scan is not occupancy, and arrival survives no-show expiry', () => {
  const { act, reserve, bay, booking } = fixture();
  const held = reserve();
  act('observe', { bayId: 'bay-1' });
  for (const [carId, confidence] of [['car-b', 0.99], ['car-a', 0.5]]) {
    act('scan', { carId, bayId: 'bay-1', confidence });
    assert.equal(booking(held.id).entryAuthorizedAt, null);
    assert.equal(bay('bay-1').barrier, 'raised');
    assert.equal(bay('bay-1').pendingCommand, null);
  }
  act('scan', { carId: 'car-a', bayId: 'bay-1', confidence: 0.99 });
  assert.equal(booking(held.id).arrivedAt, null);
  assert.equal(bay('bay-1').occupantCarId, null);
  assert.throws(() => act('park', { carId: 'car-a', bayId: 'bay-1' }), { code: 'ENTRY_NOT_AUTHORIZED' });
  act('observe', { bayId: 'bay-1' });
  assert.throws(() => act('park', { carId: 'car-b', bayId: 'bay-1' }), { code: 'ENTRY_NOT_AUTHORIZED' });
  act('advance', { minutes: 11 });
  assert.equal(booking(held.id).status, 'entry_authorized');
  act('park', { carId: 'car-a', bayId: 'bay-1' });
  act('advance', { minutes: 60 });
  assert.equal(booking(held.id).status, 'arrived');
  act('depart', { carId: 'car-a' });
  assert.equal(bay('bay-1').activeBookingId, held.id);
  act('observe', { bayId: 'bay-1' });
  assert.equal(booking(held.id).status, 'completed');
  assert.equal(bay('bay-1').activeBookingId, null);
});

test('no-show cleanup cannot free or move an occupied bay', () => {
  const { act, reserve, bay, booking } = fixture();
  const held = reserve();
  act('observe', { bayId: 'bay-1' });
  act('block', { carId: 'car-c', bayId: 'bay-1' });
  act('advance', { minutes: 10 });
  assert.equal(booking(held.id).status, 'cleanup-blocked');
  assert.equal(bay('bay-1').pendingCommand, null);
  assert.equal(bay('bay-1').activeBookingId, held.id);
  assert.equal(bay('bay-1').barrier, 'raised');
  act('clear', { bayId: 'bay-1' });
  assert.equal(bay('bay-1').pendingCommand.target, 'lowered');
  assert.equal(bay('bay-1').activeBookingId, held.id);
  act('observe', { bayId: 'bay-1' });
  assert.equal(booking(held.id).status, 'expired');
  assert.equal(bay('bay-1').status, 'available');
});

test('future booking permits an earlier non-overlapping car, while extension cannot take its window', () => {
  const { act, reserve, bay, booking } = fixture();
  const future = reserve('car-a', 'bay-1', { bookingMode: 'scheduled', arrivalMinutesFromNow: 20 });
  assert.equal(bay('bay-1').activeBookingId, null);
  assert.equal(bay('bay-1').pendingCommand, null);
  const earlier = reserve('car-b');
  assert.throws(() => act('extend', { bookingId: earlier.id, carId: 'car-b' }), { code: 'EXTENSION_CONFLICT' });
  assert.equal(booking(earlier.id).mockFeeCents, 0);
  assert.equal(booking(future.id).mockFeeCents, 100);
  assert.throws(() => act('extend', { bookingId: earlier.id, carId: 'car-c' }), { code: 'BOOKING_NOT_OWNED' });
});

test('scheduled and immediate holds can both extend before their unmatched deadline', () => {
  for (const bookingMode of ['now', 'scheduled']) {
    const { act, reserve, booking } = fixture();
    const held = reserve('car-a', 'bay-1', { bookingMode, ...(bookingMode === 'scheduled' ? { arrivalMinutesFromNow: 20 } : {}) });
    act('extend', { bookingId: held.id, carId: 'car-a' });
    assert.equal(Date.parse(booking(held.id).deadlineAt), Date.parse(held.deadlineAt) + 10 * 60_000);
    assert.equal(booking(held.id).mockFeeCents, held.mockFeeCents + 100);
    if (bookingMode === 'scheduled') act('advance', { minutes: 10 });
    act('observe', { bayId: 'bay-1' });
    act('scan', { carId: 'car-a', bayId: 'bay-1', confidence: 0.99 });
    assert.throws(() => act('extend', { bookingId: held.id, carId: 'car-a' }), { code: 'EXTENSION_CLOSED' });
  }
});

test('all seven deterministic scenarios finish with passing, nonempty checks', () => {
  const lab = new MultiCarLab();
  for (const { id } of lab.snapshot().scenarios) {
    const result = lab.runScenario(id);
    assert.equal(result.scenarioId, id);
    assert.ok(result.checks.length > 0, id);
    assert.ok(result.checks.every(check => check.passed), id);
    assert.equal(result.events[0].type, 'scenario-complete');
  }
});

test('a manual action clears historical scenario assertions, while a refused action preserves them', () => {
  const lab = new MultiCarLab();
  lab.runScenario('race');
  assert.throws(() => lab.act({ action: 'advance', minutes: 0 }), { code: 'INVALID_LAB_ACTION' });
  assert.ok(lab.snapshot().checks.length > 0);
  assert.equal(lab.snapshot().scenarioId, 'race');
  const changed = lab.act({ action: 'advance', minutes: 1 });
  assert.equal(changed.checks.length, 0);
  assert.equal(changed.scenarioId, null);
});

test('untrusted controls cannot import raw plates or unbounded state, and snapshots have no credential fields', () => {
  const { act, lab } = fixture();
  for (const body of [null, [], { action: '__proto__' }, { action: 'constructor' }, { action: 'reset', licensePlate: 'M-DEMO-42' },
    { action: 'advance', minutes: 181 }, { action: 'scan', carId: 'car-a', bayId: 'bay-1', confidence: Infinity },
    { action: 'reserve', carId: 'driver-from-profile', bayId: 'bay-1', bookingMode: 'now' }]) {
    assert.throws(() => lab.act(body), error => error instanceof LabError && error.status === 400);
  }
  for (let i = 0; i < 100; i++) act('advance', { minutes: 1 });
  assert.ok(lab.snapshot().events.length <= 80);
  const serialized = JSON.stringify(lab.snapshot());
  for (const forbidden of ['licensePlate', 'apiKey', 'accessToken', 'M-DEMO-42', 'cameraImage']) assert.ok(!serialized.includes(forbidden));
});
