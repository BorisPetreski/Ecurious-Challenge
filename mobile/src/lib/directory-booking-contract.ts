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
  /** Caller-owned current and future bookings, even outside the queried map. */
  myBookings?: DirectoryBooking[];
}

export interface DirectoryReservation {
  id: string;
  stationId: number;
  slotKey: string;
  status: 'held' | 'cancelled' | 'expired';
  createdAt: string;
  expiresAt: string;
}

export interface DirectoryBooking extends DirectoryReservation {
  bookingMode: 'legacy' | 'now' | 'scheduled';
  startsAt: string;
  protectionStartsAt: string;
  reservationFeeCents: number;
  paymentStatus: 'not_required' | 'mock_paid';
  extensionMinutes: number;
}

export interface DirectoryBookingOptions {
  bookingMode: 'now' | 'scheduled';
  startsAt?: string;
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
  const validHolds = value.holds.every(hold => {
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
  if (!validHolds) return false;
  if (value.myBookings === undefined) return true; // Earlier read contract.
  if (!Array.isArray(value.myBookings) || value.myBookings.length > 10_000) return false;
  const bookingIds = new Set<string>();
  return value.myBookings.every(booking => {
    if (!isDirectoryBooking(booking) || booking.status !== 'held' || Date.parse(booking.expiresAt) <= serverNow || bookingIds.has(booking.id)) return false;
    bookingIds.add(booking.id);
    return true;
  });
}

export function isDirectoryReservation(value: unknown): value is DirectoryReservation {
  return record(value) && isUuid(value.id) && isDirectoryStationId(value.stationId) && isDirectorySlotKey(value.slotKey) &&
    ['held', 'cancelled', 'expired'].includes(value.status as string) && timestamp(value.createdAt) && timestamp(value.expiresAt) &&
    Date.parse(value.expiresAt) > Date.parse(value.createdAt);
}

export function isDirectoryBooking(value: unknown): value is DirectoryBooking {
  if (!isDirectoryReservation(value) || !record(value) || !['legacy', 'now', 'scheduled'].includes(value.bookingMode as string) ||
    !timestamp(value.startsAt) || !timestamp(value.protectionStartsAt) ||
    typeof value.reservationFeeCents !== 'number' || !Number.isInteger(value.reservationFeeCents) || value.reservationFeeCents < 0 || value.reservationFeeCents > 1200 ||
    !['not_required', 'mock_paid'].includes(value.paymentStatus as string) ||
    typeof value.extensionMinutes !== 'number' || !Number.isInteger(value.extensionMinutes) || value.extensionMinutes < 0 || value.extensionMinutes > 110 || value.extensionMinutes % 10 !== 0) return false;
  const start = Date.parse(value.startsAt);
  const protection = Date.parse(value.protectionStartsAt);
  const end = Date.parse(value.expiresAt);
  if (protection > start || protection < start - 10 * 60_000 || end <= start) return false;
  if (value.bookingMode !== 'legacy' && end !== start + (10 + value.extensionMinutes) * 60_000) return false;
  const expectedFee = (value.bookingMode === 'scheduled' ? 100 : 0) + value.extensionMinutes * 10;
  return value.reservationFeeCents === expectedFee && value.paymentStatus === (expectedFee ? 'mock_paid' : 'not_required');
}
