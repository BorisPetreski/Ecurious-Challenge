import { randomUUID } from 'node:crypto';
import { HardwareWorkflowError } from './hardware-store.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCK_ID = /^[A-Za-z0-9_-]{1,100}$/;
const PENDING = new Set(['queued', 'claimed']);
const OBSERVE_ONLY = new Set(['dispatching', 'acknowledged', 'uncertain', 'confirmed']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function invalidInput() {
  throw new HardwareWorkflowError('INVALID_INPUT', 'Choose a registered bay/connector, a valid request ID and a 5, 10 or 15 minute hold.', 400);
}

function validateOperation(operation) {
  return record(operation) && UUID.test(operation.id) && UUID.test(operation.bayId) && LOCK_ID.test(operation.lockId) &&
    UUID.test(operation.reservationId) && ['protect', 'entry', 'release'].includes(operation.kind) &&
    ['raised', 'lowered'].includes(operation.target) &&
    (operation.kind === 'protect' ? operation.target === 'raised' : operation.target === 'lowered') &&
    (PENDING.has(operation.status) || OBSERVE_ONLY.has(operation.status)) &&
    (operation.claimToken === null || operation.claimToken === undefined || UUID.test(operation.claimToken));
}

function sameOperation(actual, expected) {
  return validateOperation(actual) && ['id', 'bayId', 'lockId', 'reservationId', 'kind', 'target'].every(key => actual[key] === expected[key]);
}

/** A private worker owns dispatch. No phone-supplied lock ID is ever executed. */
export class HardwareWorkflowService {
  #store;
  #hardware;
  #enabled;
  #allowed;
  #clock;
  #workerId;
  #running = null;
  #timer = null;

  constructor({ store, hardware, commandsEnabled = false, lockIds = [], clock = Date.now, workerId = randomUUID() }) {
    if (!store || !hardware || typeof commandsEnabled !== 'boolean' || !Array.isArray(lockIds) || lockIds.length > 20 ||
      lockIds.some(id => typeof id !== 'string' || !LOCK_ID.test(id)) || !UUID.test(workerId)) {
      throw new HardwareWorkflowError('HARDWARE_CONFIGURATION', 'Check the designated hardware workflow configuration.', 503);
    }
    this.#store = store;
    this.#hardware = hardware;
    this.#enabled = commandsEnabled;
    this.#allowed = new Set(lockIds);
    this.#clock = clock;
    this.#workerId = workerId;
  }

  get configured() { return this.#enabled && this.#allowed.size > 0 && this.#store.configured && this.#hardware.configured; }

  #requireEnabled() {
    if (!this.configured) throw new HardwareWorkflowError('HARDWARE_SETUP_REQUIRED',
      'Designated hardware bookings need the workflow migration, private backend key, assigned lock configuration and explicit command activation.', 503);
  }

  async snapshot(token) {
    if (!this.configured) return {
      source: 'ecurious', commandsEnabled: false, reason: 'HARDWARE_SETUP_REQUIRED',
      serverNow: new Date(this.#clock()).toISOString(), workflows: [], observations: [],
    };
    const result = await this.#store.userRpc('list_hardware_workflows', {}, token);
    if (!record(result) || typeof result.serverNow !== 'string' || !Array.isArray(result.workflows) || result.workflows.length > 100 ||
      result.workflows.some(workflow => !record(workflow) || !record(workflow.bay) || !UUID.test(workflow.bay.id) || !LOCK_ID.test(workflow.bay.lockId))) {
      throw new HardwareWorkflowError('HARDWARE_STORE_RESPONSE', 'The hardware workflow response is invalid. Refresh before taking another action.', 502);
    }
    let observations = [];
    let reason = null;
    try {
      const hardware = await this.#hardware.listLocks();
      observations = hardware.locks.filter(lock => this.#allowed.has(lock.id));
    } catch { reason = 'HARDWARE_OBSERVATION_UNAVAILABLE'; }
    return {
      source: 'ecurious', commandsEnabled: true, reason, serverNow: result.serverNow,
      workflows: result.workflows.filter(workflow => this.#allowed.has(workflow.bay.lockId)), observations,
    };
  }

  async #authorizedBay(token, bayId) {
    this.#requireEnabled();
    if (typeof bayId !== 'string' || !UUID.test(bayId)) invalidInput();
    const workflow = await this.#store.userRpc('get_hardware_workflow', { p_bay_id: bayId }, token);
    if (!record(workflow) || workflow.bay?.id !== bayId || !this.#allowed.has(workflow.bay.lockId)) {
      throw new HardwareWorkflowError('HARDWARE_NOT_ASSIGNED', 'This bay is not enabled on the designated hardware backend.', 409);
    }
    return workflow;
  }

  async reserve(token, body) {
    if (!record(body) || typeof body.connectorId !== 'string' || !UUID.test(body.connectorId) || typeof body.requestId !== 'string' || !UUID.test(body.requestId) || ![5, 10, 15].includes(body.holdMinutes)) invalidInput();
    await this.#authorizedBay(token, body.bayId);
    await this.#store.userRpc('request_hardware_reservation', {
      p_bay_id: body.bayId, p_connector_id: body.connectorId,
      p_hold_minutes: body.holdMinutes, p_request_id: body.requestId,
    }, token);
    // The RPC commits the application intent. Only the worker may dispatch a
    // movement; the HTTP response never claims that movement has completed.
    void this.tick();
    return this.snapshot(token);
  }

  async act(token, body) {
    if (!record(body) || !['entry', 'release'].includes(body.action) || typeof body.reservationId !== 'string' || !UUID.test(body.reservationId)) invalidInput();
    const workflow = await this.#authorizedBay(token, body.bayId);
    if (workflow.reservation?.id !== body.reservationId || !workflow.reservation.isMine) {
      throw new HardwareWorkflowError('RESERVATION_NOT_FOUND', 'Only the owning booking session can request entry or release.', 409);
    }
    await this.#store.userRpc(body.action === 'entry' ? 'request_hardware_entry' : 'request_hardware_release', {
      p_reservation_id: body.reservationId,
    }, token);
    void this.tick();
    return this.snapshot(token);
  }

  start() {
    if (!this.configured || this.#timer) return;
    this.#timer = setInterval(() => { void this.tick(); }, 5_000);
    this.#timer.unref();
    void this.tick();
  }

  stop() { clearInterval(this.#timer); this.#timer = null; }

  /** The database claim, not this process-local guard, prevents double send. */
  async tick() {
    if (!this.configured) return;
    if (this.#running) return this.#running;
    this.#running = this.#run().catch(() => {
      // Do not emit provider bodies, tokens or user input. A failed tick leaves
      // durable pending/uncertain state; another tick may only read dispatched
      // operations, never reclaim or repeat their movement.
    }).finally(() => { this.#running = null; });
    return this.#running;
  }

  async #run() {
    await this.#store.workerRpc('reconcile_hardware_deadlines');
    const result = await this.#store.workerRpc('list_hardware_operations');
    if (!record(result) || !Array.isArray(result.operations) || result.operations.length > 100 || !result.operations.every(validateOperation)) {
      throw new HardwareWorkflowError('HARDWARE_STORE_RESPONSE', 'The hardware operation list is invalid.', 502);
    }
    let assignment;
    try { assignment = await this.#hardware.listLocks(); } catch { return; }
    const assigned = new Set(assignment.locks.map(lock => lock.id));
    for (const operation of result.operations) {
      if (!this.#allowed.has(operation.lockId)) continue;
      try {
        if (PENDING.has(operation.status)) {
          const claimed = await this.#store.workerRpc('claim_hardware_operation', { p_worker_id: this.#workerId, p_operation_id: operation.id });
          if (!claimed) continue;
          if (!sameOperation(claimed, operation) || claimed.status !== 'claimed' || !UUID.test(claimed.claimToken)) continue;
          if (!assigned.has(claimed.lockId)) {
            await this.#result(claimed, 'unknown', null, 'LOCK_NOT_ASSIGNED');
            continue;
          }
          await this.#dispatch(claimed);
        } else if (assigned.has(operation.lockId)) {
          await this.#reconcile(operation);
        }
      } catch {
        // An operation remains recoverable in the database; never turn a
        // transport exception into a new command or a free bay.
      }
    }
  }

  #observation(lock) {
    return {
      p_observed_at: lock?.lastSeenAt ?? null,
      p_barrier: lock?.barrier ?? 'unknown',
      p_occupancy: lock?.occupancy ?? 'unknown',
      p_faulted: !lock || !Array.isArray(lock.activeErrors) || lock.activeErrors.length > 0 || lock.waterIngress === true,
      p_access_mode: lock?.whitelist?.mode ?? 'unknown',
    };
  }

  #preflight(operation, lock) {
    const age = this.#clock() - Date.parse(lock?.lastSeenAt);
    const maximum = Number.isFinite(operation.telemetryMaxAgeMs) ? Math.min(15_000, Math.max(1, operation.telemetryMaxAgeMs)) : 5_000;
    if (!lock?.telemetryFresh || !Number.isFinite(age) || age < 0 || age > maximum || !['raised', 'lowered'].includes(lock.barrier) || lock.occupancy === 'unknown') return 'TELEMETRY_UNKNOWN';
    if (lock.occupancy !== 'vacant') return 'BAY_OCCUPIED';
    if (this.#observation(lock).p_faulted) return 'HARDWARE_FAULT';
    if (operation.kind === 'protect' && lock.whitelist?.mode !== 'disabled') return 'ACCESS_POLICY_UNSAFE';
    return null;
  }

  async #result(operation, outcome, lock = null, reason = null) {
    return this.#store.workerRpc('record_hardware_result', {
      p_operation_id: operation.id, p_claim_token: operation.claimToken ?? null,
      p_outcome: outcome, ...this.#observation(lock), p_reason: reason,
    });
  }

  async #dispatch(operation) {
    let lock;
    try { lock = await this.#hardware.getStatus(operation.lockId); } catch {
      await this.#result(operation, 'unknown', null, 'OBSERVATION_FAILED');
      return;
    }
    const problem = this.#preflight(operation, lock);
    if (problem) {
      await this.#result(operation, problem === 'TELEMETRY_UNKNOWN' ? 'unknown' : 'blocked', lock, problem);
      return;
    }
    if (lock.barrier === operation.target) {
      await this.#result(operation, 'confirmed', lock);
      return;
    }
    // If this call times out, we MUST NOT send: the dispatch permit may have
    // committed. A new worker will reconcile that operation by GET only.
    const dispatched = await this.#store.workerRpc('mark_hardware_dispatch', {
      p_operation_id: operation.id, p_claim_token: operation.claimToken, ...this.#observation(lock),
    });
    if (!sameOperation(dispatched, operation) || dispatched.status !== 'dispatching' || dispatched.claimToken !== operation.claimToken ||
      typeof dispatched.dispatchedAt !== 'string' || !Number.isFinite(Date.parse(dispatched.dispatchedAt))) return;
    try {
      const acknowledgement = operation.target === 'raised'
        ? await this.#hardware.raiseBarrier(operation.lockId) : await this.#hardware.lowerBarrier(operation.lockId);
      if (!record(acknowledgement) || acknowledgement.lockId !== operation.lockId || acknowledgement.requestedBarrier !== operation.target ||
        acknowledgement.acknowledged !== true || acknowledgement.confirmed !== false || typeof acknowledgement.requestedAt !== 'string' ||
        !Number.isFinite(Date.parse(acknowledgement.requestedAt))) throw new Error('Unconfirmed command acknowledgement');
    } catch {
      await this.#result(dispatched, 'uncertain', null, 'COMMAND_RESULT_UNKNOWN');
      return;
    }
    const acknowledged = await this.#result(dispatched, 'acknowledged');
    if (sameOperation(acknowledged, dispatched) && acknowledged.status === 'acknowledged') await this.#reconcile(acknowledged);
  }

  async #reconcile(operation) {
    let lock;
    try { lock = await this.#hardware.getStatus(operation.lockId); } catch {
      if (operation.status !== 'confirmed') await this.#result(operation, 'uncertain', null, 'OBSERVATION_FAILED');
      return;
    }
    const problem = this.#preflight(operation, lock);
    const newerThanDispatch = !operation.dispatchedAt || Date.parse(lock.lastSeenAt) >= Date.parse(operation.dispatchedAt);
    if (operation.status === 'confirmed') {
      // Monitoring confirmed entry never declares a plate match or charging.
      const changed = problem ?? (lock.barrier !== operation.target ? 'TARGET_CHANGED' : null);
      await this.#result(operation, changed ? 'blocked' : 'confirmed', lock, changed);
    } else if (operation.status !== 'acknowledged' && !operation.acknowledgedAt) {
      // A worker might have paused after committing its permit but before POST.
      // Seeing the target does not revoke that still-possible late movement.
      // Without a durably recorded acknowledgement, an operator must first stop
      // dispatchers/in-flight requests before recovery can free this resource.
      await this.#result(operation, 'uncertain', lock, 'OPERATOR_RECOVERY_REQUIRED');
    } else if (!problem && lock.barrier === operation.target && newerThanDispatch) {
      await this.#result(operation, 'confirmed', lock);
    } else {
      await this.#result(operation, 'uncertain', lock, problem ?? (newerThanDispatch ? 'TARGET_NOT_OBSERVED' : 'OBSERVATION_PRECEDES_COMMAND'));
    }
  }
}
