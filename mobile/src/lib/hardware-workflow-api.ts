import { randomUUID } from 'expo-crypto';

import { BOOKINGS_CONFIGURED, getBookingAccessToken } from '@/lib/bookings-api';
import type { BayConnector, HoldMinutes } from '@/lib/booking-contract';
import type { HardwareLock } from '@/lib/hardware-api';
import { API_BASE_URL } from '@/lib/reservation-api';

export type HardwarePhase = 'idle' | 'protect_pending' | 'protecting' | 'protected' | 'entry_pending' | 'entering' | 'entry_open' | 'release_pending' | 'releasing' | 'blocked' | 'uncertain';
export interface HardwareWorkflow {
  serverNow: string;
  bay: { id: string; label: string; lockId: string; connectors: BayConnector[] };
  reservation: { id: string | null; isMine: boolean; expiresAt: string | null };
  phase: HardwarePhase;
  reason: string | null;
  operation: {
    id: string;
    kind: 'protect' | 'entry' | 'release';
    target: 'raised' | 'lowered';
    status: 'queued' | 'claimed' | 'dispatching' | 'acknowledged' | 'uncertain' | 'confirmed' | 'cancelled';
    requestedAt: string;
    dispatchedAt: string | null;
  } | null;
  capabilities: { canReserve: boolean; canRequestEntry: boolean; canRequestRelease: boolean };
}

export interface HardwareWorkflowSnapshot {
  source: 'ecurious';
  commandsEnabled: boolean;
  reason: string | null;
  serverNow: string;
  workflows: HardwareWorkflow[];
  observations: HardwareLock[];
}

export class HardwareWorkflowError extends Error {
  constructor(message: string, readonly code = 'HARDWARE_UNAVAILABLE') { super(message); }
}

const phases: HardwarePhase[] = ['idle', 'protect_pending', 'protecting', 'protected', 'entry_pending', 'entering', 'entry_open', 'release_pending', 'releasing', 'blocked', 'uncertain'];
const operationStates = ['queued', 'claimed', 'dispatching', 'acknowledged', 'uncertain', 'confirmed', 'cancelled'];
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const nullableText = (value: unknown): boolean => value === null || (typeof value === 'string' && value.length <= 500);
const nullableTime = (value: unknown): boolean => value === null || timestamp(value);
const finiteOrNull = (value: unknown): boolean => value === null || (typeof value === 'number' && Number.isFinite(value));

function connector(value: unknown): value is BayConnector {
  return record(value) && uuid(value.id) && typeof value.label === 'string' && typeof value.type === 'string' && typeof value.powerKw === 'number' && Number.isFinite(value.powerKw) && value.powerKw >= 0 && typeof value.enabled === 'boolean';
}

function workflow(value: unknown): value is HardwareWorkflow {
  if (!record(value) || !record(value.bay) || !record(value.reservation) || !record(value.capabilities)) return false;
  const { bay, reservation, operation, capabilities } = value;
  const valid = timestamp(value.serverNow) && uuid(bay.id) && typeof bay.label === 'string' && typeof bay.lockId === 'string' && Array.isArray(bay.connectors) && bay.connectors.every(connector) &&
    (reservation.id === null || uuid(reservation.id)) && typeof reservation.isMine === 'boolean' && nullableTime(reservation.expiresAt) &&
    (!reservation.isMine || uuid(reservation.id)) && (reservation.isMine || reservation.id === null) &&
    phases.includes(value.phase as HardwarePhase) && nullableText(value.reason) &&
    ['canReserve', 'canRequestEntry', 'canRequestRelease'].every(key => typeof capabilities[key] === 'boolean') &&
    (operation === null || (record(operation) && uuid(operation.id) && ['protect', 'entry', 'release'].includes(operation.kind as string) && ['raised', 'lowered'].includes(operation.target as string) && operationStates.includes(operation.status as string) && timestamp(operation.requestedAt) && nullableTime(operation.dispatchedAt)));
  if (!valid) return false;
  if (new Set((bay.connectors as BayConnector[]).map(item => item.id)).size !== (bay.connectors as BayConnector[]).length) return false;
  const hasReservation = reservation.expiresAt !== null;
  if (reservation.isMine && !hasReservation) return false;
  if (value.phase === 'idle' && (hasReservation || reservation.isMine || reservation.id !== null)) return false;
  if (capabilities.canReserve && (value.phase !== 'idle' || hasReservation || capabilities.canRequestEntry || capabilities.canRequestRelease)) return false;
  if (capabilities.canRequestEntry && (value.phase !== 'protected' || !reservation.isMine || !uuid(reservation.id) || !timestamp(reservation.expiresAt) || Date.parse(reservation.expiresAt) <= Date.parse(value.serverNow as string))) return false;
  if (capabilities.canRequestRelease && (!reservation.isMine || !uuid(reservation.id))) return false;
  if (record(operation)) {
    if (operation.target !== (operation.kind === 'protect' ? 'raised' : 'lowered')) return false;
    const requested = Date.parse(operation.requestedAt as string);
    const serverNow = Date.parse(value.serverNow as string);
    if (requested > serverNow) return false;
    if (operation.dispatchedAt !== null) {
      const dispatched = Date.parse(operation.dispatchedAt as string);
      if (dispatched < requested || dispatched > serverNow) return false;
    }
    if (['queued', 'claimed', 'cancelled'].includes(operation.status as string) && operation.dispatchedAt !== null) return false;
    if (['dispatching', 'acknowledged'].includes(operation.status as string) && operation.dispatchedAt === null) return false;
  }
  return true;
}

function observation(value: unknown): value is HardwareLock {
  if (!record(value) || !record(value.whitelist)) return false;
  return typeof value.id === 'string' && typeof value.name === 'string' && typeof value.hasCamera === 'boolean' && typeof value.status === 'string' && nullableTime(value.lastSeenAt) && typeof value.telemetryFresh === 'boolean' &&
    ['raised', 'lowered', 'unknown'].includes(value.barrier as string) && ['vacant', 'occupied', 'unknown'].includes(value.occupancy as string) && ['vacant', 'occupied', 'unknown'].includes(value.lastReportedPresence as string) &&
    Array.isArray(value.activeErrors) && value.activeErrors.every(item => typeof item === 'string') && (value.waterIngress === null || typeof value.waterIngress === 'boolean') &&
    ['battery12V', 'battery3_7V', 'signalStrength4G'].every(key => finiteOrNull(value[key])) &&
    ['any-plate', 'specific-plates', 'disabled', 'unknown'].includes(value.whitelist.mode as string) && finiteOrNull(value.whitelist.count) &&
    (value.plateObservation === null || (record(value.plateObservation) && typeof value.plateObservation.detected === 'boolean' && nullableTime(value.plateObservation.timestamp)));
}

export function isHardwareWorkflowSnapshot(value: unknown): value is HardwareWorkflowSnapshot {
  if (!(record(value) && value.source === 'ecurious' && typeof value.commandsEnabled === 'boolean' && nullableText(value.reason) && timestamp(value.serverNow) &&
    Array.isArray(value.workflows) && value.workflows.length <= 50 && value.workflows.every(workflow) && Array.isArray(value.observations) && value.observations.length <= 50 && value.observations.every(observation)
  )) return false;
  const workflows = value.workflows as HardwareWorkflow[];
  const observations = value.observations as HardwareLock[];
  if (!value.commandsEnabled && (workflows.length || observations.length)) return false;
  if (new Set(workflows.map(item => item.bay.id)).size !== workflows.length || new Set(workflows.map(item => item.bay.lockId)).size !== workflows.length) return false;
  const connectors = workflows.flatMap(item => item.bay.connectors.map(plug => plug.id));
  if (new Set(connectors).size !== connectors.length) return false;
  const operations = workflows.flatMap(item => item.operation ? [item.operation.id] : []);
  return new Set(operations).size === operations.length && new Set(observations.map(item => item.id)).size === observations.length;
}

let readNeedsAuth = false;

async function request(path: string, { body, signal, authenticated = false }: { body?: Record<string, unknown>; signal?: AbortSignal; authenticated?: boolean } = {}): Promise<HardwareWorkflowSnapshot> {
  if (!/^https?:\/\//.test(API_BASE_URL)) throw new HardwareWorkflowError('The laptop API address is invalid. Check connection setup in Activity.');
  const token = authenticated || body ? await getBookingAccessToken() : null;
  if (signal?.aborted) { const cancelled = new Error('Request cancelled'); cancelled.name = 'AbortError'; throw cancelled; }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 12_000);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, { method: body ? 'POST' : 'GET', headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal });
    if (response.status === 401 && !body && !authenticated && BOOKINGS_CONFIGURED) {
      readNeedsAuth = true;
      return await request(path, { signal, authenticated: true });
    }
    const raw = await response.text();
    if (raw.length > 1_000_000) throw new HardwareWorkflowError('The laptop returned an oversized hardware workflow response.');
    let data: unknown;
    try { data = JSON.parse(raw); } catch { throw new HardwareWorkflowError('The laptop returned an unreadable hardware workflow response.'); }
    if (!response.ok) {
      const code = record(data) && record(data.error) && typeof data.error.code === 'string' ? data.error.code : 'HARDWARE_UNAVAILABLE';
      const message = record(data) && record(data.error) && typeof data.error.message === 'string' && data.error.message.length <= 500 ? data.error.message : `The hardware workflow returned HTTP ${response.status}. Refresh its status before another action.`;
      throw new HardwareWorkflowError(message, code);
    }
    if (!isHardwareWorkflowSnapshot(data)) throw new HardwareWorkflowError('The laptop returned an unsupported hardware workflow. Update and restart the backend.');
    return data;
  } catch (error) {
    if (signal?.aborted) { const cancelled = new Error('Request cancelled'); cancelled.name = 'AbortError'; throw cancelled; }
    if (error instanceof HardwareWorkflowError) throw error;
    throw new HardwareWorkflowError(body ? 'The command outcome is unknown. Refresh the designated bay before another action.' : timedOut ? 'The designated bay did not respond within 12 seconds. Refresh its status.' : 'Could not reach the designated bay through the laptop. Keep the backend running on the same network.');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export const fetchHardwareWorkflows = (signal?: AbortSignal) => request('/api/hardware/bookings', { signal, authenticated: readNeedsAuth });
export const reserveHardwareBay = (bayId: string, connectorId: string, holdMinutes: HoldMinutes) => request('/api/hardware/bookings', { body: { bayId, connectorId, holdMinutes, requestId: randomUUID() } });
export const requestHardwareAction = (action: 'entry' | 'release', bayId: string, reservationId: string) => request('/api/hardware/actions', { body: { action, bayId, reservationId } });
