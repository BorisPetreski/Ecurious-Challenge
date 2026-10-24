import { randomUUID } from 'expo-crypto';

import { BOOKINGS_CONFIGURED, getBookingAccessToken } from '@/lib/bookings-api';
import { API_BASE_URL } from '@/lib/reservation-api';

export type HardwareSlotStatus = 'scheduled' | 'active' | 'blocked' | 'cancel_requested' | 'cancelled' | 'completed' | 'expired';
export type HardwareBookingMode = 'now' | 'scheduled';
export interface HardwareSlot {
  id: string | null;
  bayId: string;
  connectorId: string;
  startsAt: string;
  endsAt: string;
  status: HardwareSlotStatus;
  isMine: boolean;
  canCancel: boolean;
  maskedPlate: string | null;
  arrivedAt: string | null;
  departedAt: string | null;
  activatedAt: string | null;
  mockFeeCents: number | null;
  bookingMode?: HardwareBookingMode;
  reservationFeeCents?: number | null;
  paymentStatus?: 'free' | 'mock_free' | 'mock_paid' | 'mock_refunded' | null;
  protectionStartsAt?: string;
  requestedBayId?: string | null;
  requestedConnectorId?: string | null;
  extensionCount?: number | null;
  failureReason?: string | null;
  fallbackReason?: string | null;
}
export interface HardwareFeePolicy { currency: 'EUR'; mock: true; nowFreeMinutes?: number; extensionMinutes?: number; extensionFeeCents?: number; scheduledFeeCents?: number; protectionLeadMinutes?: number; freeMinutes?: number; rateCentsPerMinute?: number; capCents?: number; arrivalGraceMinutes?: number }
export interface HardwareAlternative { locationId: string; label: string; latitude: number | null; longitude: number | null; distanceKm: number | null; availableBays: number; connectorTypes: string[] }
export interface HardwareSlotSnapshot { serverNow: string; slots: HardwareSlot[]; policy: HardwareFeePolicy; alternatives?: HardwareAlternative[]; configured?: boolean; commandsEnabled?: boolean }
export interface HardwareQuote extends HardwareFeePolicy { startsAt: string; endsAt: string; durationMinutes: number; bookingMode: HardwareBookingMode; fixedFeeCents: number; maxChargeCents: number }
export interface HardwareSlotInput { bayId: string; connectorId: string; startsAt: string; endsAt: string; licensePlate: string; bookingMode: HardwareBookingMode }

export class HardwareSlotsError extends Error {}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const optionalTime = (value: unknown): boolean => value === null || timestamp(value);
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const statuses: HardwareSlotStatus[] = ['scheduled', 'active', 'blocked', 'cancel_requested', 'cancelled', 'completed', 'expired'];

function policy(value: unknown): value is HardwareFeePolicy {
  return record(value) && value.currency === 'EUR' && value.mock === true &&
    ['nowFreeMinutes', 'extensionMinutes', 'extensionFeeCents', 'scheduledFeeCents', 'protectionLeadMinutes', 'freeMinutes', 'rateCentsPerMinute', 'capCents'].every(key => value[key] === undefined || nonnegative(value[key])) &&
    (value.arrivalGraceMinutes === undefined || nonnegative(value.arrivalGraceMinutes) && value.arrivalGraceMinutes > 0 && value.arrivalGraceMinutes <= 120);
}

export function isHardwareSlotSnapshot(value: unknown): value is HardwareSlotSnapshot {
  if (!record(value) || !timestamp(value.serverNow) || !policy(value.policy) || !Array.isArray(value.slots) || value.slots.length > 1_000 ||
    (value.configured !== undefined && typeof value.configured !== 'boolean') || (value.commandsEnabled !== undefined && typeof value.commandsEnabled !== 'boolean')) return false;
  if (value.alternatives !== undefined && (!Array.isArray(value.alternatives) || value.alternatives.length > 100 || !value.alternatives.every(item => record(item) && uuid(item.locationId) && typeof item.label === 'string' && item.label.length <= 200 && [item.latitude, item.longitude, item.distanceKm].every(coordinate => coordinate === null || typeof coordinate === 'number' && Number.isFinite(coordinate)) && nonnegative(item.availableBays) && Array.isArray(item.connectorTypes) && item.connectorTypes.every(type => typeof type === 'string' && type.length <= 50)))) return false;
  const ids = new Set<string>();
  return value.slots.every(slot => {
    if (!record(slot) || !uuid(slot.bayId) || !uuid(slot.connectorId) || !timestamp(slot.startsAt) || !timestamp(slot.endsAt) || Date.parse(slot.endsAt) <= Date.parse(slot.startsAt) ||
      !statuses.includes(slot.status as HardwareSlotStatus) || typeof slot.isMine !== 'boolean' || typeof slot.canCancel !== 'boolean' || (slot.id !== null && !uuid(slot.id)) ||
      (slot.maskedPlate !== null && (typeof slot.maskedPlate !== 'string' || slot.maskedPlate.length > 50)) || !optionalTime(slot.arrivedAt) || !optionalTime(slot.departedAt) || !optionalTime(slot.activatedAt) ||
      (slot.mockFeeCents !== null && !nonnegative(slot.mockFeeCents)) ||
      (slot.bookingMode !== undefined && !['now', 'scheduled'].includes(slot.bookingMode as string)) ||
      (slot.reservationFeeCents !== undefined && slot.reservationFeeCents !== null && !nonnegative(slot.reservationFeeCents)) ||
      (slot.paymentStatus !== undefined && slot.paymentStatus !== null && !['free', 'mock_free', 'mock_paid', 'mock_refunded'].includes(slot.paymentStatus as string)) ||
      (slot.protectionStartsAt !== undefined && !timestamp(slot.protectionStartsAt)) ||
      (slot.requestedBayId !== undefined && slot.requestedBayId !== null && !uuid(slot.requestedBayId)) ||
      (slot.requestedConnectorId !== undefined && slot.requestedConnectorId !== null && !uuid(slot.requestedConnectorId)) ||
      (slot.extensionCount !== undefined && slot.extensionCount !== null && !nonnegative(slot.extensionCount)) ||
      (slot.failureReason !== undefined && slot.failureReason !== null && (typeof slot.failureReason !== 'string' || slot.failureReason.length > 500)) ||
      (slot.fallbackReason !== undefined && slot.fallbackReason !== null && (typeof slot.fallbackReason !== 'string' || slot.fallbackReason.length > 500))) return false;
    if (slot.isMine) { if (!uuid(slot.id) || ids.has(slot.id)) return false; ids.add(slot.id); }
    else if (slot.id !== null || slot.canCancel || slot.maskedPlate !== null || slot.arrivedAt !== null || slot.departedAt !== null || slot.activatedAt !== null || slot.mockFeeCents !== null || ['reservationFeeCents', 'paymentStatus', 'requestedBayId', 'requestedConnectorId', 'extensionCount', 'failureReason', 'fallbackReason'].some(key => slot[key] !== undefined && slot[key] !== null)) return false;
    if (slot.canCancel && ['cancel_requested', 'cancelled', 'completed', 'expired'].includes(slot.status as string)) return false;
    return true;
  });
}

export function isHardwareQuote(value: unknown): value is HardwareQuote {
  return policy(value) && record(value) && timestamp(value.startsAt) && timestamp(value.endsAt) && Date.parse(value.endsAt) > Date.parse(value.startsAt) &&
    typeof value.durationMinutes === 'number' && Number.isFinite(value.durationMinutes) && value.durationMinutes > 0 && ['now', 'scheduled'].includes(value.bookingMode as string) && nonnegative(value.fixedFeeCents) && nonnegative(value.maxChargeCents) && value.fixedFeeCents === value.maxChargeCents;
}

const messages: Record<string, string> = {
  AUTH_REQUIRED: 'Your automatic guest session needs to reconnect. Refresh before booking.',
  SLOT_OVERLAP: 'This bay already has an overlapping booking. Choose another time.',
  SLOT_CONFLICT: 'This bay already has an overlapping booking. Choose another time.',
  SLOT_RESERVED: 'This bay already has an overlapping booking. Choose another time.',
  INVALID_SLOT: 'Choose a valid 5–120 minute window within the next 7 days.',
  INVALID_WINDOW: 'Choose a valid 5–120 minute window within the next 7 days.',
  INVALID_PLATE: 'Check the vehicle plate in your saved profile.',
  HARDWARE_SETUP_REQUIRED: 'The designated hardware booking service is not configured yet.',
  SLOT_NOT_FOUND: 'This booking no longer belongs to your session. Refresh its status.',
  EXTENSION_NOT_AVAILABLE: 'This reservation cannot be extended right now. Refresh its status.',
  EXTENSION_CONFLICT: 'The next ten minutes overlap another booking. Your current deadline is unchanged.',
  LOCATION_FULL: 'This location has no compatible free bay. Check the nearby alternatives.',
};

let readsNeedAuth = false;

async function request(path: string, body?: Record<string, unknown>, signal?: AbortSignal, authenticated = false): Promise<unknown> {
  if (!/^https?:\/\//.test(API_BASE_URL)) throw new HardwareSlotsError('Check the laptop API address in Activity.');
  const mutation = !!body && path !== '/api/hardware/quote';
  const token = mutation || authenticated ? await getBookingAccessToken() : null;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 12_000);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, { method: body ? 'POST' : 'GET', headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal });
    if (response.status === 401 && !body && !authenticated && BOOKINGS_CONFIGURED) {
      readsNeedAuth = true;
      return await request(path, undefined, signal, true);
    }
    const raw = await response.text();
    if (raw.length > 1_000_000) throw new HardwareSlotsError('The booking response was too large. Refresh its status.');
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new HardwareSlotsError('The booking service returned an unreadable response.'); }
    if (!response.ok) {
      const code = record(value) && record(value.error) && typeof value.error.code === 'string' ? value.error.code : '';
      throw new HardwareSlotsError(messages[code] ?? (mutation ? 'The booking result could not be confirmed. Refresh before trying again; it may already have succeeded.' : 'The booking information could not be refreshed. Check the connection and guest sign-in settings.'));
    }
    return value;
  } catch (error) {
    if (signal?.aborted) { const cancelled = new Error('Request cancelled'); cancelled.name = 'AbortError'; throw cancelled; }
    if (error instanceof HardwareSlotsError) throw error;
    throw new HardwareSlotsError(mutation ? 'The booking outcome is unknown. Refresh before another request.' : 'Could not reach booking information through the laptop.');
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}

export async function fetchHardwareSlots(signal?: AbortSignal, bayId?: string): Promise<HardwareSlotSnapshot> {
  if (bayId !== undefined && !uuid(bayId)) throw new HardwareSlotsError('Choose a registered hardware bay.');
  const value = await request(`/api/hardware/slots${bayId ? `?bayId=${encodeURIComponent(bayId)}` : ''}`, undefined, signal, readsNeedAuth);
  if (!isHardwareSlotSnapshot(value)) throw new HardwareSlotsError('The booking service returned an unsupported schedule.');
  return value;
}
export async function fetchHardwareQuote(startsAt: string, endsAt: string, signal?: AbortSignal, bookingMode: HardwareBookingMode = 'scheduled'): Promise<HardwareQuote> {
  const value = await request('/api/hardware/quote', { startsAt, endsAt, bookingMode }, signal);
  if (!isHardwareQuote(value) || value.bookingMode !== bookingMode || bookingMode === 'scheduled' && (Date.parse(value.startsAt) !== Date.parse(startsAt) || Date.parse(value.endsAt) !== Date.parse(endsAt))) throw new HardwareSlotsError('The quote does not match your booking choice. Request a fresh quote.');
  return value;
}
export async function createHardwareSlot(input: HardwareSlotInput): Promise<HardwareSlotSnapshot> {
  const value = await request('/api/hardware/slots', { bayId: input.bayId, connectorId: input.connectorId, startsAt: input.startsAt, endsAt: input.endsAt, licensePlate: input.licensePlate, bookingMode: input.bookingMode ?? 'scheduled', requestId: randomUUID() });
  if (!isHardwareSlotSnapshot(value)) throw new HardwareSlotsError('The booking result is unreadable. Refresh before trying again.');
  return value;
}
export async function cancelHardwareSlot(slotId: string): Promise<HardwareSlotSnapshot> {
  const value = await request('/api/hardware/slots/cancel', { slotId });
  if (!isHardwareSlotSnapshot(value)) throw new HardwareSlotsError('The cancellation result is unreadable. Refresh before trying again.');
  return value;
}
export async function extendHardwareSlot(slotId: string): Promise<HardwareSlotSnapshot> {
  const value = await request('/api/hardware/slots/extend', { slotId, requestId: randomUUID() });
  if (!isHardwareSlotSnapshot(value)) throw new HardwareSlotsError('The extension result is unreadable. Refresh before trying again.');
  return value;
}
