'use strict';

const byId = (id) => document.getElementById(id);
const elements = {
  plate: byId('plate'), hold: byId('hold-minutes'), confidence: byId('confidence'),
  confidenceValue: byId('confidence-value'), status: byId('action-status'),
  reserve: byId('reserve-button'), events: byId('event-list'),
};
const syntheticStations = [
  { name: 'Venue demo bay', description: 'Synthetic station · hardware rehearsal', connectors: ['CCS2', '150 kW'], selected: true },
  { name: 'Greenway charging hub', description: 'Synthetic station · no real location', connectors: ['CCS2', '50 kW'], selected: false },
  { name: 'Parkside destination', description: 'Synthetic station · no real location', connectors: ['Type 2', '22 kW'], selected: false },
];
let currentState = null;
let requestInFlight = false;
let pollInFlight = false;
let connected = false;
let serverOffsetMs = 0;
let directoryFetchedAt = null;
let discoveryRequest = null;

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function renderStations(query = '') {
  const list = byId('station-list');
  list.replaceChildren();
  const search = query.trim().toLowerCase();
  const matching = syntheticStations.filter((station) => `${station.name} ${station.connectors.join(' ')}`.toLowerCase().includes(search));
  for (const station of matching) {
    const card = node('article', `station-card${station.selected ? ' selected' : ''}`);
    const top = node('div', 'station-topline');
    top.append(node('span', 'station-symbol', 'ϟ'), node('span', 'station-source', 'Synthetic example'));
    if (station.selected) {
      const check = node('span', 'selected-check', '✓');
      check.setAttribute('aria-label', 'Selected demo bay');
      top.append(check);
    }
    card.append(top, node('h3', '', station.name), node('p', 'station-description', station.description));
    const chips = node('div', 'connector-chips');
    for (const connector of station.connectors) chips.append(node('span', '', connector));
    const bottom = node('div', 'station-bottom');
    bottom.append(node('span', '', station.selected ? 'Simulated reservation' : 'Example directory listing'), node('strong', station.selected ? 'selected-label' : '', station.selected ? 'Selected demo bay' : 'Discovery only'));
    card.append(chips, bottom);
    list.append(card);
  }
  byId('station-empty').hidden = matching.length > 0;
}

const statusLabels = {
  free: 'Available', reserved: 'Reserved', occupied: 'Occupied', charging: 'Charging',
  'awaiting-release': 'Ready to release', blocked: 'Blocked',
  'awaiting-arrival': 'Awaiting arrival', 'manual-review': 'Manual review',
  authorized: 'Plate verified', completed: 'Completed', expired: 'Expired', released: 'Released',
  'expired-occupied': 'Expired · bay occupied',
};
function readable(value) { return statusLabels[value] || (typeof value === 'string' ? value.replaceAll('-', ' ') : 'Unknown'); }

function showStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle('error', isError);
}

function activeReservation() {
  const reservation = currentState?.reservation;
  return reservation && !['completed', 'expired', 'released', 'cancelled'].includes(reservation.status);
}

function updateControls() {
  const reservation = currentState?.reservation;
  const status = reservation?.status;
  const bay = currentState?.bay;
  const busy = requestInFlight || !connected || !bay;
  const active = Boolean(activeReservation());
  const fallbackPermissions = {
    arrive: active && ['awaiting-arrival', 'manual-review'].includes(status) && !bay?.occupied,
    'start-charge': status === 'authorized' && Boolean(bay?.occupied),
    depart: Boolean(bay?.occupied) && status !== 'manual-review',
    release: Boolean(reservation) && !bay?.occupied,
    block: !bay?.occupied,
    clear: Boolean(bay?.occupied) && !['authorized', 'charging'].includes(status),
    expire: active && ['awaiting-arrival', 'manual-review'].includes(status) && !bay?.occupied,
    reset: true,
  };
  const capabilityNames = { arrive: 'canArrive', 'start-charge': 'canStartCharge', depart: 'canDepart', release: 'canRelease', block: 'canBlock', clear: 'canClear', expire: 'canExpire', reset: 'canReset' };
  const canReserve = currentState?.capabilities?.canReserve ?? (!active && !bay?.occupied && bay?.status !== 'blocked');
  elements.reserve.disabled = busy || !canReserve;
  for (const button of document.querySelectorAll('[data-action]')) {
    const action = button.dataset.action;
    const allowed = currentState?.capabilities?.[capabilityNames[action]] ?? fallbackPermissions[action];
    button.disabled = busy || !allowed;
  }
  // Keep editable plate available during the lifecycle to test a mistaken arrival.
  elements.hold.disabled = requestInFlight;
  elements.confidence.disabled = requestInFlight;
}

function updateCountdown() {
  const reservation = currentState?.reservation;
  const expires = reservation?.expiresAt ? Date.parse(reservation.expiresAt) : NaN;
  if (activeReservation() && Number.isFinite(expires) && ['awaiting-arrival', 'manual-review'].includes(reservation.status)) {
    const seconds = Math.max(0, Math.ceil((expires - Date.now() - serverOffsetMs) / 1000));
    const minutes = Math.floor(seconds / 60);
    const countdown = `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')} remaining`;
    byId('summary-countdown').textContent = countdown;
    byId('summary-reservation').textContent = seconds === 0 ? 'Hold expired · waiting for server state' : `Held for ${reservation.maskedPlate || 'your demo plate'}`;
  } else {
    byId('summary-countdown').textContent = activeReservation() ? readable(reservation.status) : 'No active hold';
    byId('summary-reservation').textContent = activeReservation() ? 'Arrival window no longer counting down' : 'Reserve the demo bay to begin';
  }
  if (directoryFetchedAt && Date.now() - directoryFetchedAt >= 24 * 60 * 60 * 1000) {
    clearDirectory();
    byId('discovery-status').textContent = 'Directory results removed after 24 hours. Run a fresh search when needed.';
  }
}

function renderJourney(state) {
  const reservationStatus = state.reservation?.status;
  let stage = -1;
  if (state.reservation) stage = 0;
  if (['authorized', 'charging', 'completed'].includes(reservationStatus)) stage = 1;
  if (['charging', 'completed'].includes(reservationStatus)) stage = 2;
  if (reservationStatus === 'completed' || state.bay?.status === 'awaiting-release') stage = 3;
  if (reservationStatus === 'released' || (!state.reservation && state.events?.[0]?.type === 'released')) stage = 4;
  document.querySelectorAll('.journey li').forEach((step, index) => {
    step.classList.toggle('done', index < stage);
    step.classList.toggle('current', index === stage);
    if (index === stage) step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current');
  });
}

function renderEvents(events) {
  elements.events.replaceChildren();
  const recent = Array.isArray(events) ? [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 30) : [];
  byId('events-empty').hidden = recent.length > 0;
  for (const event of recent) {
    const item = node('li', 'event-item');
    const content = node('div', 'event-message', event.message || 'Simulator event');
    content.append(node('span', 'event-type', readable(event.type || 'event')));
    const time = node('time', 'event-time');
    const date = new Date(event.at);
    if (!Number.isNaN(date.getTime())) {
      time.dateTime = date.toISOString();
      time.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      time.title = date.toLocaleString();
    }
    item.append(node('span', 'event-dot'), content, time);
    elements.events.append(item);
  }
}

function renderState(state) {
  if (!state || !state.bay) throw new Error('The simulator returned an unexpected state.');
  currentState = state;
  connected = true;
  if (state.now && Number.isFinite(Date.parse(state.now))) serverOffsetMs = Date.parse(state.now) - Date.now();
  byId('connection-alert').hidden = true;
  byId('hardware-mode').textContent = state.mode === 'mock' ? 'Simulator connected' : `Mode: ${state.mode || 'unknown'}`;
  byId('summary-bay-status').textContent = readable(state.bay.status);
  byId('summary-occupancy').textContent = state.bay.occupied ? 'Vehicle present in simulated bay' : 'No vehicle in simulated bay';
  byId('bay-state').textContent = readable(state.bay.status);
  byId('bay-state').classList.toggle('warning', state.reservation?.status === 'manual-review' || state.bay.status === 'blocked');
  byId('occupancy').textContent = state.bay.occupied ? 'Vehicle present' : 'Empty';
  byId('barrier').textContent = readable(state.bay.barrier);
  const reviewReason = state.reservation?.reviewReason;
  byId('reservation-state').textContent = reviewReason === 'low-confidence' ? 'Review: low confidence' : reviewReason === 'plate-mismatch' ? 'Review: plate mismatch' : state.reservation ? readable(state.reservation.status) : 'No reservation';
  byId('reservation-plate').textContent = state.reservation?.maskedPlate || 'None';
  const schematic = byId('bay-schematic');
  schematic.classList.toggle('occupied', Boolean(state.bay.occupied));
  schematic.classList.toggle('lowered', state.bay.barrier === 'lowered');
  schematic.setAttribute('aria-label', `Simulated bay: ${state.bay.occupied ? 'occupied' : 'empty'}, barrier ${state.bay.barrier || 'unknown'}`);
  renderJourney(state);
  renderEvents(state.events);
  updateCountdown();
  updateControls();
}

async function fetchState() {
  if (pollInFlight || requestInFlight || document.hidden) return;
  pollInFlight = true;
  try {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (!response.ok) throw new Error('Unable to read the simulator state.');
    renderState(await response.json());
  } catch (error) {
    connected = false;
    byId('connection-alert').hidden = false;
    byId('hardware-mode').textContent = 'Connection unavailable';
    showStatus(error.message || 'Could not connect to the local simulator.', true);
    updateControls();
  } finally { pollInFlight = false; }
}

async function mutate(path, payload, successMessage) {
  if (requestInFlight) return;
  requestInFlight = true;
  updateControls();
  showStatus('Applying simulator action…');
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || 'The simulator could not complete that action.');
    renderState(data);
    showStatus(successMessage);
  } catch (error) {
    showStatus(error.message || 'Request failed. Check the local simulator connection.', true);
  } finally {
    requestInFlight = false;
    updateControls();
    // Read the authoritative server state after every attempted action.
    await fetchState();
  }
}

byId('station-search').addEventListener('input', (event) => renderStations(event.target.value));
byId('reservation-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (elements.reserve.disabled) return;
  void mutate('/api/reservations', { plate: elements.plate.value.trim(), holdMinutes: Number(elements.hold.value) }, 'Demo bay held. Simulate arrival using the plate above.');
});
elements.confidence.addEventListener('input', () => { elements.confidenceValue.textContent = `${Math.round(Number(elements.confidence.value) * 100)}%`; });
const actionMessages = {
  arrive: 'Arrival processed. Check the plate result and bay state above.',
  'start-charge': 'Simulated charging started. Depart when the session is complete.',
  depart: 'Vehicle departed. Release the bay to finish the journey.',
  release: 'Demo bay released. Ready for the next driver.',
  block: 'Simulated blocking vehicle added. Clear the bay before reserving.',
  clear: 'Blocking vehicle cleared from the simulated bay.',
  expire: 'Hold expired. The no-show flow has been exercised.',
  reset: 'Simulator reset. Ready for a fresh demo.',
};
for (const button of document.querySelectorAll('[data-action]')) {
  button.addEventListener('click', () => {
    const action = button.dataset.action;
    const payload = { action };
    if (action === 'arrive') { payload.plate = elements.plate.value.trim(); payload.confidence = Number(elements.confidence.value); }
    void mutate('/api/actions', payload, actionMessages[action]);
  });
}

function clearDirectory() {
  directoryFetchedAt = null;
  byId('directory-results').replaceChildren();
  byId('directory-attribution').hidden = true;
  byId('directory-time').textContent = '';
}

function goingElectricLink(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, 'https://www.goingelectric.de');
    if (url.protocol !== 'https:' || url.hostname !== 'www.goingelectric.de' || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

function renderDirectory(locations) {
  const container = byId('directory-results');
  container.replaceChildren();
  for (const station of locations.slice(0, 30)) {
    const card = node('article', 'directory-card');
    card.append(node('span', 'directory-source', 'GOINGELECTRIC · DISCOVERY ONLY'), node('h3', '', station.name || 'Public charge point'));
    const address = station.address || {};
    const addressText = [address.street, address.postcode, address.city].filter((part) => typeof part === 'string' || typeof part === 'number').join(' ');
    if (addressText) card.append(node('p', '', addressText));
    const connectors = Array.isArray(station.chargepoints) ? station.chargepoints : [];
    const connectorText = connectors.slice(0, 4).map((point) => [Number.isFinite(Number(point.count)) ? `${Number(point.count)}×` : '', typeof point.type === 'string' ? point.type : 'Connector', Number.isFinite(Number(point.power)) ? `${Number(point.power)} kW` : ''].filter(Boolean).join(' ')).join(' · ');
    if (connectorText) card.append(node('p', '', connectorText));
    card.append(node('p', '', 'No linked reservation hardware in this prototype.'));
    const url = goingElectricLink(station.url);
    if (url) {
      const link = node('a', '', 'View on GoingElectric ↗');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      card.append(link);
    } else {
      card.append(node('p', '', 'Directory did not provide an approved station link.'));
    }
    container.append(card);
  }
}

byId('discovery-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (discoveryRequest) return;
  const status = byId('discovery-status');
  const key = byId('api-key').value.trim();
  if (!key) return;
  const url = new URL('https://api.goingelectric.de/chargepoints/');
  url.searchParams.set('key', key);
  url.searchParams.set('lat', byId('latitude').value);
  url.searchParams.set('lng', byId('longitude').value);
  url.searchParams.set('radius', byId('radius').value);
  discoveryRequest = new AbortController();
  const activeRequest = discoveryRequest;
  const timeout = setTimeout(() => activeRequest.abort(), 15000);
  byId('discovery-button').disabled = true;
  status.classList.remove('error');
  status.textContent = 'Requesting directory data directly from GoingElectric…';
  try {
    const response = await fetch(url, { signal: activeRequest.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(`Directory request failed (HTTP ${response.status}). Check your approved API access.`);
    const data = await response.json();
    if (!Array.isArray(data.chargelocations)) throw new Error('GoingElectric did not return a station list. Check the API key and documentation with a mentor.');
    renderDirectory(data.chargelocations);
    directoryFetchedAt = Date.now();
    byId('directory-time').textContent = `Fetched ${new Date(directoryFetchedAt).toLocaleString()}`;
    byId('directory-attribution').hidden = false;
    status.textContent = `${data.chargelocations.length} public station${data.chargelocations.length === 1 ? '' : 's'} returned${data.chargelocations.length > 30 ? ' · showing first 30' : ''}. These results are discovery only.`;
  } catch (error) {
    clearDirectory();
    status.classList.add('error');
    if (error.name === 'AbortError') status.textContent = 'Directory request cancelled or timed out. Ask mentors for the approved browser setup before retrying.';
    else if (error instanceof TypeError) status.textContent = 'Browser request blocked or unavailable (possibly CORS or network access). Ask mentors for the approved browser setup. The local server does not proxy API keys.';
    else status.textContent = error.message || 'Directory discovery failed. Ask a mentor to check API access.';
  } finally {
    clearTimeout(timeout);
    discoveryRequest = null;
    byId('discovery-button').disabled = false;
  }
});
byId('clear-discovery').addEventListener('click', () => {
  if (discoveryRequest) discoveryRequest.abort();
  byId('api-key').value = '';
  clearDirectory();
  byId('discovery-status').textContent = 'API key and directory results cleared from this page.';
  byId('discovery-status').classList.remove('error');
});

document.addEventListener('visibilitychange', () => { if (!document.hidden) void fetchState(); });
renderStations();
void fetchState().then(() => { if (connected) showStatus('Simulator ready. Reserve the demo bay to begin.'); });
setInterval(() => { if (!document.hidden) void fetchState(); }, 2000);
setInterval(updateCountdown, 1000);
