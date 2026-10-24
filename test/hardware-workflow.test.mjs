import test from 'node:test';
import assert from 'node:assert/strict';
import { HardwareWorkflowService } from '../lib/hardware-workflow.mjs';
import { HardwareWorkflowError } from '../lib/hardware-store.mjs';

const NOW = Date.parse('2026-10-24T12:00:00.000Z');
const IDS = {
  operation: '10000000-0000-4000-8000-000000000001',
  bay: '10000000-0000-4000-8000-000000000002',
  reservation: '10000000-0000-4000-8000-000000000003',
  connector: '10000000-0000-4000-8000-000000000004',
  claim: '10000000-0000-4000-8000-000000000005',
  worker1: '10000000-0000-4000-8000-000000000006',
  worker2: '10000000-0000-4000-8000-000000000007',
  request: '10000000-0000-4000-8000-000000000008',
};
const LOCK = 'fictional-lock-1';
const TOKEN = 'fictional.user.signature';
const iso = value => new Date(value).toISOString();
const clone = value => structuredClone(value);
const initialOperation = (overrides = {}) => ({
  id: IDS.operation, bayId: IDS.bay, reservationId: IDS.reservation,
  lockId: LOCK, kind: 'protect', target: 'raised', status: 'queued',
  requestedAt: iso(NOW - 2_000),
  claimToken: null, dispatchedAt: null, acknowledgedAt: null,
  telemetryMaxAgeMs: 5_000, controlsEnabled: true, interlocksConfirmed: true,
  ...overrides,
});

/** An atomic fake permit store, not a hardware simulator or SQL replacement. */
function fixture({ operation = {}, observation, onCommand, onMark, onRecord } = {}) {
  const state = { operation: initialOperation(operation), now: NOW, posts: 0, reads: 0, records: [], calls: [], claims: 0 };
  const currentLock = overrides => ({
    id: LOCK, telemetryFresh: true, lastSeenAt: iso(state.now - 1),
    barrier: 'lowered', occupancy: 'vacant', faultsKnown: true, activeErrors: [], waterIngress: false,
    whitelist: { mode: 'disabled' }, ...overrides,
  });
  const store = {
    configured: true,
    async workerRpc(name, args = {}) {
      state.calls.push({ name, args: clone(args) });
      switch (name) {
        case 'reconcile_hardware_deadlines': return null;
        case 'list_hardware_operations': return { operations: [clone(state.operation)] };
        case 'claim_hardware_operation': {
          if (state.operation.status !== 'queued') return null;
          state.claims++;
          state.operation = { ...state.operation, status: 'claimed', claimToken: IDS.claim };
          return clone(state.operation);
        }
        case 'mark_hardware_dispatch': {
          state.operation = { ...state.operation, status: 'dispatching', dispatchedAt: iso(state.now) };
          return onMark ? onMark(state, args) : clone(state.operation);
        }
        case 'record_hardware_result': {
          state.records.push(clone(args));
          const status = args.p_outcome === 'unknown' || args.p_outcome === 'blocked' ? 'uncertain' : args.p_outcome;
          state.operation = {
            ...state.operation, status,
            acknowledgedAt: args.p_outcome === 'acknowledged' ? iso(state.now) : state.operation.acknowledgedAt,
          };
          return onRecord ? onRecord(state, args) : clone(state.operation);
        }
        default: throw new Error(`Unexpected fake worker RPC: ${name}`);
      }
    },
    async userRpc(name, args, token) {
      state.calls.push({ name, args: clone(args), token });
      if (name === 'get_hardware_workflow') return { bay: { id: IDS.bay, lockId: LOCK }, reservation: { id: IDS.reservation, isMine: true } };
      if (name === 'list_hardware_workflows') return { serverNow: iso(state.now), workflows: [] };
      return null;
    },
  };
  const command = async target => {
    state.posts++;
    const requestedAt = iso(state.now);
    state.now += 100;
    if (onCommand) return onCommand(state, target);
    return { lockId: LOCK, requestedBarrier: target, acknowledged: true, confirmed: false, requestedAt };
  };
  const hardware = {
    configured: true,
    async listLocks() { return { locks: [{ id: LOCK }] }; },
    async getStatus() {
      state.reads++;
      return currentLock(observation ? observation(state) : { barrier: state.posts ? state.operation.target : 'lowered' });
    },
    raiseBarrier: () => command('raised'), lowerBarrier: () => command('lowered'),
  };
  const service = workerId => new HardwareWorkflowService({ store, hardware, commandsEnabled: true, lockIds: [LOCK], clock: () => state.now, workerId });
  return { state, store, hardware, service };
}

test('two workers competing for one durable claim send exactly one movement', async () => {
  const { state, service } = fixture();
  await Promise.all([service(IDS.worker1).tick(), service(IDS.worker2).tick()]);
  assert.equal(state.claims, 1);
  assert.equal(state.posts, 1);
  assert.equal(state.operation.status, 'confirmed');
});

test('a committed dispatch permit whose RPC response times out causes no POST and no automatic redispatch', async () => {
  const { state, service } = fixture({ onMark: () => { throw new HardwareWorkflowError('HARDWARE_STORE_TIMEOUT', 'Unknown dispatch result.', 504); } });
  const worker = service(IDS.worker1);
  await worker.tick();
  assert.equal(state.operation.status, 'dispatching');
  assert.equal(state.posts, 0);
  await worker.tick();
  assert.equal(state.posts, 0);
  assert.ok(state.records.every(item => item.p_outcome !== 'confirmed'));
  assert.equal(state.records.at(-1).p_reason, 'OPERATOR_RECOVERY_REQUIRED');
});

test('a command timeout stays quarantined even when a later GET matches the target', async () => {
  const { state, service } = fixture({ onCommand: () => { throw new Error('Fictional command timeout'); } });
  const worker = service(IDS.worker1);
  await worker.tick();
  assert.equal(state.posts, 1);
  assert.equal(state.operation.status, 'uncertain');
  assert.equal(state.operation.acknowledgedAt, null);
  await worker.tick();
  assert.equal(state.posts, 1);
  assert.ok(state.records.every(item => item.p_outcome !== 'confirmed'));
  assert.equal(state.records.at(-1).p_reason, 'OPERATOR_RECOVERY_REQUIRED');
});

test('a fresh target report cannot free a dispatching operation with no persisted acknowledgement', async () => {
  const { state, service } = fixture({ operation: { status: 'dispatching', dispatchedAt: iso(NOW - 100), claimToken: IDS.claim }, observation: () => ({ barrier: 'raised' }) });
  await service(IDS.worker1).tick();
  assert.equal(state.posts, 0);
  assert.ok(state.records.every(item => item.p_outcome !== 'confirmed'));
  assert.equal(state.records.at(-1).p_reason, 'OPERATOR_RECOVERY_REQUIRED');
});

test('a command acknowledgement requires a newer target observation to confirm', async t => {
  for (const [name, offset, confirms] of [['older cached target', -1, false], ['equal timestamp', 0, false], ['newer observation', 1, true]]) {
    await t.test(name, async () => {
      const { state, service } = fixture({ observation: current => current.posts
        ? { barrier: 'raised', lastSeenAt: iso(NOW + offset) }
        : { barrier: 'lowered', lastSeenAt: iso(NOW - 1_000) } });
      await service(IDS.worker1).tick();
      assert.equal(state.posts, 1);
      assert.equal(state.records.some(item => item.p_outcome === 'confirmed'), confirms);
      assert.equal(state.operation.status, confirms ? 'confirmed' : 'uncertain');
    });
  }
});

test('persisted acknowledgement survives failed polling and allows later read-only confirmation', async () => {
  const { state, service } = fixture({ operation: { status: 'uncertain', dispatchedAt: iso(NOW - 100), acknowledgedAt: iso(NOW - 50), claimToken: IDS.claim }, observation: () => ({ barrier: 'raised' }) });
  await service(IDS.worker1).tick();
  assert.equal(state.posts, 0);
  assert.equal(state.records.at(-1).p_outcome, 'confirmed');
});

test('acknowledged entry can observe an open occupied bay without claiming a new movement or plate match', async () => {
  const { state, service } = fixture({
    operation: { kind: 'entry', target: 'lowered', status: 'acknowledged', dispatchedAt: iso(NOW - 100), acknowledgedAt: iso(NOW - 50), claimToken: IDS.claim },
    observation: () => ({ barrier: 'lowered', occupancy: 'occupied' }),
  });
  await service(IDS.worker1).tick();
  assert.equal(state.posts, 0);
  assert.equal(state.records.at(-1).p_outcome, 'confirmed');
  assert.equal(state.records.at(-1).p_occupancy, 'occupied');
  assert.ok(!JSON.stringify(state.records).includes('licensePlate'));
});

test('an occupied bay cannot complete release even with a persisted acknowledgement and lowered barrier', async () => {
  const { state, service } = fixture({
    operation: { kind: 'release', target: 'lowered', status: 'acknowledged', dispatchedAt: iso(NOW - 100), acknowledgedAt: iso(NOW - 50), claimToken: IDS.claim },
    observation: () => ({ barrier: 'lowered', occupancy: 'occupied' }),
  });
  await service(IDS.worker1).tick();
  assert.equal(state.posts, 0);
  assert.ok(state.records.every(item => item.p_outcome !== 'confirmed'));
  assert.equal(state.records.at(-1).p_reason, 'BAY_OCCUPIED');
});

test('invalid dispatch/acknowledgement timestamps cannot establish command completion', async () => {
  for (const operation of [
    { status: 'acknowledged', dispatchedAt: null, acknowledgedAt: iso(NOW - 50) },
    { status: 'uncertain', dispatchedAt: iso(NOW - 100), acknowledgedAt: 'invalid timestamp' },
  ]) {
    const { state, service } = fixture({ operation, observation: () => ({ barrier: 'raised' }) });
    await service(IDS.worker1).tick();
    assert.equal(state.posts, 0);
    assert.ok(state.records.every(item => item.p_outcome !== 'confirmed'));
  }
});

test('unknown, occupied, stale, faulted or unsafe-access preflight never obtains a dispatch permit', async t => {
  const cases = [
    ['unknown occupancy', { occupancy: 'unknown' }, 'TELEMETRY_UNKNOWN'],
    ['occupied', { occupancy: 'occupied' }, 'BAY_OCCUPIED'],
    ['stale', { lastSeenAt: iso(NOW - 5_001) }, 'TELEMETRY_UNKNOWN'],
    ['future timestamp', { lastSeenAt: iso(NOW + 1) }, 'TELEMETRY_UNKNOWN'],
    ['another lock observation', { id: 'another-fictional-lock' }, 'TELEMETRY_UNKNOWN'],
    ['faulted', { activeErrors: ['MOTOR_LOWERING_STALL'] }, 'HARDWARE_FAULT'],
    ['unknown fault telemetry', { faultsKnown: false }, 'HARDWARE_FAULT'],
    ['water ingress', { waterIngress: true }, 'HARDWARE_FAULT'],
    ['unknown water ingress', { waterIngress: null }, 'HARDWARE_FAULT'],
    ['wildcard access', { whitelist: { mode: 'any-plate' } }, 'ACCESS_POLICY_UNSAFE'],
    ['specific-plate access', { whitelist: { mode: 'specific-plates' } }, 'ACCESS_POLICY_UNSAFE'],
  ];
  for (const [name, observation, reason] of cases) await t.test(name, async () => {
    const { state, service } = fixture({ observation: () => observation });
    await service(IDS.worker1).tick();
    assert.equal(state.posts, 0);
    assert.equal(state.calls.filter(call => call.name === 'mark_hardware_dispatch').length, 0);
    assert.equal(state.records.at(-1).p_reason, reason);
  });
});

test('a malformed or mismatched permit cannot send a movement', async () => {
  for (const change of [{ target: 'lowered', kind: 'entry' }, { claimToken: IDS.worker2 }, { dispatchedAt: null }]) {
    const { state, service } = fixture({ onMark: current => ({ ...current.operation, ...change }) });
    await service(IDS.worker1).tick();
    assert.equal(state.posts, 0);
  }
});

test('an observation that ages out while waiting for its dispatch permit cannot authorize movement', async () => {
  const { state, service } = fixture({ onMark: current => {
    current.now += 6_000;
    return clone(current.operation);
  } });
  await service(IDS.worker1).tick();
  assert.equal(state.posts, 0);
  assert.notEqual(state.operation.status, 'confirmed');
});

test('stopping a worker while its dispatch permit is in flight prevents a late POST', async () => {
  let worker;
  const { state, service } = fixture({ onMark: current => {
    worker.stop();
    return clone(current.operation);
  } });
  worker = service(IDS.worker1);
  await worker.tick();
  assert.equal(state.posts, 0);
  assert.equal(worker.configured, false);
  assert.notEqual(state.operation.status, 'confirmed');
  assert.equal(state.records.at(-1).p_reason, 'DISPATCHER_STOPPED');
  await worker.tick();
  assert.equal(state.posts, 0);
});

test('a resolved malformed adapter acknowledgement remains uncertain', async () => {
  for (const acknowledgement of [undefined, { acknowledged: true }, { lockId: LOCK, requestedBarrier: 'raised', acknowledged: true, confirmed: true, requestedAt: iso(NOW) }]) {
    const { state, service } = fixture({ onCommand: () => acknowledgement });
    await service(IDS.worker1).tick();
    assert.equal(state.posts, 1);
    assert.equal(state.operation.status, 'uncertain');
    assert.ok(state.records.every(item => item.p_outcome !== 'confirmed'));
  }
});

test('only the backend-designated and provider-assigned lock may dispatch', async () => {
  const excluded = fixture();
  await new HardwareWorkflowService({ store: excluded.store, hardware: excluded.hardware, commandsEnabled: true, lockIds: ['another-fictional-lock'] }).tick();
  assert.equal(excluded.state.posts, 0);
  const unassigned = fixture();
  unassigned.hardware.listLocks = async () => ({ locks: [] });
  await unassigned.service(IDS.worker1).tick();
  assert.equal(unassigned.state.posts, 0);
  assert.equal(unassigned.state.records.at(-1).p_reason, 'LOCK_NOT_ASSIGNED');
});

test('phone intent stores only registered identities and requires reservation ownership', async () => {
  const { store, hardware, state } = fixture();
  // Disable hardware enumeration so the asynchronous tick cannot dispatch.
  hardware.listLocks = async () => { throw new Error('Offline fictional hardware'); };
  const worker = new HardwareWorkflowService({ store, hardware, commandsEnabled: true, lockIds: [LOCK] });
  await worker.reserve(TOKEN, { bayId: IDS.bay, connectorId: IDS.connector, requestId: IDS.request, holdMinutes: 10, lockId: 'untrusted-phone-lock' });
  const intent = state.calls.find(call => call.name === 'request_hardware_reservation');
  assert.equal(intent.token, TOKEN);
  assert.deepEqual(intent.args, { p_bay_id: IDS.bay, p_connector_id: IDS.connector, p_hold_minutes: 10, p_request_id: IDS.request });
  store.userRpc = async () => ({ bay: { id: IDS.bay, lockId: LOCK }, reservation: { id: IDS.reservation, isMine: false } });
  await assert.rejects(() => worker.act(TOKEN, { bayId: IDS.bay, reservationId: IDS.reservation, action: 'release' }), error => error.code === 'RESERVATION_NOT_FOUND');
  assert.equal(state.posts, 0);
});
