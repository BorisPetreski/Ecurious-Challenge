import { createHmac, timingSafeEqual } from 'node:crypto';
import { HardwareWorkflowError } from './hardware-store.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FINGERPRINT = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const RESERVATION_POLICY = Object.freeze({ currency: 'EUR', mock: true, nowFreeMinutes: 10,
  extensionMinutes: 10, extensionFeeCents: 100, scheduledFeeCents: 100, protectionLeadMinutes: 10 });

function invalid(code = 'INVALID_SLOT') {
  throw new HardwareWorkflowError(code, code === 'INVALID_PLATE' ? 'Add a valid license plate before booking this bay.' :
    'Choose a 5–120 minute window starting within the next seven days, and a registered bay and connector.', 400);
}

export function normalizeBookingPlate(value) {
  if (typeof value !== 'string' || value.length > 64) invalid('INVALID_PLATE');
  const normalized = value.normalize('NFKC').toUpperCase().replace(/[\s\p{Pd}]/gu, '');
  if (!/^[\p{L}\p{N}]{2,15}$/u.test(normalized)) invalid('INVALID_PLATE');
  return normalized;
}

export function reservationQuote(body, now = Date.now()) {
  if (!object(body) || ![body.startsAt, body.endsAt].every(value => typeof value === 'string' && ISO.test(value))) invalid();
  const start = Date.parse(body.startsAt);
  const end = Date.parse(body.endsAt);
  const durationMinutes = (end - start) / 60_000;
  const bookingMode = body.bookingMode ?? 'scheduled';
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(now) || start < now - 60_000 ||
    start > now + 7 * 86_400_000 || durationMinutes < 5 || durationMinutes > 120 || !['now', 'scheduled'].includes(bookingMode) ||
    (bookingMode === 'now' && (durationMinutes !== 10 || start > now + 60_000))) invalid();
  const fixedFeeCents = bookingMode === 'now' ? 0 : RESERVATION_POLICY.scheduledFeeCents;
  return {
    ...RESERVATION_POLICY, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), durationMinutes,
    bookingMode, fixedFeeCents, maxChargeCents: fixedFeeCents,
    protectionStartsAt: new Date(bookingMode === 'now' ? start : Math.max(now, start - 10 * 60_000)).toISOString(),
  };
}

/** Raw plates exist only for this request and private OCR comparison; SQL stores an HMAC. */
export class HardwareSlotService {
  #store;
  #hardware;
  #key;
  #allowed;
  #enabled;
  #clock;

  constructor({ store, hardware, plateHashKey = '', commandsEnabled = false, lockIds = [], clock = Date.now }) {
    this.#store = store;
    this.#hardware = hardware;
    this.#allowed = new Set(lockIds);
    this.#enabled = commandsEnabled;
    this.#clock = clock;
    if (plateHashKey) {
      if (typeof plateHashKey !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(plateHashKey)) {
        throw new HardwareWorkflowError('HARDWARE_CONFIGURATION', 'BAYREADY_PLATE_HASH_KEY must be a stable base64-encoded 32-byte server secret.', 503);
      }
      this.#key = Buffer.from(plateHashKey, 'base64');
      if (this.#key.length !== 32) throw new HardwareWorkflowError('HARDWARE_CONFIGURATION', 'Check the backend plate hashing configuration.', 503);
    }
  }

  get configured() { return this.#enabled && !!this.#key && this.#allowed.size > 0 && this.#store.configured && this.#hardware.configured; }

  #requireEnabled() {
    if (!this.configured) throw new HardwareWorkflowError('HARDWARE_SETUP_REQUIRED',
      'Scheduled hardware bookings need the applied migrations, backend keys, confirmed bay mapping and explicit command activation.', 503);
  }

  #fingerprint(plate) {
    return createHmac('sha256', this.#key).update('bayready:plate:v1\0').update(normalizeBookingPlate(plate)).digest('hex');
  }

  #compare = (plate, expected) => {
    if (typeof expected !== 'string' || !FINGERPRINT.test(expected)) return false;
    try { return timingSafeEqual(Buffer.from(this.#fingerprint(plate), 'hex'), Buffer.from(expected, 'hex')); } catch { return false; }
  };

  quote(body) { return reservationQuote(body, this.#clock()); }

  async snapshot(token, bayId = null) {
    const empty = { configured: false, serverNow: new Date(this.#clock()).toISOString(), slots: [], alternatives: [], policy: RESERVATION_POLICY };
    if (!this.configured) return empty;
    if (bayId !== null && (typeof bayId !== 'string' || !UUID.test(bayId))) invalid();
    const result = await this.#store.userRpc(bayId ? 'list_hardware_slots' : 'list_my_hardware_slots', bayId ? {
      p_bay_id: bayId, p_from: new Date(this.#clock() - 86_400_000).toISOString(),
      p_until: new Date(this.#clock() + 7 * 86_400_000).toISOString(),
    } : {}, token);
    if (!object(result) || !Array.isArray(result.slots) || result.slots.length > 1000 || !Number.isFinite(Date.parse(result.serverNow))) {
      throw new HardwareWorkflowError('HARDWARE_STORE_RESPONSE', 'The time-slot list is invalid. Refresh before booking.', 502);
    }
    const slots = result.slots.map(slot => ({ ...slot, mockFeeCents: slot.isMine ? this.#fee(slot) : null }));
    let alternatives = [];
    const failed = slots.filter(slot => slot.isMine && UUID.test(slot.id) && slot.failureReason === 'LOCATION_FULL')
      .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))[0];
    if (failed) {
      try {
        const offers = await this.#store.workerRpc('list_hardware_booking_alternatives', { p_slot_id: failed.id });
        if (object(offers) && Array.isArray(offers.alternatives)) {
          alternatives = offers.alternatives.filter(item => object(item) && UUID.test(item.locationId) && typeof item.label === 'string' &&
            Number.isFinite(item.latitude) && Number.isFinite(item.longitude) && Number.isFinite(item.distanceKm) && item.distanceKm >= 0 &&
            Number.isSafeInteger(item.availableBays) && item.availableBays > 0 && Array.isArray(item.connectorTypes) && item.connectorTypes.every(type => typeof type === 'string'))
            .slice(0, 3).map(({ locationId, label, latitude, longitude, distanceKm, availableBays, connectorTypes }) =>
              ({ locationId, label, latitude, longitude, distanceKm, availableBays, connectorTypes }));
        }
      } catch { /* The failed booking/refund remains visible when suggestions cannot be read. */ }
    }
    return { configured: true, ...result, slots, alternatives, policy: RESERVATION_POLICY };
  }

  #fee(slot) {
    if (slot.paymentStatus === 'mock_refunded') return 0;
    return Number.isSafeInteger(slot.reservationFeeCents) && slot.reservationFeeCents >= 0 ? slot.reservationFeeCents : 0;
  }

  async reserve(token, body) {
    this.#requireEnabled();
    if (!object(body) || ![body.bayId, body.connectorId, body.requestId].every(value => typeof value === 'string' && UUID.test(value))) invalid();
    const quote = this.quote(body);
    const workflow = await this.#store.userRpc('get_hardware_workflow', { p_bay_id: body.bayId }, token);
    if (workflow?.bay?.id !== body.bayId || !this.#allowed.has(workflow.bay.lockId)) {
      throw new HardwareWorkflowError('HARDWARE_NOT_ASSIGNED', 'This bay is not assigned to the hardware backend.', 409);
    }
    const plate = normalizeBookingPlate(body.licensePlate);
    await this.#store.userRpc('request_hardware_slot', {
      p_bay_id: body.bayId, p_connector_id: body.connectorId, p_starts_at: quote.startsAt, p_ends_at: quote.endsAt,
      p_request_id: body.requestId, p_plate_hash: this.#fingerprint(plate), p_masked_plate: `•••${plate.slice(-2).replace(/[^A-Z0-9]/g, 'X')}`,
      p_booking_mode: quote.bookingMode,
    }, token);
    return this.snapshot(token);
  }

  async cancel(token, body) {
    this.#requireEnabled();
    if (!object(body) || typeof body.slotId !== 'string' || !UUID.test(body.slotId)) invalid();
    await this.#store.userRpc('cancel_hardware_slot', { p_slot_id: body.slotId }, token);
    return this.snapshot(token);
  }

  async extend(token, body) {
    this.#requireEnabled();
    if (!object(body) || ![body.slotId, body.requestId].every(value => typeof value === 'string' && UUID.test(value))) invalid();
    await this.#store.userRpc('request_hardware_slot_extension', { p_slot_id: body.slotId, p_request_id: body.requestId }, token);
    return this.snapshot(token);
  }

  async #unknownObservation(control) {
    if (!object(control) || !UUID.test(control.bayId) || !this.#allowed.has(control.lockId)) return;
    try {
      await this.#store.workerRpc('record_hardware_bay_observation', {
        p_bay_id: control.bayId, p_observed_at: null, p_barrier: 'unknown',
        p_occupancy: 'unknown', p_faulted: true, p_access_mode: 'unknown',
      });
    } catch { /* A database outage cannot free a resource or establish a fee. */ }
  }

  /** Scheduling uses DB time. It queues durable operations; it never directly moves a barrier. */
  async tick() {
    if (!this.configured) return;
    const work = await this.#store.workerRpc('list_hardware_slot_work');
    if (!object(work) || !Array.isArray(work.controls) || !Array.isArray(work.slots) || work.controls.length > 100 || work.slots.length > 100) return;
    let assignment;
    try { assignment = await this.#hardware.listLocks(); } catch {
      for (const control of work.controls) await this.#unknownObservation(control);
      await this.#store.workerRpc('reconcile_hardware_slots');
      return;
    }
    const assigned = new Set(assignment.locks.map(lock => lock.id));
    for (const control of work.controls) {
      if (!object(control) || !UUID.test(control.bayId) || !this.#allowed.has(control.lockId)) continue;
      if (!assigned.has(control.lockId)) { await this.#unknownObservation(control); continue; }
      try {
        const lock = await this.#hardware.getStatus(control.lockId);
        if (lock.id !== control.lockId) { await this.#unknownObservation(control); continue; }
        await this.#store.workerRpc('record_hardware_bay_observation', {
          p_bay_id: control.bayId, p_observed_at: lock.lastSeenAt,
          p_barrier: lock.barrier, p_occupancy: lock.occupancy,
          p_faulted: lock.faultsKnown !== true || !Array.isArray(lock.activeErrors) || lock.activeErrors.length > 0 || lock.waterIngress !== false,
          p_access_mode: lock.whitelist?.mode ?? 'unknown',
        });
        for (const slot of work.slots.filter(slot => slot.bayId === control.bayId)) {
          if (!UUID.test(slot.id) || !FINGERPRINT.test(slot.plateHash) || slot.arrivedAt || slot.status !== 'active' ||
            !Number.isFinite(Date.parse(slot.protectionConfirmedAt))) continue;
          const match = await this.#hardware.getPlateMatch(control.lockId, {
            expectedFingerprint: slot.plateHash, comparePlate: this.#compare, notBefore: slot.protectionConfirmedAt,
          });
          if (match.matched && Number.isFinite(Date.parse(match.timestamp))) {
            try {
              await this.#store.workerRpc('authorize_hardware_plate_entry', {
                p_slot_id: slot.id, p_plate_hash: slot.plateHash, p_recognized_at: match.timestamp,
                p_event_key: createHmac('sha256', this.#key).update(`${slot.id}:${match.timestamp}`).digest('hex'),
              });
            } catch (error) {
              if (!(error instanceof HardwareWorkflowError) || !['HARDWARE_ENTRY_NOT_READY', 'PLATE_NOT_AUTHORIZED', 'PLATE_AUTH_REQUIRED'].includes(error.code)) throw error;
            }
          }
        }
      } catch {
        await this.#unknownObservation(control);
        // No camera event or transport failure proves neither vacancy nor departure.
        // Existing guards remain held; the next tick can read again, never resend.
      }
    }
    // Admission/fallback must use this tick's observations rather than cancel a
    // just-created booking against the previous poll's stale/null sensor facts.
    await this.#store.workerRpc('reconcile_hardware_slots');
  }
}
