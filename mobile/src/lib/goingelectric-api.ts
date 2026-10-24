/** GoingElectric directory requests go directly from the phone to the source. */
export interface DirectoryStation {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  address: string;
  connectors: { type: string; power: number; count: number }[];
  maxPower: number | null;
  network: string | null;
  url: string;
  faultReported: boolean;
  verified: boolean;
}

export interface DirectoryRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface DirectoryResult {
  stations: DirectoryStation[];
  fetchedAt: string;
  hasMore: boolean;
}

interface DirectoryRequest {
  apiKey: string;
  region: DirectoryRegion;
  minPower?: number;
  plug?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

const ENDPOINT = 'https://api.goingelectric.de/chargepoints/';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_CHARS = 4 * 1024 * 1024;
const MAX_STATIONS = 500;

export class DirectoryApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DirectoryApiError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength = 200): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return text ? text.slice(0, maxLength) : null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Only canonical directory-entry links can leave the result card. */
export function stationLink(value: unknown, stationId?: number): string | null {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value, 'https://www.goingelectric.de');
    if (
      url.protocol !== 'https:' ||
      !['www.goingelectric.de', 'goingelectric.de'].includes(url.hostname) ||
      url.username || url.password || url.port || url.search
    ) return null;
    const match = /^\/stromtankstellen\/(?:[^/?#]+\/)+(\d+)\/?$/.exec(url.pathname);
    if (!match || (stationId !== undefined && Number(match[1]) !== stationId)) return null;
    url.hostname = 'www.goingelectric.de';
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

export function normalizeStation(value: unknown): DirectoryStation | null {
  if (!isRecord(value) || !isRecord(value.coordinates)) return null;
  const id = value.ge_id;
  const name = cleanText(value.name, 160);
  const latitude = value.coordinates.lat;
  const longitude = value.coordinates.lng;
  if (
    !Number.isSafeInteger(id) || (id as number) < 1 || !name ||
    !finiteNumber(latitude) || Math.abs(latitude) > 90 ||
    !finiteNumber(longitude) || Math.abs(longitude) > 180
  ) return null;
  const url = stationLink(value.url, id as number);
  if (!url) return null;

  const address = isRecord(value.address) ? value.address : {};
  const postcodeCity = [cleanText(address.postcode), cleanText(address.city)].filter(Boolean).join(' ');
  const addressText = [cleanText(address.street), postcodeCity, cleanText(address.country)].filter(Boolean).join(', ');
  const connectors: DirectoryStation['connectors'] = [];
  if (Array.isArray(value.chargepoints)) {
    for (const point of value.chargepoints.slice(0, 100)) {
      if (!isRecord(point)) continue;
      const type = cleanText(point.type, 100);
      if (
        !type || !finiteNumber(point.power) || point.power < 0 || point.power > 2000 ||
        !Number.isSafeInteger(point.count) || (point.count as number) < 1 || (point.count as number) > 1000
      ) continue;
      connectors.push({ type, power: point.power, count: point.count as number });
    }
  }
  const positivePowers = connectors.map(point => point.power).filter(power => power > 0);
  return {
    id: id as number,
    name,
    latitude,
    longitude,
    address: addressText,
    connectors,
    maxPower: positivePowers.length ? Math.max(...positivePowers) : null,
    network: cleanText(value.network),
    url,
    faultReported: value.fault_report === true || isRecord(value.fault_report),
    verified: value.verified === true,
  };
}

function regionBounds(region: DirectoryRegion): { south: number; west: number; north: number; east: number } {
  if (
    !region || ![region.latitude, region.longitude, region.latitudeDelta, region.longitudeDelta].every(finiteNumber) ||
    Math.abs(region.latitude) > 90 || Math.abs(region.longitude) > 180 ||
    region.latitudeDelta <= 0 || region.longitudeDelta <= 0 ||
    region.latitudeDelta > 180 || region.longitudeDelta >= 360
  ) throw new DirectoryApiError('INVALID_REGION', 'Zoom in to a valid map area before searching.');
  const west = region.longitude - region.longitudeDelta / 2;
  const east = region.longitude + region.longitudeDelta / 2;
  if (west < -180 || east > 180) {
    throw new DirectoryApiError('INVALID_REGION', 'Zoom in away from the date line before searching.');
  }
  return {
    south: Math.max(-90, region.latitude - region.latitudeDelta / 2),
    north: Math.min(90, region.latitude + region.latitudeDelta / 2),
    west,
    east,
  };
}

function cancelled(): Error {
  const error = new Error('Directory search cancelled.');
  error.name = 'AbortError';
  return error;
}

/** A single viewport search; results remain in caller memory only. */
export async function fetchDirectory({ apiKey, region, minPower = 0, plug, signal, fetchImpl = fetch }: DirectoryRequest): Promise<DirectoryResult> {
  if (signal?.aborted) throw cancelled();
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key || key.length > 512 || /\s/.test(key)) {
    throw new DirectoryApiError('MISSING_KEY', 'Add a valid GoingElectric API key to enable directory searches.');
  }
  if (!Number.isSafeInteger(minPower) || minPower < 0 || minPower > 2000) {
    throw new DirectoryApiError('INVALID_FILTER', 'Choose a valid minimum charging power.');
  }
  if (plug !== undefined && (typeof plug !== 'string' || plug.length > 100 || /[\u0000-\u001f\u007f]/.test(plug))) {
    throw new DirectoryApiError('INVALID_FILTER', 'Choose a valid connector filter.');
  }
  const bounds = regionBounds(region);
  const url = new URL(ENDPOINT);
  url.searchParams.set('key', key);
  url.searchParams.set('sw_lat', String(bounds.south));
  url.searchParams.set('sw_lng', String(bounds.west));
  url.searchParams.set('ne_lat', String(bounds.north));
  url.searchParams.set('ne_lng', String(bounds.east));
  url.searchParams.set('min_power', String(minPower));
  url.searchParams.set('clustering', 'false');
  if (plug?.trim()) url.searchParams.set('plugs', plug.trim());

  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url.href, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      throw new DirectoryApiError('KEY_REJECTED', 'GoingElectric rejected the API key. Check its approved app access.');
    }
    if (response.status === 429) {
      throw new DirectoryApiError('RATE_LIMITED', 'GoingElectric has limited requests. Wait before searching again.');
    }
    if (!response.ok) {
      throw new DirectoryApiError('HTTP_ERROR', 'GoingElectric could not complete the search. Please try again later.');
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (declaredLength > MAX_RESPONSE_CHARS) {
      throw new DirectoryApiError('RESPONSE_TOO_LARGE', 'This map area has too much data. Zoom in and search again.');
    }
    const text = await response.text();
    if (controller.signal.aborted) throw cancelled();
    if (text.length > MAX_RESPONSE_CHARS) {
      throw new DirectoryApiError('RESPONSE_TOO_LARGE', 'This map area has too much data. Zoom in and search again.');
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new DirectoryApiError('INVALID_RESPONSE', 'GoingElectric returned an unreadable directory response.');
    }
    if (!isRecord(data) || data.status !== 'ok') {
      throw new DirectoryApiError('API_ERROR', 'GoingElectric could not complete the search. Check API access and try again.');
    }
    if (!Array.isArray(data.chargelocations)) {
      throw new DirectoryApiError('INVALID_RESPONSE', 'GoingElectric returned an unsupported directory response.');
    }
    const byId = new Map<number, DirectoryStation>();
    for (const item of data.chargelocations.slice(0, MAX_STATIONS)) {
      const station = normalizeStation(item);
      if (station && !byId.has(station.id)) byId.set(station.id, station);
    }
    return {
      stations: [...byId.values()],
      fetchedAt: new Date().toISOString(),
      hasMore: (finiteNumber(data.startkey) && data.startkey > 0) || data.chargelocations.length >= MAX_STATIONS,
    };
  } catch (error) {
    if (signal?.aborted) throw cancelled();
    if (timedOut) throw new DirectoryApiError('REQUEST_TIMEOUT', 'GoingElectric did not respond within 10 seconds. Please try again.');
    if (error instanceof DirectoryApiError) throw error;
    // Native network errors can include the complete URL, including its key.
    throw new DirectoryApiError('NETWORK_ERROR', 'Could not reach GoingElectric. Check your connection and try again.');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
