import { BookingApiError, getBookingAccountClient } from './bookings-api';
import { isUuid } from './booking-contract';

export interface PrivacyRequest {
  id: string;
  status: 'pending_review';
  requestedAt: string;
  updatedAt: string;
  hasActiveHardwareBookings: boolean;
  notice: string;
}

export interface CloudDataExport {
  schemaVersion: 1;
  generatedAt: string;
  ownerId: string;
  directoryReservations: Record<string, unknown>[];
  directoryExtensions: Record<string, unknown>[];
  bayReservations: Record<string, unknown>[];
  hardwareBookings: Record<string, unknown>[];
  hardwareExtensions: Record<string, unknown>[];
  erasureRequest: PrivacyRequest | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function timestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}
function isRequest(value: unknown): value is PrivacyRequest {
  return record(value) && isUuid(value.id) && value.status === 'pending_review' && timestamp(value.requestedAt) &&
    timestamp(value.updatedAt) && typeof value.hasActiveHardwareBookings === 'boolean' &&
    typeof value.notice === 'string' && value.notice.length <= 2000;
}
function rows(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.length <= 10000 && value.every(record);
}

/** Only the existing account is used. Privacy reads never create a new guest. */
async function owner(): Promise<string> {
  const { data, error } = await getBookingAccountClient().auth.getUser();
  if (error || !data.user) throw new BookingApiError('Reconnect your existing booking account before accessing its data.', 'AUTH_REQUIRED');
  return data.user.id;
}

async function rpc(name: string, mutation = false): Promise<{ data: unknown; ownerId: string }> {
  const ownerId = await owner();
  try {
    const { data, error } = await getBookingAccountClient().rpc(name).retry(false);
    if (error) throw new Error('Privacy RPC unavailable');
    if (await owner() !== ownerId) throw new Error('Account changed');
    return { data, ownerId };
  } catch {
    throw new BookingApiError(mutation
      ? 'The deletion request could not be confirmed. Refresh its status before trying again; a request may already be recorded.'
      : 'Your cloud data could not be loaded. Nothing was deleted. Check your connection and refresh; the privacy database update may still be pending.', 'PRIVACY_UNAVAILABLE');
  }
}

export async function fetchCloudDataExport(): Promise<CloudDataExport> {
  const { data, ownerId } = await rpc('export_my_bayready_data');
  if (!record(data) || data.schemaVersion !== 1 || !timestamp(data.generatedAt) || data.ownerId !== ownerId ||
    !rows(data.directoryReservations) || !rows(data.directoryExtensions) || !rows(data.bayReservations) ||
    !rows(data.hardwareBookings) || !rows(data.hardwareExtensions) ||
    (data.erasureRequest !== null && !isRequest(data.erasureRequest))) {
    throw new BookingApiError('Cloud export returned an unsupported response. No incomplete export was shared.', 'INVALID_RESPONSE');
  }
  // Project known fields instead of forwarding unexpected metadata or auth data.
  return { schemaVersion: 1, generatedAt: data.generatedAt, ownerId,
    directoryReservations: data.directoryReservations, directoryExtensions: data.directoryExtensions,
    bayReservations: data.bayReservations, hardwareBookings: data.hardwareBookings,
    hardwareExtensions: data.hardwareExtensions, erasureRequest: data.erasureRequest };
}

export async function fetchPrivacyRequest(): Promise<PrivacyRequest | null> {
  const { data } = await rpc('get_my_privacy_request');
  if (data !== null && !isRequest(data)) throw new BookingApiError('Deletion request status could not be read. No deletion is confirmed.', 'INVALID_RESPONSE');
  return data;
}

export async function requestAccountDataErasure(): Promise<PrivacyRequest> {
  const { data } = await rpc('request_my_data_erasure', true);
  if (!isRequest(data)) throw new BookingApiError('Deletion request result is unknown. Refresh its status before retrying.', 'INVALID_RESPONSE');
  return data;
}
