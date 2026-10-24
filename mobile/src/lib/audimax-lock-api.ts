import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export const AUDIMAX_API_KEY =
  process.env.EXPO_PUBLIC_AUDIMAX_API_KEY?.trim() ||
  process.env.EXPO_PUBLIC_ECURIOUS_API_KEY?.trim() ||
  '';
export const AUDIMAX_BASE_URL =
  process.env.EXPO_PUBLIC_AUDIMAX_BASE_URL?.trim() ||
  'https://parking-lock-service-production.up.railway.app';
export const AUDIMAX_COORDINATES = { latitude: 48.1488, longitude: 11.568 };
export const PREFERRED_LOCK_ID = 'lock-0002';

const ACTIVE_HOLD_STORAGE_KEY = 'bayready.audimax.active-hold.v1';
const webStorage = new Map<string, string>();

export interface AudimaxLock {
  id: string;
  name: string;
  serialHex?: string;
  hasCamera?: boolean;
  status: 'raised' | 'lowered' | string;
  carPresence: 'vacant' | 'occupied' | string;
  battery12V?: number;
  battery3_7V?: number;
  signalStrength4G?: number;
  waterIngress?: boolean;
  activeErrors?: string[];
  lastSeenAt?: string;
  whitelist?: string[];
  latestPhoto?: {
    timestamp: string;
    licensePlate: string;
    plateType?: string;
  };
}

export interface AudimaxLocksResponse {
  team?: string;
  locks: AudimaxLock[];
}

export const AUDIMAX_HOLD_SECONDS = 30;

export interface AudimaxActiveHold {
  lockId: string;
  lockName: string;
  plate: string;
  reservedAt: string;
  bookingMode: 'now' | 'scheduled';
  startsAt?: string;
  raiseAt: string;
  expiresAt: string;
  status: 'scheduled' | 'active' | 'occupied';
}

async function readStorage(key: string): Promise<string | null> {
  try {
    return Platform.OS === 'web' ? webStorage.get(key) ?? null : await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function writeStorage(key: string, value: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      webStorage.set(key, value);
    } else {
      await SecureStore.setItemAsync(key, value);
    }
  } catch {}
}

async function deleteStorage(key: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      webStorage.delete(key);
    } else {
      await SecureStore.deleteItemAsync(key);
    }
  } catch {}
}

export async function getStoredActiveHold(): Promise<AudimaxActiveHold | null> {
  const raw = await readStorage(ACTIVE_HOLD_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AudimaxActiveHold;
  } catch {
    return null;
  }
}

export async function setStoredActiveHold(hold: AudimaxActiveHold | null): Promise<void> {
  if (!hold) {
    await deleteStorage(ACTIVE_HOLD_STORAGE_KEY);
  } else {
    await writeStorage(ACTIVE_HOLD_STORAGE_KEY, JSON.stringify(hold));
  }
}

export async function fetchAudimaxLocks(): Promise<AudimaxLocksResponse> {
  if (!AUDIMAX_API_KEY) {
    throw new Error('Missing API key. Add EXPO_PUBLIC_AUDIMAX_API_KEY to .env and restart Expo.');
  }
  const res = await fetch(`${AUDIMAX_BASE_URL}/api/v1/locks?apiKey=${AUDIMAX_API_KEY}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch Audimax locks: HTTP ${res.status}`);
  }
  const data = await res.json();
  const locks: AudimaxLock[] = Array.isArray(data.locks)
    ? data.locks
    : Array.isArray(data.assignedLocks)
    ? data.assignedLocks
    : [];
  return {
    team: typeof data.team === 'string' ? data.team : undefined,
    locks,
  };
}

export async function reserveAudimaxLock(lockId: string, plates: string[]): Promise<{ success: boolean; message?: string }> {
  // 1. Post lock command (raise barrier)
  const lockRes = await fetch(`${AUDIMAX_BASE_URL}/api/v1/locks/${encodeURIComponent(lockId)}/lock?apiKey=${AUDIMAX_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  });
  if (!lockRes.ok) {
    const text = await lockRes.text().catch(() => '');
    throw new Error(`Lock command failed (HTTP ${lockRes.status}): ${text}`);
  }

  // 2. Post whitelist with license plates
  const cleanedPlates = plates.map(p => p.trim().toUpperCase()).filter(Boolean);
  const whitelistRes = await fetch(`${AUDIMAX_BASE_URL}/api/v1/locks/${encodeURIComponent(lockId)}/whitelist?apiKey=${AUDIMAX_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ plates: cleanedPlates.length > 0 ? cleanedPlates : ['*'] }),
  });
  if (!whitelistRes.ok) {
    const text = await whitelistRes.text().catch(() => '');
    throw new Error(`Whitelist update failed (HTTP ${whitelistRes.status}): ${text}`);
  }

  return { success: true };
}

export async function releaseAudimaxLock(lockId: string): Promise<{ success: boolean; message?: string }> {
  // 1. Clear whitelist: POST { plates: [] }
  const whitelistRes = await fetch(`${AUDIMAX_BASE_URL}/api/v1/locks/${encodeURIComponent(lockId)}/whitelist?apiKey=${AUDIMAX_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ plates: [] }),
  });
  if (!whitelistRes.ok) {
    const text = await whitelistRes.text().catch(() => '');
    console.warn(`Whitelist clear warning (HTTP ${whitelistRes.status}): ${text}`);
  }

  // 2. Post unlock command (lower barrier)
  const unlockRes = await fetch(`${AUDIMAX_BASE_URL}/api/v1/locks/${encodeURIComponent(lockId)}/unlock?apiKey=${AUDIMAX_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  });
  if (!unlockRes.ok) {
    const text = await unlockRes.text().catch(() => '');
    throw new Error(`Unlock command failed (HTTP ${unlockRes.status}): ${text}`);
  }

  return { success: true };
}
