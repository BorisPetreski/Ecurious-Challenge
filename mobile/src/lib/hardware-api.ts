import { API_BASE_URL } from '@/lib/reservation-api';

export interface HardwareLock {
  id: string;
  name: string;
  hasCamera: boolean;
  status: string;
  lastSeenAt: string | null;
  telemetryFresh: boolean;
  barrier: 'raised' | 'lowered' | 'unknown';
  occupancy: 'vacant' | 'occupied' | 'unknown';
  lastReportedPresence: 'vacant' | 'occupied' | 'unknown';
  activeErrors: string[];
  waterIngress: boolean | null;
  battery12V: number | null;
  battery3_7V: number | null;
  signalStrength4G: number | null;
  whitelist: {
    mode: 'any-plate' | 'specific-plates' | 'disabled' | 'unknown';
    count: number | null;
  };
  plateObservation: { detected: boolean; timestamp: string | null } | null;
}

export interface HardwareSnapshot {
  source: 'ecurious';
  access: 'read-only';
  configured: boolean;
  fetchedAt: string;
  team: string | null;
  locks: HardwareLock[];
  freshnessLimitMs: number;
}

class HardwareApiError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isOptionalTimestamp(value: unknown): boolean {
  return value === null || isTimestamp(value);
}

function isOptionalNumber(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isPresence(value: unknown): boolean {
  return value === 'vacant' || value === 'occupied' || value === 'unknown';
}

function isHardwareLock(value: unknown): value is HardwareLock {
  if (!isRecord(value) || !isRecord(value.whitelist)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.hasCamera === 'boolean' &&
    typeof value.status === 'string' &&
    isOptionalTimestamp(value.lastSeenAt) &&
    typeof value.telemetryFresh === 'boolean' &&
    ['raised', 'lowered', 'unknown'].includes(value.barrier as string) &&
    isPresence(value.occupancy) &&
    isPresence(value.lastReportedPresence) &&
    Array.isArray(value.activeErrors) && value.activeErrors.every(error => typeof error === 'string') &&
    (value.waterIngress === null || typeof value.waterIngress === 'boolean') &&
    isOptionalNumber(value.battery12V) &&
    isOptionalNumber(value.battery3_7V) &&
    isOptionalNumber(value.signalStrength4G) &&
    ['any-plate', 'specific-plates', 'disabled', 'unknown'].includes(value.whitelist.mode as string) &&
    (value.whitelist.count === null || (typeof value.whitelist.count === 'number' && Number.isInteger(value.whitelist.count) && value.whitelist.count >= 0)) &&
    (value.plateObservation === null || (isRecord(value.plateObservation) && typeof value.plateObservation.detected === 'boolean' && isOptionalTimestamp(value.plateObservation.timestamp)))
  );
}

function isHardwareSnapshot(value: unknown): value is HardwareSnapshot {
  if (!isRecord(value)) return false;
  return (
    value.source === 'ecurious' &&
    value.access === 'read-only' &&
    typeof value.configured === 'boolean' &&
    isTimestamp(value.fetchedAt) &&
    (value.team === null || typeof value.team === 'string') &&
    typeof value.freshnessLimitMs === 'number' && Number.isFinite(value.freshnessLimitMs) && value.freshnessLimitMs > 0 &&
    Array.isArray(value.locks) && value.locks.every(isHardwareLock)
  );
}

/** The phone calls our backend only; the Ecurious key stays on the laptop. */
export async function fetchHardwareSnapshot(signal: AbortSignal): Promise<HardwareSnapshot> {
  if (!API_BASE_URL.startsWith('http://') && !API_BASE_URL.startsWith('https://')) {
    throw new HardwareApiError('The laptop API address is invalid. Check connection setup below and restart Expo.');
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 12_000);

  try {
    const response = await fetch(`${API_BASE_URL}/api/hardware`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      if (controller.signal.aborted) throw new Error('Request cancelled');
      throw new HardwareApiError('The laptop returned an unreadable hardware response. Restart the backend and retry.');
    }
    if (!response.ok) {
      if (isRecord(data) && isRecord(data.error) && typeof data.error.message === 'string') {
        throw new HardwareApiError(data.error.message);
      }
      throw new HardwareApiError(`Hardware status is unavailable (HTTP ${response.status}). Retry the hardware connection.`);
    }
    if (!isHardwareSnapshot(data)) {
      throw new HardwareApiError('The laptop returned an unsupported hardware response. Update and restart the backend.');
    }
    return data;
  } catch (error) {
    if (signal.aborted) {
      const cancelled = new Error('Request cancelled');
      cancelled.name = 'AbortError';
      throw cancelled;
    }
    if (timedOut) throw new HardwareApiError('Hardware status did not respond within 12 seconds. Retry the hardware connection.');
    if (error instanceof HardwareApiError) throw error;
    throw new HardwareApiError('Could not reach hardware status through the laptop. Keep the backend running and check the phone’s Wi-Fi.');
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}
