import type { HoldMinutes } from './booking-contract';

export type { HoldMinutes };

export interface DirectoryHold {
  stationId: number;
  slotKey: string;
  reservedUntil: string;
  isMine: boolean;
  myReservationId: string | null;
}

export interface DirectoryHoldSnapshot {
  serverNow: string;
  holds: DirectoryHold[];
}

export interface DirectoryReservation {
  id: string;
  stationId: number;
  slotKey: string;
  status: 'held' | 'cancelled' | 'expired';
  createdAt: string;
  expiresAt: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const isDirectoryStationId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
export const isDirectorySlotKey = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

/** A complete successful read covers precisely this deduplicated station set. */
export function canonicalDirectoryStationIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > 500 || !value.every(isDirectoryStationId)) return null;
  return [...new Set<number>(value)].sort((left, right) => left - right);
}

export function isDirectoryHoldSnapshot(value: unknown, queriedStationIds?: readonly number[]): value is DirectoryHoldSnapshot {
  if (!record(value) || !timestamp(value.serverNow) || !Array.isArray(value.holds) || value.holds.length > 10_000) return false;
  const scope = queriedStationIds ? new Set(queriedStationIds) : null;
  const slots = new Set<string>();
  const ownedIds = new Set<string>();
  const serverNow = Date.parse(value.serverNow);
  return value.holds.every(hold => {
    if (!record(hold) || !isDirectoryStationId(hold.stationId) || !isDirectorySlotKey(hold.slotKey) ||
      !timestamp(hold.reservedUntil) || Date.parse(hold.reservedUntil) <= serverNow || typeof hold.isMine !== 'boolean' ||
      (hold.isMine ? !isUuid(hold.myReservationId) : hold.myReservationId !== null)) return false;
    // Own active holds remain cancellable after a viewport or catalog change.
    if (scope && !scope.has(hold.stationId) && !hold.isMine) return false;
    const identity = `${hold.stationId}:${hold.slotKey}`;
    if (slots.has(identity)) return false;
    slots.add(identity);
    if (hold.isMine) {
      const id = hold.myReservationId as string;
      if (ownedIds.has(id)) return false;
      ownedIds.add(id);
    }
    return true;
  });
}

export function isDirectoryReservation(value: unknown): value is DirectoryReservation {
  return record(value) && isUuid(value.id) && isDirectoryStationId(value.stationId) && isDirectorySlotKey(value.slotKey) &&
    ['held', 'cancelled', 'expired'].includes(value.status as string) && timestamp(value.createdAt) && timestamp(value.expiresAt) &&
    Date.parse(value.expiresAt) > Date.parse(value.createdAt);
}
