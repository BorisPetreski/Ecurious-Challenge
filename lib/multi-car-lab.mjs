import { RESERVATION_POLICY } from './hardware-slots.mjs';

const MINUTE = 60_000;
const BASE_TIME = Date.parse('2026-10-24T12:40:00.000Z');
const TERMINAL = new Set(['completed', 'expired', 'refunded']);
const CARS = Object.freeze([
  { id: 'car-a', label: 'Car A', maskedPlate: '••••A1' },
  { id: 'car-b', label: 'Car B', maskedPlate: '••••B2' },
  { id: 'car-c', label: 'Car C', maskedPlate: '••••C3' },
]);
const LOCATIONS = Object.freeze([
  { id: 'location-a', label: 'Fictional Central Hub', distanceKm: 0 },
  { id: 'location-b', label: 'Fictional Nearby Hub', distanceKm: 0.8 },
]);
const SCENARIOS = Object.freeze([
  { id: 'race', label: 'Two drivers, one bay', description: 'The first hold wins; a competing driver cannot overwrite it.' },
  { id: 'plate-check', label: 'Wrong car / uncertain scan', description: 'Wrong and low-confidence car observations do not lower the barrier.' },
  { id: 'no-show', label: 'No-show and safe release', description: 'Expiry requests cleanup; only a vacant, lowered observation releases the bay.' },
  { id: 'extension', label: 'Add ten minutes', description: 'A mock €1 extension moves the deadline and prevents the original expiry.' },
  { id: 'scheduled-window', label: '15:00 arrival', description: 'The bay stays usable before 14:50, is protected at 14:50 and expires at 15:10.' },
  { id: 'blocked-fallback', label: 'Blocked bay → another bay', description: 'At activation an occupied bay switches to another compatible physical bay.' },
  { id: 'full-refund', label: 'Full hub → refund and nearby hub', description: 'If both bays are occupied, refund the mock fee and suggest the nearby hub.' },
]);
const FIELDS = {
  reset: [], advance: ['minutes'], reserve: ['carId', 'bayId', 'bookingMode', 'arrivalMinutesFromNow'],
  extend: ['bookingId', 'carId'], scan: ['carId', 'bayId', 'confidence'], park: ['carId', 'bayId'],
  depart: ['carId'], block: ['carId', 'bayId'], clear: ['bayId'], observe: ['bayId'], scenario: ['scenarioId'],
};

export class LabError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = 'LabError';
    this.code = code;
    this.status = status;
  }
}

function requireInput(condition, message = 'Choose one of the lab controls and its listed fictional cars or bays.') {
  if (!condition) throw new LabError('INVALID_LAB_ACTION', message, 400);
}

/**
 * One bounded, synchronous, fictional world. It deliberately has no database,
 * credentials, real plate data, hardware adapter or payment integration. Actions
 * rehearse invariants; they do not prove production concurrency or physical safety.
 */
export class MultiCarLab {
  #base;
  #now;
  #revision = 0;
  #sequence = 0;
  #bookingSequence = 0;
  #bays = [];
  #bookings = [];
  #events = [];
  #checks = [];
  #scenarioId = null;
  #runningScenario = false;

  constructor({ now = BASE_TIME } = {}) {
    const parsed = typeof now === 'string' ? Date.parse(now) : now;
    requireInput(Number.isFinite(parsed) && Number.isFinite(new Date(parsed).getTime()), 'Use a valid simulation start time.');
    this.#base = parsed;
    this.#reset();
  }

  #iso(value = this.#now) { return new Date(value).toISOString(); }
  #event(type, message) {
    this.#events.unshift({ id: `event-${++this.#sequence}`, at: this.#iso(), type, message });
    this.#events.length = Math.min(this.#events.length, 80);
  }
  #car(id) {
    const car = CARS.find(item => item.id === id);
    requireInput(Boolean(car));
    return car;
  }
  #bay(id) {
    const bay = this.#bays.find(item => item.id === id);
    requireInput(Boolean(bay));
    return bay;
  }
  #booking(id, carId) {
    this.#car(carId);
    const booking = this.#bookings.find(item => item.id === id && item.carId === carId && !TERMINAL.has(item.status));
    if (!booking) throw new LabError('BOOKING_NOT_OWNED', 'Only this booking’s fictional driver can change it.');
    return booking;
  }
  #active(bay) { return this.#bookings.find(item => item.id === bay.activeBookingId && !TERMINAL.has(item.status)); }
  #overlap(bayId, from, until, exceptId = null) {
    return this.#bookings.some(item => item.id !== exceptId && item.bayId === bayId && !TERMINAL.has(item.status) &&
      Date.parse(item.protectionStartsAt) < until && Date.parse(item.deadlineAt) > from);
  }
  #reset() {
    this.#now = this.#base;
    this.#sequence = 0;
    this.#bookingSequence = 0;
    this.#bookings = [];
    this.#events = [];
    this.#checks = [];
    this.#scenarioId = null;
    this.#bays = ['bay-1', 'bay-2', 'bay-3'].map((id, index) => ({
      id, label: `Bay ${index + 1}`, locationId: index < 2 ? 'location-a' : 'location-b',
      connectors: [{ id: `${id}-ccs`, type: 'CCS', powerKw: 150 },
        ...(index === 0 ? [{ id: `${id}-type2`, type: 'Type 2', powerKw: 22 }] : [])],
      occupantCarId: null, barrier: 'lowered', observedAt: this.#iso(), pendingCommand: null, activeBookingId: null,
    }));
    this.#revision++;
    this.#event('reset', 'Fictional world reset: three cars, three vacant bays and no real commands or charges.');
  }

  snapshot() {
    return structuredClone({
      mode: 'simulation', revision: this.#revision, now: this.#iso(), policy: RESERVATION_POLICY,
      scenarioId: this.#scenarioId, cars: CARS, locations: LOCATIONS,
      bays: this.#bays.map(bay => ({ ...bay, status: bay.occupantCarId
        ? (this.#active(bay)?.arrivedAt ? 'occupied' : 'blocked')
        : this.#active(bay)?.status ?? (bay.pendingCommand ? 'awaiting-observation' : 'available') })),
      bookings: this.#bookings, events: this.#events, scenarios: SCENARIOS, checks: this.#checks,
    });
  }

  act(body) {
    requireInput(body !== null && typeof body === 'object' && !Array.isArray(body));
    const allowed = typeof body.action === 'string' && Object.hasOwn(FIELDS, body.action) ? FIELDS[body.action] : null;
    requireInput(Boolean(allowed) && Object.keys(body).every(key => key === 'action' || allowed.includes(key)));
    if (body.action === 'scenario') return this.runScenario(body.scenarioId);
    if (body.action === 'reset') { this.#reset(); return this.snapshot(); }
    if (body.action === 'advance') {
      requireInput(Number.isInteger(body.minutes) && body.minutes >= 1 && body.minutes <= 180, 'Advance the fictional clock by 1–180 whole minutes.');
      requireInput(this.#now + body.minutes * MINUTE <= this.#base + 7 * 86_400_000, 'Reset the lab before simulating more than seven days.');
      for (let minute = 0; minute < body.minutes; minute++) { this.#now += MINUTE; this.#reconcile(); }
      this.#event('clock', 'The fictional clock advanced.');
    } else if (body.action === 'reserve') this.#reserve(body);
    else if (body.action === 'extend') this.#extend(body);
    else if (body.action === 'scan') this.#scan(body);
    else if (body.action === 'observe') this.#observe(this.#bay(body.bayId));
    else if (body.action === 'park') this.#park(body);
    else if (body.action === 'depart') this.#depart(body.carId);
    else if (body.action === 'block') this.#block(body);
    else if (body.action === 'clear') this.#clear(this.#bay(body.bayId));
    if (!this.#runningScenario) { this.#checks = []; this.#scenarioId = null; }
    this.#revision++;
    return this.snapshot();
  }

  #reserve({ carId, bayId, bookingMode, arrivalMinutesFromNow }) {
    this.#car(carId);
    this.#bay(bayId);
    requireInput(['now', 'scheduled'].includes(bookingMode));
    requireInput(bookingMode === 'scheduled' ? Number.isInteger(arrivalMinutesFromNow) && arrivalMinutesFromNow >= 1 && arrivalMinutesFromNow <= 7 * 24 * 60
      : arrivalMinutesFromNow === undefined, 'Scheduled arrival must be 1 minute to 7 days from the fictional clock.');
    if (this.#bookings.some(item => item.carId === carId && !TERMINAL.has(item.status))) {
      throw new LabError('CAR_ALREADY_BOOKED', 'This car already has a live lab booking. Use another fictional car or finish its current booking.');
    }
    const start = this.#now + (bookingMode === 'scheduled' ? arrivalMinutesFromNow * MINUTE : 0);
    const from = bookingMode === 'now' ? start : Math.max(this.#now, start - RESERVATION_POLICY.protectionLeadMinutes * MINUTE);
    const until = start + RESERVATION_POLICY.arrivalGraceMinutes * MINUTE;
    if (this.#overlap(bayId, from, until)) throw new LabError('BAY_ALREADY_BOOKED', 'Another car already owns this physical bay for that protection window.');
    if (this.#bookings.length >= 60) this.#bookings = this.#bookings.filter(item => !TERMINAL.has(item.status));
    if (this.#bookings.length >= 60) throw new LabError('LAB_CAPACITY', 'Reset the lab before adding more bookings.');
    const booking = {
      id: `booking-${++this.#bookingSequence}`, carId, requestedBayId: bayId, bayId, bookingMode,
      startsAt: this.#iso(start), protectionStartsAt: this.#iso(from), deadlineAt: this.#iso(until), status: 'scheduled',
      entryAuthorizedAt: null, arrivedAt: null, endedAt: null, extensionCount: 0,
      mockFeeCents: bookingMode === 'scheduled' ? RESERVATION_POLICY.scheduledFeeCents : 0,
      mockRefundCents: 0, alternativeLocationId: null,
    };
    this.#bookings.push(booking);
    this.#event('booking', 'One fictional driver booked a whole physical bay; its connectors cannot be allocated to another car in that window.');
    this.#reconcile();
  }

  #command(bay, target) {
    if (bay.pendingCommand) return;
    if (bay.occupantCarId) return;
    bay.pendingCommand = { id: `command-${++this.#sequence}`, target, acknowledgedAt: this.#iso() };
    this.#event('command-ack', `Simulated ${target === 'raised' ? 'raise' : 'lower'} command acknowledged; physical position still needs a separate observation.`);
  }
  #usable(bay, booking) {
    return !bay.occupantCarId && !bay.pendingCommand && bay.barrier === 'lowered' &&
      (!bay.activeBookingId || bay.activeBookingId === booking.id) &&
      !this.#overlap(bay.id, Date.parse(booking.protectionStartsAt), Date.parse(booking.deadlineAt), booking.id);
  }
  #activate(booking) {
    const requested = this.#bay(booking.requestedBayId);
    const candidates = [requested, ...this.#bays.filter(item => item.locationId === requested.locationId && item.id !== requested.id)];
    const bay = candidates.find(item => this.#usable(item, booking));
    if (!bay) {
      booking.status = 'refunded';
      booking.endedAt = this.#iso();
      booking.mockRefundCents = booking.mockFeeCents;
      const nearby = LOCATIONS.filter(item => item.id !== requested.locationId).sort((a, b) => a.distanceKm - b.distanceKm)
        .find(location => this.#bays.some(item => item.locationId === location.id && this.#usable(item, booking)));
      booking.alternativeLocationId = nearby?.id ?? null;
      this.#event('refund', 'No compatible vacant bay was available at this hub. The mock fee was refunded; any nearby suggestion needs a new booking.');
      return;
    }
    if (bay.id !== requested.id) this.#event('fallback', 'The requested bay is blocked. Protection switched to another compatible physical bay at the same hub.');
    booking.bayId = bay.id;
    booking.status = 'protecting';
    bay.activeBookingId = booking.id;
    this.#command(bay, 'raised');
  }
  #cleanup(booking) {
    const bay = this.#bay(booking.bayId);
    booking.status = bay.occupantCarId ? 'cleanup-blocked' : 'cleanup';
    if (bay.occupantCarId) {
      this.#event('cleanup-blocked', 'An occupant blocks cleanup. No movement or availability is inferred from a missing plate event.');
      return;
    }
    this.#command(bay, 'lowered');
  }
  #reconcile() {
    for (const booking of this.#bookings) {
      if (TERMINAL.has(booking.status)) continue;
      if (!booking.entryAuthorizedAt && this.#now >= Date.parse(booking.deadlineAt)) {
        if (!['cleanup', 'cleanup-blocked'].includes(booking.status)) {
          this.#event('no-show', 'The arrival deadline passed without an accepted matching scan; safe cleanup was requested.');
          this.#cleanup(booking);
        }
      } else if (booking.status === 'scheduled' && this.#now >= Date.parse(booking.protectionStartsAt)) this.#activate(booking);
    }
  }
  #observe(bay) {
    if (!bay.pendingCommand) throw new LabError('NO_PENDING_COMMAND', 'There is no simulated barrier command awaiting observation on this bay.');
    if (bay.occupantCarId) throw new LabError('BAY_OCCUPIED', 'An occupied bay cannot confirm a simulated barrier movement. Clear or depart first.');
    this.#now += 1;
    bay.barrier = bay.pendingCommand.target;
    bay.observedAt = this.#iso();
    bay.pendingCommand = null;
    this.#event('sensor-observation', 'A separate newer simulated sensor observation confirmed the barrier position and vacant bay.');
    const booking = this.#active(bay);
    if (!booking) return;
    if (['cleanup', 'cleanup-blocked'].includes(booking.status)) {
      if (bay.barrier === 'lowered') {
        booking.status = booking.arrivedAt ? 'completed' : 'expired';
        booking.endedAt = this.#iso();
        bay.activeBookingId = null;
        this.#event('release', 'Vacant and lowered cleanup was observed. This physical bay is available again.');
      } else { booking.status = 'cleanup'; this.#command(bay, 'lowered'); }
    } else if (booking.status === 'protecting' && bay.barrier === 'raised') booking.status = 'protected';
    else if (booking.status === 'entry_pending' && bay.barrier === 'lowered') booking.status = 'entry_authorized';
  }
  #extend({ bookingId, carId }) {
    const booking = this.#booking(bookingId, carId);
    if (booking.entryAuthorizedAt || ['cleanup', 'cleanup-blocked'].includes(booking.status) || this.#now >= Date.parse(booking.deadlineAt)) {
      throw new LabError('EXTENSION_CLOSED', 'Only a live, unmatched arrival hold can be extended.');
    }
    if (booking.extensionCount >= 11) throw new LabError('EXTENSION_LIMIT', 'The arrival window can extend to at most 120 minutes in this lab.');
    const deadline = Date.parse(booking.deadlineAt) + RESERVATION_POLICY.extensionMinutes * MINUTE;
    if (this.#overlap(booking.bayId, Date.parse(booking.protectionStartsAt), deadline, booking.id)) {
      throw new LabError('EXTENSION_CONFLICT', 'The extension would overlap another car’s protection window. No mock fee was added.');
    }
    booking.deadlineAt = this.#iso(deadline);
    booking.extensionCount++;
    booking.mockFeeCents += RESERVATION_POLICY.extensionFeeCents;
    this.#event('extension', 'Ten minutes were added to the arrival deadline for €1 mock; no real payment was made.');
  }
  #scan({ carId, bayId, confidence }) {
    this.#car(carId);
    const bay = this.#bay(bayId);
    requireInput(typeof confidence === 'number' && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1, 'Choose a confidence between zero and one.');
    const booking = this.#active(bay);
    if (!booking || booking.status !== 'protected' || this.#now >= Date.parse(booking.deadlineAt) || bay.occupantCarId || bay.pendingCommand || bay.barrier !== 'raised') {
      throw new LabError('SCAN_NOT_READY', 'A scan needs an unexpired protected booking and a separately confirmed raised, vacant bay.');
    }
    if (booking.carId !== carId || confidence < 0.9) {
      this.#event('scan-rejected', confidence < 0.9 ? 'The fictional scan was below the prototype confidence threshold. Entry remains closed.' : 'The fictional scanned car does not own this booking. Entry remains closed.');
      return;
    }
    booking.entryAuthorizedAt = this.#iso();
    booking.status = 'entry_pending';
    this.#event('plate-match', 'The expected fictional car matched. The unused-arrival timer stopped; occupancy is still unconfirmed.');
    this.#command(bay, 'lowered');
  }
  #park({ carId, bayId }) {
    this.#car(carId);
    const bay = this.#bay(bayId);
    const booking = this.#active(bay);
    if (!booking || booking.carId !== carId || !booking.entryAuthorizedAt || booking.status !== 'entry_authorized' || bay.pendingCommand || bay.barrier !== 'lowered' || bay.occupantCarId) {
      throw new LabError('ENTRY_NOT_AUTHORIZED', 'Parking needs this car’s matching scan and a separately observed lowered, vacant barrier.');
    }
    if (this.#bays.some(item => item.occupantCarId === carId)) throw new LabError('CAR_ALREADY_PARKED', 'This fictional car already occupies another bay.');
    this.#now += 1;
    bay.occupantCarId = carId;
    bay.observedAt = this.#iso();
    booking.arrivedAt = this.#iso();
    booking.status = 'arrived';
    this.#event('arrival', 'A newer occupied sensor observation confirmed the authorized car’s arrival. Real charging telemetry is unavailable.');
  }
  #depart(carId) {
    this.#car(carId);
    const bay = this.#bays.find(item => item.occupantCarId === carId);
    if (!bay) throw new LabError('CAR_NOT_PARKED', 'This fictional car does not currently occupy a bay.');
    const booking = this.#active(bay);
    if (!booking?.arrivedAt || booking.carId !== carId) throw new LabError('USE_CLEAR', 'This car is a blocker. Use Clear bay to simulate its vacant sensor observation.');
    this.#now += 1;
    bay.occupantCarId = null;
    bay.observedAt = this.#iso();
    this.#event('departure', 'The authorized car left; a newer vacant sensor observation requested final cleanup.');
    this.#cleanup(booking);
  }
  #block({ carId, bayId }) {
    this.#car(carId);
    const bay = this.#bay(bayId);
    if (bay.occupantCarId || this.#bays.some(item => item.occupantCarId === carId)) throw new LabError('CAR_ALREADY_PARKED', 'Choose an empty bay and a car that is not already parked.');
    this.#now += 1;
    bay.occupantCarId = carId;
    bay.observedAt = this.#iso();
    this.#event('blocked', 'An unexpected occupied sensor observation was injected. Car type and charging activity cannot be inferred from this observation.');
    const booking = this.#active(bay);
    if (booking && ['cleanup', 'cleanup-blocked'].includes(booking.status)) booking.status = 'cleanup-blocked';
  }
  #clear(bay) {
    if (!bay.occupantCarId) throw new LabError('BAY_ALREADY_VACANT', 'This bay is already observed vacant.');
    if (this.#active(bay)?.arrivedAt) throw new LabError('USE_DEPART', 'Use Depart for the authorized car so its arrival and departure stay linked.');
    this.#now += 1;
    bay.occupantCarId = null;
    bay.observedAt = this.#iso();
    this.#event('clear', 'The blocking car left and a newer vacant sensor observation was injected.');
    const booking = this.#active(bay);
    if (booking && ['cleanup', 'cleanup-blocked'].includes(booking.status)) this.#cleanup(booking);
  }

  runScenario(scenarioId) {
    this.#runningScenario = true;
    try { return this.#scenario(scenarioId); }
    finally { this.#runningScenario = false; }
  }

  #scenario(scenarioId) {
    requireInput(SCENARIOS.some(item => item.id === scenarioId), 'Choose a listed rehearsal scenario.');
    this.#reset();
    this.#scenarioId = scenarioId;
    const act = (action, values = {}) => this.act({ action, ...values });
    const book = (carId, bayId, bookingMode = 'now', arrivalMinutesFromNow) => {
      act('reserve', { carId, bayId, bookingMode, ...(arrivalMinutesFromNow === undefined ? {} : { arrivalMinutesFromNow }) });
      return this.#bookings.at(-1);
    };
    const check = (id, label, passed) => {
      this.#checks.push({ id, label, passed: Boolean(passed) });
      if (!passed) throw new LabError('SCENARIO_FAILED', 'A deterministic rehearsal assertion failed.', 500);
    };
    if (scenarioId === 'race') {
      const first = book('car-a', 'bay-1');
      let denied = false;
      try { book('car-b', 'bay-1'); } catch (error) { if (error.code === 'BAY_ALREADY_BOOKED') denied = true; else throw error; }
      check('single-owner', 'A competing driver cannot replace the first whole-bay owner.', denied && this.#bookings.length === 1 && first.carId === 'car-a');
      check('ack-is-not-position', 'Command acknowledgement leaves position unconfirmed until Observe.', this.#bay('bay-1').barrier === 'lowered' && this.#bay('bay-1').pendingCommand?.target === 'raised');
      act('observe', { bayId: 'bay-1' });
    } else if (scenarioId === 'plate-check') {
      const booking = book('car-a', 'bay-1');
      act('observe', { bayId: 'bay-1' });
      act('scan', { carId: 'car-c', bayId: 'bay-1', confidence: 0.99 });
      act('scan', { carId: 'car-a', bayId: 'bay-1', confidence: 0.4 });
      check('reject-scans', 'Wrong-car and uncertain scans leave the raised barrier and booking unchanged.', !booking.entryAuthorizedAt && this.#bay('bay-1').barrier === 'raised' && !this.#bay('bay-1').pendingCommand);
      act('scan', { carId: 'car-a', bayId: 'bay-1', confidence: 0.99 });
      check('scan-is-not-occupancy', 'A matching scan authorizes entry without inventing occupancy.', !!booking.entryAuthorizedAt && !booking.arrivedAt && !this.#bay('bay-1').occupantCarId);
      act('observe', { bayId: 'bay-1' });
      act('advance', { minutes: 11 });
      check('match-stops-expiry', 'A timely matching scan survives the original no-show deadline.', booking.status === 'entry_authorized');
      act('park', { carId: 'car-a', bayId: 'bay-1' });
    } else if (scenarioId === 'no-show') {
      const booking = book('car-a', 'bay-1');
      act('observe', { bayId: 'bay-1' });
      act('advance', { minutes: 10 });
      check('cleanup-before-release', 'Expiry requests lowering but retains the allocation until observation.', booking.status === 'cleanup' && this.#bay('bay-1').activeBookingId === booking.id && this.#bay('bay-1').barrier === 'raised');
      act('observe', { bayId: 'bay-1' });
      check('reopened', 'Vacant and lowered cleanup releases the no-show bay.', booking.status === 'expired' && !this.#bay('bay-1').activeBookingId);
    } else if (scenarioId === 'extension') {
      const booking = book('car-a', 'bay-1');
      act('observe', { bayId: 'bay-1' });
      const before = Date.parse(booking.deadlineAt);
      act('extend', { bookingId: booking.id, carId: 'car-a' });
      act('advance', { minutes: 10 });
      check('deadline-extended', 'A €1 mock extension adds ten minutes and prevents the original expiry.', Date.parse(booking.deadlineAt) === before + 10 * MINUTE && booking.mockFeeCents === 100 && booking.status === 'protected');
    } else if (scenarioId === 'scheduled-window') {
      const scheduled = book('car-a', 'bay-1', 'scheduled', 20);
      check('future-is-not-held', 'The 15:00 booking does not hold the bay at 14:40.', !this.#bay('bay-1').activeBookingId && !this.#bay('bay-1').pendingCommand);
      const earlier = book('car-b', 'bay-1');
      act('observe', { bayId: 'bay-1' });
      act('advance', { minutes: 10 });
      act('observe', { bayId: 'bay-1' });
      check('lead-in', 'At 14:50 the future booking activates; an earlier hold may need another physical bay.', scheduled.status === 'protecting' && Date.parse(scheduled.protectionStartsAt) === this.#base + 10 * MINUTE && earlier.status === 'expired');
      act('observe', { bayId: scheduled.bayId });
      act('advance', { minutes: 20 });
      check('arrival-grace', 'The 15:00 booking expires at 15:10, with a ten-minute arrival grace.', scheduled.status === 'cleanup' && Date.parse(scheduled.deadlineAt) === this.#base + 30 * MINUTE);
      act('observe', { bayId: scheduled.bayId });
    } else if (scenarioId === 'blocked-fallback') {
      const booking = book('car-a', 'bay-1', 'scheduled', 20);
      act('block', { carId: 'car-b', bayId: 'bay-1' });
      act('advance', { minutes: 10 });
      check('fallback', 'A blocked requested bay switches to the other compatible whole bay.', booking.bayId === 'bay-2' && booking.status === 'protecting' && this.#bay('bay-1').occupantCarId === 'car-b');
      act('observe', { bayId: booking.bayId });
    } else if (scenarioId === 'full-refund') {
      const booking = book('car-a', 'bay-1', 'scheduled', 20);
      act('block', { carId: 'car-b', bayId: 'bay-1' });
      act('block', { carId: 'car-c', bayId: 'bay-2' });
      act('advance', { minutes: 10 });
      check('mock-refund', 'A full hub refunds the €1 mock reservation fee.', booking.status === 'refunded' && booking.mockRefundCents === 100);
      check('nearby-suggestion', 'The closest fictional available hub is suggested without an automatic booking.', booking.alternativeLocationId === 'location-b' && !this.#bay('bay-3').activeBookingId);
    }
    this.#event('scenario-complete', 'The deterministic fictional rehearsal completed; production database and physical hardware still require separate evidence.');
    return this.snapshot();
  }
}
