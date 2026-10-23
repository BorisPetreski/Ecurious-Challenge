import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const MAX_EVENTS = 40;
const MIN_CONFIDENCE = 0.9;
const WAITING = new Set(['awaiting-arrival', 'manual-review']);
const ACTIONS = new Set(['arrive', 'start-charge', 'depart', 'release', 'block', 'clear', 'expire', 'reset']);

export class DomainError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
  }
}

function invalid(message) {
  throw new DomainError('INVALID_INPUT', message, 400);
}

function objectInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('A JSON object is required.');
}

function normalizePlate(plate) {
  if (typeof plate !== 'string' || plate.length > 20 || !/^[a-zA-Z0-9 -]+$/.test(plate)) {
    invalid('Plate must contain 2–12 letters or numbers; spaces and hyphens are allowed.');
  }
  const normalized = plate.toUpperCase().replace(/[ -]/g, '');
  if (normalized.length < 2 || normalized.length > 12) {
    invalid('Plate must contain 2–12 letters or numbers; spaces and hyphens are allowed.');
  }
  return normalized;
}

function maskedPlate(plate) {
  const visibleCharacters = Math.min(2, plate.length - 1);
  return `${'•'.repeat(Math.max(2, plate.length - visibleCharacters))}${plate.slice(-visibleCharacters)}`;
}

/**
 * Local, synchronous state machine. The clock is injectable for deterministic
 * testing. Only the simulated clock is advanced by the explicit expire action.
 * Private plate data never appears in state, events, errors or server logs.
 *
 * Arrival recognition is a camera observation before entry. A recognized vehicle
 * lowers the simulated barrier before the simulated bay sensor becomes occupied.
 * These events are UI controls, not authenticated hardware observations. A live
 * system needs a trusted sensor/event feed and command acknowledgement recovery.
 */
export function createSimulator({ clock = Date.now, idFactory = randomUUID } = {}) {
  let timeOffset = 0;
  let reservation = null;
  let sessionKey = randomBytes(32);
  let privatePlateFingerprint = null;
  let occupied = false;
  let occupancyKind = null;
  let barrier = 'raised';
  let events = [];

  const timestamp = () => new Date(clock() + timeOffset).toISOString();
  const fingerprint = plate => createHmac('sha256', sessionKey).update(plate).digest();

  function addEvent(type, message) {
    events.unshift({ id: idFactory(), at: timestamp(), type, message });
    events = events.slice(0, MAX_EVENTS);
  }

  function raiseWhenEmpty() {
    if (occupied) throw new DomainError('BAY_OCCUPIED', 'The barrier cannot be raised while the bay is occupied.');
    barrier = 'raised';
  }

  function removeReservation() {
    raiseWhenEmpty();
    reservation = null;
    privatePlateFingerprint = null;
  }

  function reconcileExpiration() {
    if (!reservation) return;
    const waiting = WAITING.has(reservation.status);
    const expiredBlocked = reservation.status === 'expired-occupied';
    if ((!waiting && !expiredBlocked) || timestamp() < reservation.expiresAt) return;
    if (occupied) {
      if (!expiredBlocked) {
        reservation.status = 'expired-occupied';
        addEvent('expiry-blocked', 'The hold expired while a vehicle occupies the bay. Release waits for an empty sensor.');
      }
      return;
    }
    removeReservation();
    addEvent('expired', 'The arrival hold expired and the empty bay was released safely.');
  }

  function bayStatus() {
    if (occupancyKind === 'external') return 'blocked';
    if (reservation?.status === 'charging') return 'charging';
    if (occupied) return 'occupied';
    if (reservation?.status === 'completed') return 'awaiting-release';
    return reservation ? 'reserved' : 'free';
  }

  function getState() {
    reconcileExpiration();
    const awaitingArrival = Boolean(reservation && WAITING.has(reservation.status));
    return {
      mode: 'mock',
      now: timestamp(),
      bay: {
        id: 'demo-bay-1',
        label: 'Demo charging bay',
        status: bayStatus(),
        occupied,
        barrier,
      },
      reservation: reservation ? { ...reservation } : null,
      events: events.map(event => ({ ...event })),
      capabilities: {
        canReserve: !reservation && !occupied,
        canArrive: awaitingArrival && !occupied,
        canStartCharge: reservation?.status === 'authorized' && occupied && occupancyKind === 'reservation',
        canDepart: occupied && occupancyKind === 'reservation',
        canRelease: Boolean(reservation) && !occupied,
        canBlock: !occupied,
        canClear: occupied && occupancyKind === 'external',
        canExpire: awaitingArrival,
        canReset: true,
      },
    };
  }

  function reserve(input) {
    objectInput(input);
    const plate = normalizePlate(input.plate);
    const holdMinutes = input.holdMinutes === undefined ? 10 : input.holdMinutes;
    if (!Number.isInteger(holdMinutes) || holdMinutes < 1 || holdMinutes > 30) {
      invalid('Hold duration must be a whole number from 1 to 30 minutes.');
    }
    reconcileExpiration();
    if (occupied) throw new DomainError('BAY_OCCUPIED', 'A reservation requires an empty bay.');
    if (reservation) throw new DomainError('RESERVATION_EXISTS', 'This bay already has an active reservation.');
    raiseWhenEmpty();
    privatePlateFingerprint = fingerprint(plate);
    reservation = {
      id: idFactory(),
      status: 'awaiting-arrival',
      maskedPlate: maskedPlate(plate),
      createdAt: timestamp(),
      expiresAt: new Date(clock() + timeOffset + holdMinutes * 60_000).toISOString(),
    };
    addEvent('reserved', `The empty bay is held for ${holdMinutes} minute${holdMinutes === 1 ? '' : 's'}.`);
    return getState();
  }

  function action(input) {
    objectInput(input);
    if (!ACTIONS.has(input.action)) invalid('Unknown simulator action.');
    // Validate recognition inputs before processing an observation or changing state.
    let observedPlate;
    let confidence;
    if (input.action === 'arrive') {
      observedPlate = normalizePlate(input.plate);
      confidence = input.confidence === undefined ? 0.99 : input.confidence;
      if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        invalid('Confidence must be a number from 0 to 1.');
      }
    }
    reconcileExpiration();

    switch (input.action) {
      case 'arrive': {
        if (!reservation || !WAITING.has(reservation.status)) {
          throw new DomainError('NOT_AWAITING_ARRIVAL', 'An active arrival hold is required.');
        }
        if (occupied) throw new DomainError('BAY_OCCUPIED', 'Entry cannot be authorized while the bay is occupied.');
        if (confidence < MIN_CONFIDENCE || !timingSafeEqual(fingerprint(observedPlate), privatePlateFingerprint)) {
          const reason = confidence < MIN_CONFIDENCE ? 'low-confidence' : 'plate-mismatch';
          reservation.status = 'manual-review';
          reservation.reviewReason = reason;
          addEvent('manual-review', reason === 'low-confidence'
            ? 'Recognition confidence is below the demo threshold of 90%. Entry remains unauthorized.'
            : 'The observed plate did not match the reservation. Entry remains unauthorized.');
          break;
        }
        barrier = 'lowered';
        occupied = true;
        occupancyKind = 'reservation';
        reservation.status = 'authorized';
        reservation.arrivedAt = timestamp();
        delete reservation.reviewReason;
        addEvent('authorized', 'The reserved vehicle matched with sufficient confidence. The simulated barrier lowered and the bay became occupied.');
        break;
      }
      case 'start-charge':
        if (reservation?.status !== 'authorized' || !occupied || occupancyKind !== 'reservation') {
          throw new DomainError('NOT_AUTHORIZED', 'Charging simulation requires the authorized vehicle in the bay.');
        }
        reservation.status = 'charging';
        reservation.startedAt = timestamp();
        // This is a local state transition, not an EVSE power-delivery command.
        addEvent('charging', 'Local charging simulation started. No physical charger or power delivery is controlled.');
        break;
      case 'depart':
        if (!occupied || occupancyKind !== 'reservation' || !reservation) {
          throw new DomainError('NO_RESERVED_VEHICLE', 'There is no authorized vehicle in the bay to depart.');
        }
        occupied = false;
        occupancyKind = null;
        reservation.status = 'completed';
        reservation.completedAt = timestamp();
        addEvent('departed', 'The reserved vehicle departed and the simulated bay sensor is empty. Release is now safe.');
        break;
      case 'release':
        if (occupied) throw new DomainError('BAY_OCCUPIED', 'Release is blocked until the bay sensor is empty.');
        if (!reservation) throw new DomainError('NO_RESERVATION', 'There is no active reservation to release.');
        removeReservation();
        addEvent('released', 'The empty bay was released and the simulated barrier raised.');
        break;
      case 'block':
        if (occupied) throw new DomainError('BAY_OCCUPIED', 'The simulated bay is already occupied.');
        // An unrelated arrival is a sensor obstruction, never plate authorization.
        barrier = 'lowered';
        occupied = true;
        occupancyKind = 'external';
        addEvent('blocked', 'An unrelated vehicle occupies the simulated bay. Reservation and barrier release are interlocked.');
        break;
      case 'clear':
        if (!occupied || occupancyKind !== 'external') {
          throw new DomainError('NO_BLOCKING_VEHICLE', 'There is no unrelated blocking vehicle to clear.');
        }
        occupied = false;
        occupancyKind = null;
        addEvent('cleared', 'The unrelated vehicle left and the simulated bay sensor is empty.');
        if (!reservation || WAITING.has(reservation.status) || reservation.status === 'expired-occupied') raiseWhenEmpty();
        reconcileExpiration();
        break;
      case 'expire':
        if (!reservation || !WAITING.has(reservation.status)) {
          throw new DomainError('NOT_AWAITING_ARRIVAL', 'Only a hold awaiting arrival can be expired.');
        }
        timeOffset = Date.parse(reservation.expiresAt) - clock() + 1;
        addEvent('clock-advanced', 'The local simulator clock advanced past the arrival hold deadline.');
        reconcileExpiration();
        break;
      case 'reset':
        // Reset replaces the entire simulated environment; no hardware is driven.
        occupied = false;
        occupancyKind = null;
        reservation = null;
        privatePlateFingerprint = null;
        sessionKey = randomBytes(32);
        barrier = 'raised';
        timeOffset = 0;
        events = [];
        addEvent('reset', 'The local simulation was reset to an empty bay.');
        break;
    }
    return getState();
  }

  addEvent('ready', 'Local mock simulator ready. No live Ecurious hardware is connected.');
  return { getState, reserve, action };
}
