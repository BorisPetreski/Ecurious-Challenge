export type HoldMinutes = 5 | 10 | 15;

export interface BayConnector {
  id: string;
  label: string;
  type: string;
  powerKw: number;
  enabled: boolean;
}

export interface BayAvailability {
  id: string;
  label: string;
  locationId: string;
  locationLabel: string;
  goingelectricId: number | null;
  latitude: number | null;
  longitude: number | null;
  mode: 'demo' | 'ecurious';
  lockId: string | null;
  connectors: BayConnector[];
  availability: 'unreserved' | 'reserved';
  reservedUntil: string | null;
  isMine: boolean;
  myReservationId: string | null;
  myConnectorId: string | null;
}

export interface BookingSnapshot {
  serverNow: string;
  bays: BayAvailability[];
}

export interface BookingReservation {
  id: string;
  bayId: string;
  connectorId: string;
  status: 'held' | 'cancelled' | 'expired';
  createdAt: string;
  expiresAt: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
export const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
const coordinate = (value: unknown, limit: number) => value === null || (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit);

export function isBookingSnapshot(value: unknown): value is BookingSnapshot {
  if (!record(value) || !timestamp(value.serverNow) || !Array.isArray(value.bays) || value.bays.length > 1_000) return false;
  const bayIds = new Set<string>();
  const connectorIds = new Set<string>();
  const locations = new Map<string, string>();
  return value.bays.every(bay => {
    if (!record(bay) || !isUuid(bay.id) || bayIds.has(bay.id) || !isUuid(bay.locationId) || !text(bay.locationLabel)) return false;
    bayIds.add(bay.id);
    if (!text(bay.label) ||
      !(bay.goingelectricId === null || (typeof bay.goingelectricId === 'number' && Number.isSafeInteger(bay.goingelectricId) && bay.goingelectricId > 0)) ||
      !coordinate(bay.latitude, 90) || !coordinate(bay.longitude, 180) || (bay.latitude === null) !== (bay.longitude === null) ||
      !['demo', 'ecurious'].includes(bay.mode as string) || !(bay.lockId === null || text(bay.lockId)) ||
      !['unreserved', 'reserved'].includes(bay.availability as string) ||
      !(bay.reservedUntil === null || timestamp(bay.reservedUntil)) || typeof bay.isMine !== 'boolean' ||
      !(bay.myReservationId === null || isUuid(bay.myReservationId)) || !(bay.myConnectorId === null || isUuid(bay.myConnectorId)) ||
      !Array.isArray(bay.connectors) || bay.connectors.length > 100) return false;
    const location = JSON.stringify([bay.locationLabel, bay.goingelectricId, bay.latitude, bay.longitude]);
    if (locations.has(bay.locationId) && locations.get(bay.locationId) !== location) return false;
    locations.set(bay.locationId, location);
    if (!bay.connectors.every(connector => {
      if (!record(connector) || !isUuid(connector.id) || connectorIds.has(connector.id) || !text(connector.label) || !text(connector.type) ||
        typeof connector.powerKw !== 'number' || !Number.isFinite(connector.powerKw) || connector.powerKw < 0 || connector.powerKw > 2_000 ||
        typeof connector.enabled !== 'boolean' || (connector.enabled && connector.powerKw === 0)) return false;
      connectorIds.add(connector.id);
      return true;
    })) return false;
    if (bay.availability === 'unreserved') return bay.reservedUntil === null && !bay.isMine && bay.myReservationId === null && bay.myConnectorId === null;
    if (bay.reservedUntil === null) return false;
    return bay.isMine
      ? bay.myReservationId !== null && bay.myConnectorId !== null && bay.connectors.some(connector => connector.id === bay.myConnectorId)
      : bay.myReservationId === null && bay.myConnectorId === null;
  });
}

export function isBookingReservation(value: unknown): value is BookingReservation {
  return record(value) && isUuid(value.id) && isUuid(value.bayId) && isUuid(value.connectorId) &&
    ['held', 'cancelled', 'expired'].includes(value.status as string) && timestamp(value.createdAt) && timestamp(value.expiresAt) &&
    Date.parse(value.expiresAt) > Date.parse(value.createdAt);
}
