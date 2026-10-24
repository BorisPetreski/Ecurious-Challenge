import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { EcuriousAdapter } from '../lib/ecurious-adapter.mjs';
import { HardwareSlotService, normalizeBookingPlate } from '../lib/hardware-slots.mjs';
import { HardwareWorkflowService } from '../lib/hardware-workflow.mjs';

const NOW = Date.parse('2026-10-24T12:00:00.000Z');
const LOCK = 'fictional-native-camera-lock';
const PLATE = 'M-DEMO-42';
const OTHER_PLATE = 'M-DEMO-99';
const API_KEY = 'fictional_native_ocr_provider_key';
const HASH_KEY = Buffer.alloc(32, 9);
const BAY = '50000000-0000-4000-8000-000000000001';
const CONNECTOR = '50000000-0000-4000-8000-000000000002';
const SLOT = '50000000-0000-4000-8000-000000000003';
const REQUEST = '50000000-0000-4000-8000-000000000004';
const OPERATION = '50000000-0000-4000-8000-000000000005';
const CLAIM = '50000000-0000-4000-8000-000000000006';
const WORKER = '50000000-0000-4000-8000-000000000007';
const iso = value => new Date(value).toISOString();
const clone = value => structuredClone(value);
const fingerprint = plate => createHmac('sha256', HASH_KEY).update('bayready:plate:v1\0').update(normalizeBookingPlate(plate)).digest('hex');
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

/**
 * Actual adapter and workers; fictional transport and atomic-permit store only.
 * No Supabase client, environment files, sockets, camera frames or live commands.
 */
function fixture({ observedPlate = PLATE, observedAt = NOW - 1_000, missingRecognition = false } = {}) {
  const state = {
    now: NOW, observedPlate, observedAt, missingRecognition, requests: [], calls: [], operation: null,
    provider: { barrier: 'raised', carPresence: 'vacant', lastSeenAt: iso(NOW - 100), whitelist: [] },
    slot: { id: SLOT, bayId: BAY, lockId: LOCK, connectorId: CONNECTOR, status: 'active', isMine: true,
      startsAt: iso(NOW), endsAt: iso(NOW + 10 * 60_000), protectionDeadlineAt: iso(NOW + 10 * 60_000),
      protectionConfirmedAt: iso(NOW - 5_000), entryAuthorizedAt: null, arrivedAt: null },
  };
  const providerLock = () => ({
    id: LOCK, name: 'Fictional native-camera bay', hasCamera: true, status: state.provider.barrier,
    carPresence: state.provider.carPresence, lastSeenAt: state.provider.lastSeenAt,
    whitelist: state.provider.whitelist, activeErrors: [], waterIngress: false,
  });
  const hardware = new EcuriousAdapter({ apiKey: API_KEY, baseUrl: 'https://native-ocr.example.invalid', clock: () => state.now,
    async fetchImpl(input, options) {
      const url = new URL(input);
      assert.equal(url.origin, 'https://native-ocr.example.invalid');
      assert.equal(options.headers['X-API-Key'], API_KEY);
      assert.equal(options.redirect, 'error');
      // Deliberately record only method/path; request bodies may contain private
      // plate policy data and are checked transiently below, never projected.
      state.requests.push({ method: options.method, path: url.pathname });
      if (url.pathname === '/api/v1/locks' && options.method === 'GET') return json({ team: 'Fictional team', locks: [providerLock()] });
      if (url.pathname === `/api/v1/locks/${LOCK}` && options.method === 'GET') return json({ lock: providerLock() });
      if (url.pathname === `/api/v1/locks/${LOCK}/plate/latest` && options.method === 'GET') {
        if (state.missingRecognition) return json({ error: 'No recognition yet' }, 404);
        // Built-in endpoint has no required confidence field. Do not fabricate one.
        return json({ lockId: LOCK, timestamp: iso(state.observedAt), licensePlate: state.observedPlate });
      }
      if (url.pathname === `/api/v1/locks/${LOCK}/whitelist` && options.method === 'POST') {
        const body = JSON.parse(options.body);
        assert.deepEqual(Object.keys(body), ['plates']);
        assert.ok(JSON.stringify(body) === JSON.stringify({ plates: [normalizeBookingPlate(PLATE)] }) || JSON.stringify(body) === JSON.stringify({ plates: [] }));
        state.provider.whitelist = clone(body.plates);
        return json({ success: true, whitelist: clone(body.plates) });
      }
      if (url.pathname === `/api/v1/locks/${LOCK}/unlock` && options.method === 'POST') {
        assert.deepEqual(JSON.parse(options.body), { cancelAutoLift: false });
        // A successful POST is still only an acknowledgement. The separate GET
        // supplies a strictly newer sensor timestamp for the guarded worker.
        state.now += 100;
        state.provider.barrier = 'lowered';
        state.provider.lastSeenAt = iso(state.now);
        return json({ success: true, result: { success: true, deviceStatus: 0 } });
      }
      assert.fail(`Unexpected mocked provider route: ${options.method} ${url.pathname}`);
    },
  });
  const store = { configured: true,
    async userRpc(name, args, _token) {
      state.calls.push({ name, args: clone(args) });
      if (name === 'get_hardware_workflow') return { bay: { id: BAY, lockId: LOCK } };
      if (name === 'request_hardware_slot') { state.slot.plateHash = args.p_plate_hash; return { slot: clone(state.slot) }; }
      if (name === 'list_my_hardware_slots') return { serverNow: iso(state.now), slots: [clone(state.slot)] };
      assert.fail(`Unexpected mocked caller RPC: ${name}`);
    },
    async workerRpc(name, args = {}) {
      state.calls.push({ name, args: clone(args) });
      switch (name) {
        case 'list_hardware_slot_work': return { controls: [{ bayId: BAY, lockId: LOCK }], slots: [clone(state.slot)] };
        case 'record_hardware_bay_observation':
        case 'reconcile_hardware_slots':
        case 'reconcile_hardware_deadlines': return {};
        case 'authorize_hardware_plate_entry':
          state.slot.entryAuthorizedAt = args.p_recognized_at;
          state.operation = {
            id: OPERATION, bayId: BAY, reservationId: REQUEST, lockId: LOCK, kind: 'entry', target: 'lowered', status: 'queued',
            requestedAt: iso(state.now), claimToken: null, dispatchedAt: null, acknowledgedAt: null,
            telemetryMaxAgeMs: 5_000, controlsEnabled: true, interlocksConfirmed: true,
          };
          return { bay: { id: BAY }, phase: 'entry_pending' };
        case 'list_hardware_operations': return { operations: state.operation ? [clone(state.operation)] : [] };
        case 'claim_hardware_operation':
          if (state.operation.status !== 'queued') return null;
          state.operation.status = 'claimed'; state.operation.claimToken = CLAIM;
          return clone(state.operation);
        case 'mark_hardware_dispatch':
          state.operation.status = 'dispatching'; state.operation.dispatchedAt = iso(state.now);
          return clone(state.operation);
        case 'record_hardware_result':
          state.operation.status = args.p_outcome;
          if (args.p_outcome === 'acknowledged') state.operation.acknowledgedAt = iso(state.now);
          return clone(state.operation);
        default: assert.fail(`Unexpected mocked worker RPC: ${name}`);
      }
    },
  };
  const slots = new HardwareSlotService({ store, hardware, plateHashKey: HASH_KEY.toString('base64'), commandsEnabled: true,
    lockIds: [LOCK], clock: () => state.now });
  const workflow = new HardwareWorkflowService({ store, hardware, slots, commandsEnabled: true, lockIds: [LOCK],
    clock: () => state.now, workerId: WORKER });
  const reserve = () => slots.reserve('fictional.driver.signature', {
    bayId: BAY, connectorId: CONNECTOR, requestId: REQUEST, bookingMode: 'now',
    startsAt: iso(NOW), endsAt: iso(NOW + 10 * 60_000), licensePlate: PLATE,
  });
  return { state, hardware, slots, workflow, reserve };
}

test('native Ecurious OCR JSON reaches the real slot worker, with wrong, stale, future and 404 observations denied', async t => {
  for (const [label, options, expected] of [
    ['wrong vehicle', { observedPlate: OTHER_PLATE }, false],
    ['before protection', { observedAt: NOW - 5_001 }, false],
    ['same as protection', { observedAt: NOW - 5_000 }, false],
    ['future observation', { observedAt: NOW + 1 }, false],
    ['no recognition yet', { missingRecognition: true }, false],
    ['correct newer vehicle', {}, true],
  ]) await t.test(label, async () => {
    const { state, slots, reserve } = fixture(options);
    const snapshot = await reserve();
    await slots.tick();
    const authorized = state.calls.filter(call => call.name === 'authorize_hardware_plate_entry');
    assert.equal(authorized.length, expected ? 1 : 0);
    assert.ok(state.requests.some(request => request.path.endsWith('/plate/latest')));
    assert.ok(state.requests.every(request => request.method === 'GET'), 'the slot scheduler queues intents and sends no provider writes');
    assert.equal(state.slot.arrivedAt, null, 'OCR and missing OCR do not establish occupancy or departure');
    assert.ok(!state.calls.some(call => /cancel|release/.test(call.name)));
    for (const privateValue of [PLATE, normalizeBookingPlate(PLATE), OTHER_PLATE, API_KEY]) {
      assert.ok(!JSON.stringify({ snapshot, calls: state.calls }).includes(privateValue));
    }
    if (expected) {
      assert.equal(authorized[0].args.p_slot_id, SLOT);
      assert.equal(authorized[0].args.p_plate_hash, fingerprint(PLATE));
      assert.equal(authorized[0].args.p_recognized_at, iso(NOW - 1_000));
      assert.match(authorized[0].args.p_event_key, /^[0-9a-f]{64}$/);
      assert.ok(!Object.hasOwn(authorized[0].args, 'confidence'));
    }
  });
});

test('native OCR authorization flows through the guarded worker to one mocked unlock, ACK and newer sensor confirmation', async () => {
  const { state, workflow, reserve } = fixture();
  await reserve();
  await workflow.tick();
  const posts = () => state.requests.filter(request => request.method === 'POST');
  assert.deepEqual(posts(), [{ method: 'POST', path: `/api/v1/locks/${LOCK}/unlock` }]);
  assert.equal(state.operation.status, 'confirmed');
  const results = state.calls.filter(call => call.name === 'record_hardware_result');
  assert.equal(results[0].args.p_outcome, 'acknowledged');
  assert.equal(results[0].args.p_barrier, 'unknown', 'the ACK itself is not a sensor reading');
  assert.equal(results[1].args.p_outcome, 'confirmed');
  assert.equal(results[1].args.p_barrier, 'lowered');
  assert.ok(Date.parse(results[1].args.p_observed_at) > Date.parse(state.operation.dispatchedAt));
  assert.equal(state.slot.arrivedAt, null, 'entry confirmation does not invent a parked car or charging session');
  await workflow.tick();
  assert.equal(posts().length, 1, 'observing a completed operation never re-sends its command');
  assert.equal(state.calls.filter(call => call.name === 'authorize_hardware_plate_entry').length, 1);
  assert.ok(!state.requests.some(request => request.path.endsWith('/whitelist')), 'guarded software lowering is not mixed with plate-triggered auto-access');
});

test('native whitelist writes use exact plate lists, return ACK only, and never inject an OCR observation or move the barrier', async () => {
  const { state, hardware } = fixture({ observedPlate: OTHER_PLATE });
  const expectedFingerprint = fingerprint(PLATE);
  const comparePlate = (observed, expected) => fingerprint(observed) === expected;
  const access = await hardware.setPlateAccess(LOCK, normalizeBookingPlate(PLATE));
  assert.deepEqual(access, { lockId: LOCK, requestedAccess: 'specific-plates', acknowledged: true, confirmed: false, requestedAt: iso(NOW) });
  assert.deepEqual(await hardware.getPlateAccessMatch(LOCK, { expectedFingerprint, comparePlate }), {
    lockId: LOCK, accessMode: 'specific-plates', matched: true, observedAt: iso(NOW - 100),
  });
  assert.equal((await hardware.getPlateMatch(LOCK, { expectedFingerprint, comparePlate, notBefore: iso(NOW - 5_000) })).matched, false,
    'whitelisting the expected car does not change the different car most recently read by the camera');
  const removed = await hardware.clearPlateAccess(LOCK);
  assert.equal(removed.acknowledged, true);
  assert.equal(removed.confirmed, false);
  const checked = await hardware.getPlateAccessMatch(LOCK, { expectedFingerprint, comparePlate });
  assert.deepEqual(checked, { lockId: LOCK, accessMode: 'disabled', matched: false, observedAt: iso(NOW - 100) });
  assert.equal(state.provider.barrier, 'raised');
  assert.deepEqual(state.requests.filter(request => request.method === 'POST'), [
    { method: 'POST', path: `/api/v1/locks/${LOCK}/whitelist` }, { method: 'POST', path: `/api/v1/locks/${LOCK}/whitelist` },
  ]);
  for (const privateValue of [PLATE, normalizeBookingPlate(PLATE), OTHER_PLATE, expectedFingerprint, API_KEY]) {
    assert.ok(!JSON.stringify({ access, removed, checked }).includes(privateValue));
  }
});
