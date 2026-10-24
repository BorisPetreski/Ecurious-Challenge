import test from 'node:test';
import assert from 'node:assert/strict';
import { HardwareSlotService, normalizeBookingPlate, reservationQuote, RESERVATION_POLICY } from '../lib/hardware-slots.mjs';

const NOW = Date.parse('2026-10-24T12:00:00.000Z');
const BAY = '40000000-0000-4000-8000-000000000001';
const CONNECTOR = '40000000-0000-4000-8000-000000000002';
const REQUEST = '40000000-0000-4000-8000-000000000003';
const SLOT = '40000000-0000-4000-8000-000000000004';
const KEY = Buffer.alloc(32, 7).toString('base64');
const WINDOW = { startsAt: '2026-10-24T12:00:00.000Z', endsAt: '2026-10-24T12:30:00.000Z' };
const body = { ...WINDOW, bayId: BAY, connectorId: CONNECTOR, requestId: REQUEST, licensePlate: 'M-DEMO-42' };

function fixture(options = {}) {
  const calls = [];
  let hash;
  const slot = { id: SLOT, bayId: BAY, connectorId: CONNECTOR, status: 'active', isMine: true,
    ...WINDOW, protectionConfirmedAt: '2026-10-24T11:40:00Z', arrivedAt: null, billingWaived: false };
  const store = { configured: true,
    async userRpc(name, args, token) {
      calls.push({ role: 'user', name, args, token });
      if (name === 'get_hardware_workflow') return { bay: { id: BAY, lockId: options.lockId ?? 'fictional-slot-lock' } };
      if (name === 'request_hardware_slot') { hash = args.p_plate_hash; return { slot }; }
      return { serverNow: new Date(NOW).toISOString(), slots: [slot] };
    },
    async workerRpc(name, args) {
      calls.push({ role: 'worker', name, args });
      if (name === 'list_hardware_slot_work') return {
        controls: [{ bayId: BAY, lockId: 'fictional-slot-lock' }],
        slots: [{ ...slot, plateHash: hash }],
      };
      return {};
    },
  };
  const hardware = { configured: true,
    async listLocks() { return { locks: [{ id: 'fictional-slot-lock' }] }; },
    async getStatus() { return { id: 'fictional-slot-lock', lastSeenAt: new Date(NOW).toISOString(), barrier: 'raised',
      occupancy: 'vacant', faultsKnown: true, activeErrors: [], waterIngress: false, whitelist: { mode: 'disabled' } }; },
    async getPlateMatch(_id, { expectedFingerprint, comparePlate, notBefore }) {
      assert.equal(expectedFingerprint, hash);
      assert.equal(notBefore, slot.protectionConfirmedAt);
      return { matched: comparePlate(options.ocrPlate ?? 'M DEMO 42', expectedFingerprint), timestamp: new Date(NOW).toISOString() };
    },
    async raiseBarrier() { assert.fail('The slot scheduler must never send a physical command.'); },
    async lowerBarrier() { assert.fail('The slot scheduler must never send a physical command.'); },
  };
  const service = new HardwareSlotService({ store, hardware, plateHashKey: KEY, commandsEnabled: true,
    lockIds: ['fictional-slot-lock'], clock: () => NOW, ...options });
  return { service, calls, slot, hardware };
}

test('quotes distinguish free ten-minute reservations from fixed-fee scheduled protection', () => {
  assert.deepEqual(reservationQuote(WINDOW, NOW), { ...WINDOW, ...RESERVATION_POLICY, durationMinutes: 30,
    bookingMode: 'scheduled', fixedFeeCents: 100, maxChargeCents: 100, protectionStartsAt: WINDOW.startsAt });
  assert.equal(reservationQuote({ ...WINDOW, bookingMode: 'now', endsAt: '2026-10-24T12:10:00Z' }, NOW).fixedFeeCents, 0);
  assert.equal(reservationQuote({ bookingMode: 'scheduled', startsAt: '2026-10-24T13:00:00Z', endsAt: '2026-10-24T13:30:00Z' }, NOW).protectionStartsAt, '2026-10-24T12:50:00.000Z');
  for (const bad of [
    { ...WINDOW, startsAt: '2026-10-24' },
    { ...WINDOW, startsAt: '2026-10-24T11:58:59Z' },
    { ...WINDOW, endsAt: '2026-10-24T12:04:59Z' },
    { ...WINDOW, endsAt: '2026-10-24T14:00:01Z' },
    { startsAt: '2026-11-01T12:00:00Z', endsAt: '2026-11-01T12:30:00Z' },
  ]) assert.throws(() => reservationQuote(bad, NOW), { code: 'INVALID_SLOT' });
});

test('booking persists only a stable keyed plate fingerprint, UTC window and masked suffix', async () => {
  const { service, calls } = fixture();
  await service.reserve('guest.jwt.signature', body);
  await service.reserve('guest.jwt.signature', { ...body, licensePlate: 'm demo 42' });
  const writes = calls.filter(call => call.name === 'request_hardware_slot');
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0], writes[1], 'Idempotent requests produce the same hash, mask and interval.');
  assert.match(writes[0].args.p_plate_hash, /^[0-9a-f]{64}$/);
  assert.equal(writes[0].args.p_masked_plate, '•••42');
  assert.ok(!JSON.stringify(calls).includes('M-DEMO-42'));
  assert.equal(normalizeBookingPlate('Ｍ demo 42'), 'MDEMO42');
  for (const value of ['', 'X', 'M/DEMO/42', 'A'.repeat(100), null]) assert.throws(() => normalizeBookingPlate(value), { code: 'INVALID_PLATE' });
});

test('camera matching authorizes only the expected plate through private RPC, never barrier commands', async () => {
  const { service, calls } = fixture();
  await service.reserve('guest.jwt.signature', body);
  await service.tick();
  const authorization = calls.find(call => call.name === 'authorize_hardware_plate_entry');
  assert.equal(authorization.role, 'worker');
  assert.equal(authorization.args.p_slot_id, SLOT);
  assert.match(authorization.args.p_event_key, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(calls).includes('MDEMO42'));
  const wrong = fixture({ ocrPlate: 'M-DEMO-99' });
  await wrong.service.reserve('guest.jwt.signature', body);
  await wrong.service.tick();
  assert.equal(wrong.calls.some(call => call.name === 'authorize_hardware_plate_entry'), false);
});

test('a missing camera event does not declare departure or free a booking', async () => {
  const { service, calls, hardware } = fixture();
  hardware.getPlateMatch = async () => ({ timestamp: null, matched: false });
  await service.reserve('guest.jwt.signature', body);
  await service.tick();
  assert.equal(calls.filter(call => call.name === 'record_hardware_bay_observation').length, 1);
  assert.equal(calls.some(call => call.name === 'authorize_hardware_plate_entry'), false);
  assert.equal(calls.some(call => call.name === 'cancel_hardware_slot'), false);
});

test('failed status and assignment reads record uncertainty to waive mock fees, never vacancy', async () => {
  for (const method of ['getStatus', 'listLocks']) {
    const { service, hardware, calls } = fixture();
    await service.reserve('guest.jwt.signature', body);
    hardware[method] = async () => { throw new Error('fictional provider failure'); };
    await service.tick();
    const observation = calls.find(call => call.name === 'record_hardware_bay_observation');
    assert.deepEqual(observation.args, { p_bay_id: BAY, p_observed_at: null, p_barrier: 'unknown',
      p_occupancy: 'unknown', p_faulted: true, p_access_mode: 'unknown' });
    assert.equal(calls.some(call => call.name === 'authorize_hardware_plate_entry'), false);
  }
});

test('unassigned bays cannot schedule and disabled workflows do no database work', async () => {
  const foreign = fixture({ lockId: 'fictional-foreign-lock' });
  await assert.rejects(foreign.service.reserve('guest.jwt.signature', body), { code: 'HARDWARE_NOT_ASSIGNED' });
  assert.equal(foreign.calls.some(call => call.name === 'request_hardware_slot'), false);
  const disabled = fixture({ commandsEnabled: false });
  assert.equal((await disabled.service.snapshot()).configured, false);
  await disabled.service.tick();
  assert.equal(disabled.calls.length, 0);
});

test('reservation fees are fixed mock charges with explicit refunds', async () => {
  const { service, slot, calls } = fixture();
  slot.reservationFeeCents = 100;
  slot.paymentStatus = 'mock_paid';
  assert.equal((await service.snapshot('guest.jwt.signature')).slots[0].mockFeeCents, 100);
  slot.paymentStatus = 'mock_refunded';
  assert.equal((await service.snapshot('guest.jwt.signature')).slots[0].mockFeeCents, 0);
  await service.extend('guest.jwt.signature', { slotId: SLOT, requestId: REQUEST });
  assert.deepEqual(calls.find(call => call.name === 'request_hardware_slot_extension').args,
    { p_slot_id: SLOT, p_request_id: REQUEST });
});
