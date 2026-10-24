import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { isBookingReservation, isBookingSnapshot, isUuid, type BookingReservation, type BookingSnapshot, type HoldMinutes } from './booking-contract';
import {
  canonicalDirectoryStationIds, isDirectoryBooking, isDirectoryHoldSnapshot, isDirectoryReservation, isDirectorySlotKey, isDirectoryStationId,
  type DirectoryBooking, type DirectoryBookingOptions, type DirectoryHoldSnapshot, type DirectoryReservation,
} from './directory-booking-contract';
export { isBookingReservation, isBookingSnapshot } from './booking-contract';
export type { BayAvailability, BayConnector, BookingSnapshot, BookingReservation, HoldMinutes } from './booking-contract';
export type { DirectoryBooking, DirectoryBookingOptions } from './directory-booking-contract';

export class BookingApiError extends Error {
  constructor(message: string, readonly code = 'BOOKING_UNAVAILABLE') {
    super(message);
    this.name = 'BookingApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Reject privileged server keys before constructing a client. Legacy anon keys
// are JWTs; their public role claim must explicitly say "anon".
function isPublicKey(value: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(value)) return true;
  const payload = value.split('.')[1];
  if (!payload || value.split('.').length !== 3) return false;
  try {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let bits = 0;
    let bitCount = 0;
    let decoded = '';
    for (const character of payload.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')) {
      const digit = alphabet.indexOf(character);
      if (digit < 0) return false;
      bits = (bits << 6) | digit;
      bitCount += 6;
      if (bitCount >= 8) {
        bitCount -= 8;
        decoded += String.fromCharCode((bits >> bitCount) & 255);
      }
    }
    const claims: unknown = JSON.parse(decoded);
    return isRecord(claims) && claims.role === 'anon';
  } catch {
    return false;
  }
}

const configuredUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
const configuredKey = (process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY)?.trim() ?? '';

function validConfiguration(): boolean {
  try {
    const url = new URL(configuredUrl);
    return (url.protocol === 'https:' || (__DEV__ && url.protocol === 'http:')) &&
      !url.username && !url.password && !url.search && !url.hash &&
      (url.pathname === '/' || url.pathname === '') && isPublicKey(configuredKey);
  } catch {
    return false;
  }
}

export const BOOKINGS_CONFIGURED = validConfiguration();

interface StorageIndex { version: 1; generation: string; count: number }
const sessionMemory = new Map<string, string>();
const storageOperations = new Map<string, Promise<unknown>>();

function serialStorage<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = storageOperations.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  storageOperations.set(key, next);
  void next.finally(() => {
    if (storageOperations.get(key) === next) storageOperations.delete(key);
  }).catch(() => undefined);
  return next;
}

async function readStorageIndex(key: string): Promise<StorageIndex | null> {
  const stored = await SecureStore.getItemAsync(`${key}.index`);
  if (stored === null) return null;
  try {
    const value: unknown = JSON.parse(stored);
    if (isRecord(value) && value.version === 1 && isUuid(value.generation) &&
      typeof value.count === 'number' && Number.isInteger(value.count) && value.count > 0 && value.count <= 128) {
      return { version: 1, generation: value.generation, count: value.count };
    }
  } catch { /* An unreadable session is not treated as a new identity. */ }
  throw new BookingApiError('The saved booking session could not be restored. Restart the app before making a new reservation.', 'SESSION_STORAGE');
}

async function removeChunks(key: string, index: StorageIndex): Promise<void> {
  for (let number = 0; number < index.count; number += 1) {
    await SecureStore.deleteItemAsync(`${key}.${index.generation}.${number}`);
  }
}

// SecureStore can reject large values on some native platforms. Every chunk is
// at most 400 Unicode code points (at most 1,600 UTF-8 bytes); the index is tiny.
// Operations are serialized so refresh-token rotation cannot mix generations.
const sessionStorage = {
  getItem: (key: string): Promise<string | null> => serialStorage(key, async () => {
    if (Platform.OS === 'web') return sessionMemory.get(key) ?? null;
    const index = await readStorageIndex(key);
    if (!index) return null;
    let value = '';
    for (let number = 0; number < index.count; number += 1) {
      const chunk = await SecureStore.getItemAsync(`${key}.${index.generation}.${number}`);
      if (chunk === null) throw new BookingApiError('The saved booking session is incomplete. Restart the app before making a new reservation.', 'SESSION_STORAGE');
      value += chunk;
    }
    return value;
  }),
  setItem: (key: string, value: string): Promise<void> => serialStorage(key, async () => {
    if (Platform.OS === 'web') {
      sessionMemory.set(key, value);
      return;
    }
    const characters = Array.from(value);
    const count = Math.ceil(characters.length / 400);
    if (count < 1 || count > 128) throw new BookingApiError('The booking session could not be saved on this device.', 'SESSION_STORAGE');
    const previous = await readStorageIndex(key);
    const index: StorageIndex = { version: 1, generation: randomUUID(), count };
    let written = 0;
    try {
      for (; written < count; written += 1) {
        await SecureStore.setItemAsync(`${key}.${index.generation}.${written}`, characters.slice(written * 400, (written + 1) * 400).join(''), {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
      }
      await SecureStore.setItemAsync(`${key}.index`, JSON.stringify(index), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    } catch (error) {
      await removeChunks(key, { ...index, count: written }).catch(() => undefined);
      throw error;
    }
    // Once the new index is committed, failure to remove an obsolete generation
    // must not turn a successful session save into a failed reservation attempt.
    if (previous) await removeChunks(key, previous).catch(() => undefined);
  }),
  removeItem: (key: string): Promise<void> => serialStorage(key, async () => {
    if (Platform.OS === 'web') {
      sessionMemory.delete(key);
      return;
    }
    const previous = await readStorageIndex(key);
    await SecureStore.deleteItemAsync(`${key}.index`);
    if (previous) await removeChunks(key, previous).catch(() => undefined);
  }),
};

const boundedFetch: typeof fetch = async (input, init) => {
  const controller = new AbortController();
  const parentSignal = init?.signal;
  const abort = () => controller.abort();
  if (parentSignal?.aborted) controller.abort();
  parentSignal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 8_000);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const body = await response.text();
    if (body.length > 1_000_000) throw new BookingApiError('The booking service returned an oversized response. Refresh and try again.');
    return new Response(response.status === 204 || response.status === 205 || response.status === 304 ? null : body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', abort);
  }
};

let client: SupabaseClient | null = null;
let sessionPromise: Promise<void> | null = null;

function getClient(): SupabaseClient {
  if (!BOOKINGS_CONFIGURED) throw new BookingApiError('Shared reservations need a Supabase project URL and public key. Configure them and restart Expo.', 'NOT_CONFIGURED');
  client ??= createClient(configuredUrl, configuredKey, {
    auth: {
      storage: sessionStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    global: { fetch: boundedFetch },
  });
  return client;
}

/** Account screens reuse the booking session and its native secure persistence. */
export function getBookingAccountClient(): SupabaseClient { return getClient(); }

export function setBookingAuthActive(active: boolean): void {
  if (!BOOKINGS_CONFIGURED) return;
  const auth = getClient().auth;
  if (active) void auth.startAutoRefresh();
  else void auth.stopAutoRefresh();
}

async function ensureSession(): Promise<void> {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    const auth = getClient().auth;
    const existing = await auth.getSession();
    if (existing.error) throw new BookingApiError('Your booking session could not be restored. Check the connection and refresh before reserving.', 'AUTH_REQUIRED');
    if (existing.data.session) return;
    const result = await auth.signInAnonymously();
    if (result.error || !result.data.session) {
      if (result.error?.code === 'anonymous_provider_disabled') {
        throw new BookingApiError('Enable anonymous sign-ins in this Supabase project to use shared app reservations.', 'ANONYMOUS_AUTH_DISABLED');
      }
      throw new BookingApiError('Could not start a booking session. Check the connection and anonymous sign-in settings, then refresh.', 'AUTH_REQUIRED');
    }
  })();
  try {
    await sessionPromise;
  } finally {
    sessionPromise = null;
  }
}

/** Reuse the guest identity for our backend; never expose a hardware credential. */
export async function getBookingAccessToken(): Promise<string> {
  await ensureSession();
  const result = await getClient().auth.getSession();
  const token = result.data.session?.access_token;
  if (result.error || !token) throw new BookingApiError('Your booking session needs to reconnect before using the designated bay.', 'AUTH_REQUIRED');
  return token;
}

const RPC_ERRORS: Record<string, string> = {
  AUTH_REQUIRED: 'Your booking session needs to reconnect. Refresh before reserving.',
  BAY_NOT_FOUND: 'This bay is no longer registered for reservations. Refresh the map.',
  BAY_DISABLED: 'Reservations are currently disabled for this bay.',
  BAY_NOT_BOOKABLE: 'This bay is not available for app reservations. Live hardware reservations are not enabled.',
  BAY_RESERVED: 'Someone else has reserved this bay. Refresh to see when the hold ends.',
  INVALID_HOLD: 'Choose a reservation hold of 5, 10, or 15 minutes.',
  CONNECTOR_REQUIRED: 'Choose an individual connector before confirming your reservation.',
  CONNECTOR_NOT_AVAILABLE: 'This connector is unavailable or belongs to another bay. Refresh and choose again.',
  REQUEST_ID_REQUIRED: 'The reservation request could not be identified. Refresh and try again.',
  IDEMPOTENCY_CONFLICT: 'This request conflicts with an earlier hold. Refresh before reserving again.',
  RESERVATION_NOT_FOUND: 'This reservation no longer belongs to your session or has already ended. Refresh the map.',
  INVALID_STATION: 'This directory location cannot be identified. Search the map again.',
  INVALID_STATIONS: 'The directory area is too large or invalid. Search a smaller area and refresh reservations.',
  INVALID_SLOT: 'This listed plug cannot be identified. Search the map again and choose a plug.',
  PLUG_RESERVED: 'Someone else has reserved this listed plug in BayReady. Refresh to see when the hold ends.',
  INVALID_BOOKING_MODE: 'Choose Reserve now or Schedule arrival.',
  INVALID_SCHEDULE: 'Choose an arrival time in the future and within the next seven days.',
  BOOKING_NOT_ACTIVE: 'This booking has ended. Refresh before making another reservation.',
  EXTENSION_LIMIT: 'This booking has reached its extension limit.',
};

function rpcFailure(error: unknown, mutation: boolean): BookingApiError {
  if (isRecord(error) && typeof error.message === 'string') {
    const code = Object.keys(RPC_ERRORS).find(candidate => error.message === candidate);
    if (code) return new BookingApiError(RPC_ERRORS[code], code);
    if (error.code === 'PGRST202' || error.code === '42P01') {
      return new BookingApiError('The Supabase reservation schema is not installed yet. Apply the project migration, then refresh.', 'SCHEMA_MISSING');
    }
  }
  return new BookingApiError(mutation
    ? 'The reservation result could not be confirmed. Refresh before trying again; the request may already have succeeded.'
    : 'Shared reservations could not be refreshed. Last reported holds may have changed; check the connection and retry.');
}

export async function fetchBookingSnapshot(signal?: AbortSignal): Promise<BookingSnapshot> {
  try {
    await ensureSession();
    if (signal?.aborted) throw new Error('Request cancelled');
    const request = getClient().rpc('list_bay_availability').retry(false);
    const { data, error } = await (signal ? request.abortSignal(signal) : request);
    if (error) throw rpcFailure(error, false);
    if (!isBookingSnapshot(data)) throw new BookingApiError('The booking service returned an unsupported availability response. Update the app and refresh.', 'INVALID_RESPONSE');
    return data;
  } catch (error) {
    if (error instanceof BookingApiError) throw error;
    throw rpcFailure(error, false);
  }
}

export async function reserveBay(bayId: string, minutes: HoldMinutes, connectorId: string): Promise<BookingReservation> {
  if (!isUuid(bayId) || !isUuid(connectorId) || ![5, 10, 15].includes(minutes)) throw new BookingApiError('Select a registered bay and a hold of 5, 10, or 15 minutes.', 'INVALID_HOLD');
  try {
    await ensureSession();
    const { data, error } = await getClient().rpc('reserve_bay', {
      p_bay_id: bayId,
      p_hold_minutes: minutes,
      p_request_id: randomUUID(),
      p_connector_id: connectorId,
    }).retry(false);
    if (error) throw rpcFailure(error, true);
    if (!isBookingReservation(data) || data.bayId !== bayId || data.connectorId !== connectorId) throw new BookingApiError('The reservation result was unreadable. Refresh before trying again; the bay may already be held.', 'INVALID_RESPONSE');
    return data;
  } catch (error) {
    if (error instanceof BookingApiError) throw error;
    throw rpcFailure(error, true);
  }
}

export async function cancelBooking(reservationId: string): Promise<BookingReservation> {
  if (!isUuid(reservationId)) throw new BookingApiError('Refresh the map to restore your reservation before cancelling.', 'RESERVATION_NOT_FOUND');
  try {
    await ensureSession();
    const { data, error } = await getClient().rpc('cancel_reservation', { p_reservation_id: reservationId }).retry(false);
    if (error) throw rpcFailure(error, true);
    if (!isBookingReservation(data) || data.id !== reservationId) throw new BookingApiError('The cancellation result was unreadable. Refresh to check whether your hold ended.', 'INVALID_RESPONSE');
    return data;
  } catch (error) {
    if (error instanceof BookingApiError) throw error;
    throw rpcFailure(error, true);
  }
}

/** Reads app-only virtual-slot holds, never a directory catalog or occupancy feed. */
export async function fetchDirectoryHolds(stationIds: readonly number[], signal?: AbortSignal): Promise<DirectoryHoldSnapshot> {
  const ids = canonicalDirectoryStationIds(stationIds);
  if (!ids) throw new BookingApiError(RPC_ERRORS.INVALID_STATIONS, 'INVALID_STATIONS');
  try {
    await ensureSession();
    if (signal?.aborted) throw new Error('Request cancelled');
    const request = getClient().rpc('list_directory_holds', { p_station_ids: ids }).retry(false);
    const { data, error } = await (signal ? request.abortSignal(signal) : request);
    if (error) throw rpcFailure(error, false);
    if (!isDirectoryHoldSnapshot(data, ids)) throw new BookingApiError('The booking service returned unsupported directory holds. Update the app and refresh.', 'INVALID_RESPONSE');
    return data;
  } catch (error) {
    if (error instanceof BookingApiError) throw error;
    throw rpcFailure(error, false);
  }
}

export async function reserveDirectoryPlug(stationId: number, slotKey: string, minutes: HoldMinutes): Promise<DirectoryReservation> {
  if (!isDirectoryStationId(stationId)) throw new BookingApiError(RPC_ERRORS.INVALID_STATION, 'INVALID_STATION');
  if (!isDirectorySlotKey(slotKey)) throw new BookingApiError(RPC_ERRORS.INVALID_SLOT, 'INVALID_SLOT');
  if (minutes !== 10) throw new BookingApiError('Reserve now provides ten free minutes. Use Extend for another ten minutes at a mock €1.', 'INVALID_HOLD');
  try {
    await ensureSession();
    const { data, error } = await getClient().rpc('reserve_directory_plug', {
      p_station_id: stationId,
      p_slot_key: slotKey,
      p_hold_minutes: minutes,
      p_request_id: randomUUID(),
    }).retry(false);
    if (error) throw rpcFailure(error, true);
    if (!isDirectoryReservation(data) || data.stationId !== stationId || data.slotKey !== slotKey) {
      throw new BookingApiError('The directory hold result was unreadable. Refresh before trying again; the listed plug may already be held.', 'INVALID_RESPONSE');
    }
    return data;
  } catch (error) {
    if (error instanceof BookingApiError) throw error;
    throw rpcFailure(error, true);
  }
}

/** Software-only public-directory booking; a fee is a mock record, never a charge. */
export async function reserveDirectoryBooking(
  stationId: number, slotKey: string, options: DirectoryBookingOptions, requestId = randomUUID(),
): Promise<DirectoryBooking> {
  if (!isDirectoryStationId(stationId)) throw new BookingApiError(RPC_ERRORS.INVALID_STATION, 'INVALID_STATION');
  if (!isDirectorySlotKey(slotKey)) throw new BookingApiError(RPC_ERRORS.INVALID_SLOT, 'INVALID_SLOT');
  if (!options || !['now', 'scheduled'].includes(options.bookingMode)) throw new BookingApiError(RPC_ERRORS.INVALID_BOOKING_MODE, 'INVALID_BOOKING_MODE');
  if (!isUuid(requestId)) throw new BookingApiError(RPC_ERRORS.REQUEST_ID_REQUIRED, 'REQUEST_ID_REQUIRED');
  if (options.bookingMode === 'now' ? options.startsAt !== undefined : typeof options.startsAt !== 'string' || !Number.isFinite(Date.parse(options.startsAt))) {
    throw new BookingApiError(RPC_ERRORS.INVALID_SCHEDULE, 'INVALID_SCHEDULE');
  }
  try {
    await ensureSession();
    const { data, error } = await getClient().rpc('reserve_directory_booking', {
      p_station_id: stationId, p_slot_key: slotKey, p_booking_mode: options.bookingMode,
      p_starts_at: options.bookingMode === 'scheduled' ? options.startsAt : null, p_request_id: requestId,
    }).retry(false);
    if (error) throw rpcFailure(error, true);
    if (!isDirectoryBooking(data) || data.stationId !== stationId || data.slotKey !== slotKey || data.bookingMode !== options.bookingMode ||
      options.bookingMode === 'scheduled' && Date.parse(data.startsAt) !== Date.parse(options.startsAt!)) {
      throw new BookingApiError('The booking result was unreadable. Refresh before trying again; it may already have succeeded.', 'INVALID_RESPONSE');
    }
    return data;
  } catch (error) {
    if (error instanceof BookingApiError) throw error;
    throw rpcFailure(error, true);
  }
}

export async function extendDirectoryBooking(reservationId: string, requestId = randomUUID()): Promise<DirectoryBooking> {
  if (!isUuid(reservationId)) throw new BookingApiError(RPC_ERRORS.RESERVATION_NOT_FOUND, 'RESERVATION_NOT_FOUND');
  if (!isUuid(requestId)) throw new BookingApiError(RPC_ERRORS.REQUEST_ID_REQUIRED, 'REQUEST_ID_REQUIRED');
  try {
    await ensureSession();
    const { data, error } = await getClient().rpc('extend_directory_booking', {
      p_reservation_id: reservationId, p_request_id: requestId,
    }).retry(false);
    if (error) throw rpcFailure(error, true);
    if (!isDirectoryBooking(data) || data.id !== reservationId) {
      throw new BookingApiError('The extension result was unreadable. Refresh before trying again; it may already have succeeded.', 'INVALID_RESPONSE');
    }
    return data;
  } catch (error) {
    if (error instanceof BookingApiError) throw error;
    throw rpcFailure(error, true);
  }
}

export async function cancelDirectoryHold(reservationId: string): Promise<DirectoryReservation> {
  if (!isUuid(reservationId)) throw new BookingApiError(RPC_ERRORS.RESERVATION_NOT_FOUND, 'RESERVATION_NOT_FOUND');
  try {
    await ensureSession();
    const { data, error } = await getClient().rpc('cancel_directory_hold', { p_reservation_id: reservationId }).retry(false);
    if (error) throw rpcFailure(error, true);
    if (!isDirectoryReservation(data) || data.id !== reservationId) {
      throw new BookingApiError('The directory cancellation result was unreadable. Refresh to check whether your hold ended.', 'INVALID_RESPONSE');
    }
    return data;
  } catch (error) {
    if (error instanceof BookingApiError) throw error;
    throw rpcFailure(error, true);
  }
}
