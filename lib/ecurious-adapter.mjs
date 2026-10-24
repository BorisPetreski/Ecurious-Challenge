/** Backend-only, read-only client for the on-site parking-lock service.
 * Booking and charging remain simulated. Hardware writes deliberately refuse.
 */
export const ECURIOUS_BASE_URL = 'https://parking-lock-service-production.up.railway.app';
export const TELEMETRY_FRESHNESS_MS = 60_000; // Local display policy, not a hardware guarantee.
const MAX_RESPONSE_BYTES = 1024 * 1024;
const LOCK_ID = /^[a-zA-Z0-9_-]{1,100}$/;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const numberOrNull = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString() : null;

export class EcuriousApiError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'EcuriousApiError';
    this.code = code;
    this.status = status;
  }
}

export class EcuriousAdapter {
  #apiKey;
  #baseUrl;
  #fetch;
  #clock;
  #timeoutMs;

  constructor({ apiKey = '', baseUrl = ECURIOUS_BASE_URL, fetchImpl = globalThis.fetch,
    clock = Date.now, timeoutMs = 6_000 } = {}) {
    let url;
    try { url = new URL(baseUrl); } catch { /* Report only a fixed, secret-free message below. */ }
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new EcuriousApiError('ECURIOUS_CONFIGURATION', 'ECURIOUS_BASE_URL must be an HTTPS origin without credentials, paths or query parameters.', 503);
    }
    if (typeof apiKey !== 'string' || /[\r\n]/.test(apiKey) || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new EcuriousApiError('ECURIOUS_CONFIGURATION', 'Check the backend Ecurious credential and timeout configuration.', 503);
    }
    this.#apiKey = apiKey.trim();
    this.#baseUrl = url.origin;
    this.#fetch = fetchImpl;
    this.#clock = clock;
    this.#timeoutMs = timeoutMs;
  }

  get configured() { return this.#apiKey.length > 0; }

  #text(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const redacted = this.#apiKey ? value.replaceAll(this.#apiKey, '[REDACTED]') : value;
    return redacted.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 100) || fallback;
  }

  async #get(path) {
    if (!this.configured) {
      throw new EcuriousApiError('ECURIOUS_NOT_CONFIGURED', 'Add ECURIOUS_API_KEY to the backend .env and restart the server.', 503);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method: 'GET',
        headers: { 'X-API-Key': this.#apiKey, Accept: 'application/json' },
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        // Provider bodies may contain credentials, raw plates or camera metadata.
        await response.body?.cancel();
        if (response.status === 401 || response.status === 403) {
          throw new EcuriousApiError('ECURIOUS_AUTH', 'The Ecurious service rejected the backend credential. Check the key and team assignment.');
        }
        if (response.status === 404) {
          throw new EcuriousApiError('ECURIOUS_NOT_FOUND', 'The requested lock or API route was not found.');
        }
        throw new EcuriousApiError('ECURIOUS_HTTP', `The Ecurious service returned HTTP ${response.status}. Try refreshing later.`);
      }
      if (!response.headers.get('content-type')?.includes('application/json')) {
        await response.body?.cancel();
        throw new EcuriousApiError('ECURIOUS_RESPONSE', 'The Ecurious service returned an unsupported response.');
      }
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body ?? []) {
        bytes += chunk.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          controller.abort();
          throw new EcuriousApiError('ECURIOUS_RESPONSE', 'The Ecurious response exceeded the diagnostic size limit.');
        }
        chunks.push(chunk);
      }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
        throw new EcuriousApiError('ECURIOUS_RESPONSE', 'The Ecurious service returned unreadable JSON.');
      }
      if (!record(data)) throw new EcuriousApiError('ECURIOUS_RESPONSE', 'The Ecurious service returned an unsupported response.');
      return data;
    } catch (error) {
      if (error instanceof EcuriousApiError) throw error;
      if (controller.signal.aborted) {
        throw new EcuriousApiError('ECURIOUS_TIMEOUT', 'The Ecurious service did not respond in time. No hardware command was sent.', 504);
      }
      throw new EcuriousApiError('ECURIOUS_CONNECTION', 'Could not read the Ecurious service. Check the laptop internet connection.');
    } finally {
      clearTimeout(timeout);
    }
  }

  #lock(value, now) {
    if (!record(value) || typeof value.id !== 'string' || !LOCK_ID.test(value.id)) {
      throw new EcuriousApiError('ECURIOUS_RESPONSE', 'The Ecurious service returned an unsupported lock record.');
    }
    const status = ['raised', 'lowered', 'raising', 'lowering', 'offline'].includes(value.status) ? value.status : 'unknown';
    const lastSeenAt = timestamp(value.lastSeenAt);
    const age = lastSeenAt === null ? Infinity : now - Date.parse(lastSeenAt);
    const telemetryFresh = status !== 'offline' && status !== 'unknown' && age >= 0 && age <= TELEMETRY_FRESHNESS_MS;
    const lastReportedPresence = ['vacant', 'occupied'].includes(value.carPresence) ? value.carPresence : 'unknown';
    const whitelist = Array.isArray(value.whitelist) && value.whitelist.every(plate => typeof plate === 'string') ? value.whitelist : null;
    const photo = record(value.latestPhoto) ? value.latestPhoto : null;
    return {
      id: this.#text(value.id, 'unknown'),
      name: this.#text(value.name, 'Parking lock'),
      hasCamera: value.hasCamera === true,
      status,
      lastSeenAt,
      telemetryFresh,
      barrier: telemetryFresh && ['raised', 'lowered'].includes(status) ? status : 'unknown',
      occupancy: telemetryFresh ? lastReportedPresence : 'unknown',
      lastReportedPresence,
      activeErrors: Array.isArray(value.activeErrors) ? value.activeErrors.slice(0, 20).map(error =>
        typeof error === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(error) ? this.#text(error, 'UNKNOWN_ERROR') : 'UNKNOWN_ERROR') : [],
      waterIngress: typeof value.waterIngress === 'boolean' ? value.waterIngress : null,
      battery12V: numberOrNull(value.battery12V),
      battery3_7V: numberOrNull(value.battery3_7V),
      signalStrength4G: numberOrNull(value.signalStrength4G),
      whitelist: {
        mode: !whitelist ? 'unknown' : whitelist.includes('*') ? 'any-plate' : whitelist.length ? 'specific-plates' : 'disabled',
        count: whitelist ? whitelist.length : null,
      },
      plateObservation: photo ? {
        detected: typeof photo.licensePlate === 'string' && photo.licensePlate.length > 0,
        timestamp: timestamp(photo.timestamp),
      } : null,
    };
  }

  async listLocks() {
    const data = this.configured ? await this.#get('/api/v1/locks') : null;
    const now = this.#clock();
    const locks = data && (data.locks ?? data.assignedLocks);
    if (data && (!Array.isArray(locks) || locks.length > 100)) {
      throw new EcuriousApiError('ECURIOUS_RESPONSE', 'The Ecurious service returned an unsupported lock list.');
    }
    return {
      source: 'ecurious', access: 'read-only', configured: this.configured,
      fetchedAt: new Date(now).toISOString(),
      team: data ? this.#text(data.team, 'Assigned team') : null,
      locks: locks ? locks.map(lock => this.#lock(lock, now)) : [],
      freshnessLimitMs: TELEMETRY_FRESHNESS_MS,
    };
  }

  async getStatus(id) {
    if (typeof id !== 'string' || !LOCK_ID.test(id)) {
      throw new EcuriousApiError('ECURIOUS_LOCK_ID', 'A valid assigned lock ID is required.', 400);
    }
    const data = await this.#get(`/api/v1/locks/${encodeURIComponent(id)}`);
    if (data.lock?.id !== id) {
      throw new EcuriousApiError('ECURIOUS_RESPONSE', 'The Ecurious service returned a different or missing lock record.');
    }
    return this.#lock(data.lock, this.#clock());
  }

  async getLatestPlate(id) {
    if (typeof id !== 'string' || !LOCK_ID.test(id)) {
      throw new EcuriousApiError('ECURIOUS_LOCK_ID', 'A valid assigned lock ID is required.', 400);
    }
    const data = await this.#get(`/api/v1/locks/${encodeURIComponent(id)}/plate/latest`);
    if (data.lockId !== id || !timestamp(data.timestamp) || typeof data.licensePlate !== 'string') {
      throw new EcuriousApiError('ECURIOUS_RESPONSE', 'The Ecurious service returned an unsupported plate observation.');
    }
    return {
      lockId: id,
      timestamp: timestamp(data.timestamp),
      detected: typeof data.licensePlate === 'string' && data.licensePlate.length > 0,
    };
  }

  async reserve() {
    throw new Error('EcuriousAdapter.reserve is not implemented: booking ownership, occupancy interlocks and confirmed hardware movement are required.');
  }

  async release() {
    throw new Error('EcuriousAdapter.release is not implemented: occupancy interlocks and acknowledgement reconciliation are required.');
  }
}
