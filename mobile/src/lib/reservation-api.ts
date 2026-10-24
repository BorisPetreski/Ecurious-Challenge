import Constants from 'expo-constants';
import { Platform } from 'react-native';

export type ReservationAction =
  | 'arrive'
  | 'start-charge'
  | 'depart'
  | 'release'
  | 'block'
  | 'clear'
  | 'expire'
  | 'reset';

export type ReservationStatus =
  | 'awaiting-arrival'
  | 'manual-review'
  | 'authorized'
  | 'charging'
  | 'completed'
  | 'expired-occupied';

export type BayStatus = 'free' | 'reserved' | 'blocked' | 'charging' | 'occupied' | 'awaiting-release';
export type ReviewReason = 'low-confidence' | 'plate-mismatch';

export interface Reservation {
  id: string;
  status: ReservationStatus;
  maskedPlate: string;
  createdAt: string;
  expiresAt: string;
  arrivedAt?: string;
  startedAt?: string;
  completedAt?: string;
  reviewReason?: ReviewReason;
}

export interface ReservationEvent {
  id: string;
  at: string;
  type: string;
  message: string;
}

export interface ReservationCapabilities {
  canReserve: boolean;
  canArrive: boolean;
  canStartCharge: boolean;
  canDepart: boolean;
  canRelease: boolean;
  canBlock: boolean;
  canClear: boolean;
  canExpire: boolean;
  canReset: boolean;
}

export interface ReservationState {
  mode: 'mock';
  now: string;
  bay: {
    id: string;
    label: string;
    status: BayStatus;
    occupied: boolean;
    barrier: 'raised' | 'lowered';
  };
  reservation: Reservation | null;
  /** The server returns the newest event first. */
  events: ReservationEvent[];
  capabilities: ReservationCapabilities;
}

export interface ReservationActionOptions {
  plate?: string;
  /** Recognition confidence is a fraction from 0 to 1. */
  confidence?: number;
}

export class ReservationApiError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = 'ReservationApiError';
    this.code = code;
    this.status = status;
  }
}

function connectionConfiguration(): { baseUrl: string; error?: string } {
  // Keep the direct process.env access: Expo replaces these values in the bundle.
  const configuredUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
  const port = process.env.EXPO_PUBLIC_API_PORT?.trim() || '3000';
  let candidate = configuredUrl;

  if (!candidate) {
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
      return { baseUrl: '(invalid API port)', error: 'The simulator port is invalid. Check connection setup in Activity and restart Expo.' };
    }
    let hostname: string | undefined;
    const hostUri = Constants.expoConfig?.hostUri;
    if (hostUri) {
      try {
        hostname = new URL(hostUri.includes('://') ? hostUri : `http://${hostUri}`).hostname;
      } catch {
        // Expo can omit a usable development hostname; use emulator defaults.
      }
    }
    if (!hostname || ['localhost', '127.0.0.1', '0.0.0.0'].includes(hostname)) {
      hostname = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
    }
    candidate = `http://${hostname}:${port}`;
  }

  try {
    const url = new URL(candidate);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname && url.pathname !== '/')
    ) {
      throw new Error('Invalid API base URL');
    }
    return { baseUrl: url.origin };
  } catch {
    // Never repeat an invalid value: it might contain accidentally pasted secrets.
    return {
      baseUrl: '(invalid API URL)',
      error: 'The simulator address is invalid. Check connection setup in Activity and restart Expo.',
    };
  }
}

const configuration = connectionConfiguration();
export const API_BASE_URL = configuration.baseUrl;
const REQUEST_TIMEOUT_MS = 7_000;

const capabilityKeys: (keyof ReservationCapabilities)[] = [
  'canReserve', 'canArrive', 'canStartCharge', 'canDepart', 'canRelease',
  'canBlock', 'canClear', 'canExpire', 'canReset',
];
const bayStatuses: BayStatus[] = ['free', 'reserved', 'blocked', 'charging', 'occupied', 'awaiting-release'];
const reservationStatuses: ReservationStatus[] = [
  'awaiting-arrival', 'manual-review', 'authorized', 'charging', 'completed', 'expired-occupied',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isReservation(value: unknown): value is Reservation {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    reservationStatuses.includes(value.status as ReservationStatus) &&
    typeof value.maskedPlate === 'string' &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.expiresAt) &&
    ['arrivedAt', 'startedAt', 'completedAt'].every(key => value[key] === undefined || isTimestamp(value[key])) &&
    (value.reviewReason === undefined || value.reviewReason === 'low-confidence' || value.reviewReason === 'plate-mismatch')
  );
}

function isReservationState(value: unknown): value is ReservationState {
  if (!isRecord(value) || !isRecord(value.bay) || !isRecord(value.capabilities)) return false;
  const { bay, capabilities } = value;
  return (
    value.mode === 'mock' &&
    isTimestamp(value.now) &&
    typeof bay.id === 'string' &&
    typeof bay.label === 'string' &&
    bayStatuses.includes(bay.status as BayStatus) &&
    typeof bay.occupied === 'boolean' &&
    (bay.barrier === 'raised' || bay.barrier === 'lowered') &&
    capabilityKeys.every(key => typeof capabilities[key] === 'boolean') &&
    (value.reservation === null || isReservation(value.reservation)) &&
    Array.isArray(value.events) &&
    value.events.every(event => isRecord(event) && typeof event.id === 'string' && isTimestamp(event.at) && typeof event.type === 'string' && typeof event.message === 'string')
  );
}

function cancellationError(): Error {
  const error = new Error('Request cancelled.');
  error.name = 'AbortError';
  return error;
}

async function requestState(
  path: string,
  { body, signal }: { body?: Record<string, unknown>; signal?: AbortSignal } = {},
): Promise<ReservationState> {
  if (configuration.error) throw new ReservationApiError('INVALID_CONFIGURATION', configuration.error);
  if (signal?.aborted) throw cancellationError();
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      if (controller.signal.aborted) throw cancellationError();
      throw new ReservationApiError('INVALID_RESPONSE', 'The simulator returned an unreadable response. Check connection setup in Activity.');
    }
    if (!response.ok) {
      if (isRecord(data) && isRecord(data.error) && typeof data.error.code === 'string' && typeof data.error.message === 'string') {
        throw new ReservationApiError(data.error.code, data.error.message, response.status);
      }
      throw new ReservationApiError('HTTP_ERROR', `The simulator returned HTTP ${response.status}. Check connection setup in Activity and retry.`, response.status);
    }
    if (!isReservationState(data)) {
      throw new ReservationApiError('INVALID_RESPONSE', 'The simulator returned an unsupported state. Check connection setup in Activity.');
    }
    return data;
  } catch (error) {
    if (signal?.aborted) throw cancellationError();
    if (timedOut) {
      throw new ReservationApiError('REQUEST_TIMEOUT', 'The simulator did not respond within 7 seconds. Check connection setup in Activity and retry.');
    }
    if (error instanceof ReservationApiError) throw error;
    throw new ReservationApiError('NETWORK_ERROR', 'Could not reach the laptop simulator. Check connection setup in Activity and retry.');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export function fetchReservationState({ signal }: { signal?: AbortSignal } = {}): Promise<ReservationState> {
  return requestState('/api/state', { signal });
}

export function createReservation(plate: string, holdMinutes: number): Promise<ReservationState> {
  return requestState('/api/reservations', { body: { plate, holdMinutes } });
}

export function performAction(action: ReservationAction, options: ReservationActionOptions = {}): Promise<ReservationState> {
  return requestState('/api/actions', { body: { ...options, action } });
}
