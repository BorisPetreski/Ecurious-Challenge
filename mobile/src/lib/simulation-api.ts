import { API_BASE_URL } from '@/lib/reservation-api';

export interface LabCar { id: string; label: string; maskedPlate: string }
export interface LabBay {
  id: string; label: string; locationId: string; status: string; barrier: 'raised' | 'lowered'; occupantCarId: string | null;
  activeBookingId: string | null; observedAt: string; connectors: { id: string; type: string; powerKw: number }[];
  pendingCommand: { id: string; target: 'raised' | 'lowered'; acknowledgedAt: string } | null;
}
export interface LabBooking {
  id: string; carId: string; bayId: string; requestedBayId: string; bookingMode: 'now' | 'scheduled'; status: string;
  startsAt: string; protectionStartsAt: string; deadlineAt: string; entryAuthorizedAt: string | null; arrivedAt: string | null;
  endedAt: string | null; extensionCount: number; mockFeeCents: number; mockRefundCents: number; alternativeLocationId: string | null;
}
export interface LabSnapshot {
  mode: 'simulation'; revision: number; now: string; scenarioId: string | null; cars: LabCar[]; bays: LabBay[]; bookings: LabBooking[];
  locations: { id: string; label: string; distanceKm: number }[];
  events: { id: string; at: string; type: string; message: string }[];
  scenarios: { id: string; label: string; description: string }[];
  checks: { id: string; label: string; passed: boolean }[];
}
export type LabAction = { action: 'reset' } | { action: 'scenario'; scenarioId: string } | { action: 'advance'; minutes: number }
  | { action: 'reserve'; carId: string; bayId: string; bookingMode: 'now' | 'scheduled'; arrivalMinutesFromNow?: number }
  | { action: 'extend'; carId: string; bookingId: string } | { action: 'scan'; carId: string; bayId: string; confidence: number }
  | { action: 'park' | 'block'; carId: string; bayId: string } | { action: 'depart'; carId: string }
  | { action: 'observe' | 'clear'; bayId: string };

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 500;
const time = (v: unknown): v is string => text(v) && Number.isFinite(Date.parse(v));
const optionalTime = (v: unknown) => v === null || time(v);
const id = (v: unknown): v is string => text(v) && /^[a-z0-9-]{1,60}$/.test(v);
const optionalId = (v: unknown) => v === null || id(v);
const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

export function isLabSnapshot(value: unknown): value is LabSnapshot {
  if (!record(value) || value.mode !== 'simulation' || !count(value.revision) || !time(value.now) || !optionalId(value.scenarioId)) return false;
  const array = (key: string, max: number, check: (item: unknown) => boolean) => Array.isArray(value[key]) && value[key].length <= max && value[key].every(check);
  return array('cars', 3, c => record(c) && id(c.id) && text(c.label) && text(c.maskedPlate)) &&
    array('locations', 3, l => record(l) && id(l.id) && text(l.label) && typeof l.distanceKm === 'number' && Number.isFinite(l.distanceKm) && l.distanceKm >= 0) &&
    array('bays', 3, b => record(b) && id(b.id) && id(b.locationId) && text(b.label) && text(b.status) && (b.barrier === 'raised' || b.barrier === 'lowered') &&
      optionalId(b.occupantCarId) && optionalId(b.activeBookingId) && time(b.observedAt) && Array.isArray(b.connectors) && b.connectors.length <= 5 &&
      b.connectors.every(c => record(c) && id(c.id) && text(c.type) && typeof c.powerKw === 'number' && Number.isFinite(c.powerKw) && c.powerKw > 0) &&
      (b.pendingCommand === null || record(b.pendingCommand) && id(b.pendingCommand.id) && (b.pendingCommand.target === 'raised' || b.pendingCommand.target === 'lowered') && time(b.pendingCommand.acknowledgedAt))) &&
    array('bookings', 60, b => record(b) && ['id', 'carId', 'bayId', 'requestedBayId'].every(key => id(b[key])) && (b.bookingMode === 'now' || b.bookingMode === 'scheduled') && text(b.status) &&
      ['startsAt', 'protectionStartsAt', 'deadlineAt'].every(key => time(b[key])) && ['entryAuthorizedAt', 'arrivedAt', 'endedAt'].every(key => optionalTime(b[key])) &&
      ['extensionCount', 'mockFeeCents', 'mockRefundCents'].every(key => count(b[key])) && optionalId(b.alternativeLocationId)) &&
    array('events', 100, e => record(e) && id(e.id) && time(e.at) && text(e.type) && text(e.message)) &&
    array('scenarios', 15, s => record(s) && id(s.id) && text(s.label) && text(s.description)) &&
    array('checks', 30, c => record(c) && id(c.id) && text(c.label) && typeof c.passed === 'boolean');
}

export async function requestLab(action?: LabAction, signal?: AbortSignal): Promise<LabSnapshot> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 8_000);
  try {
    const response = await fetch(`${API_BASE_URL}/api/simulation${action ? '/actions' : ''}`, {
      method: action ? 'POST' : 'GET', signal: controller.signal,
      headers: { Accept: 'application/json', ...(action ? { 'Content-Type': 'application/json' } : {}) },
      ...(action ? { body: JSON.stringify(action) } : {}),
    });
    const raw = await response.text();
    if (raw.length > 500_000) throw new Error('The lab response is too large. Reset the simulation.');
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error('The lab returned an unreadable response. Refresh the lab.'); }
    if (!response.ok) throw new Error(record(value) && record(value.error) && text(value.error.message) ? value.error.message : 'The simulation action was refused. Refresh its state.');
    if (!isLabSnapshot(value)) throw new Error('The lab returned an unsupported snapshot. Refresh the lab.');
    return value;
  } catch (error) {
    if (signal?.aborted) { const cancelled = new Error('Cancelled'); cancelled.name = 'AbortError'; throw cancelled; }
    if (error instanceof Error && !['TypeError', 'AbortError'].includes(error.name)) throw error;
    throw new Error(action ? 'The lab outcome is unknown. Refresh before repeating this action.' : 'Cannot reach the lab. Keep the laptop server running on the same Wi-Fi.');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
