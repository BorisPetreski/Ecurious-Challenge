/** Backend-only Supabase transport. Public callers retain their own JWT role. */
export class HardwareWorkflowError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = 'HardwareWorkflowError';
    this.code = code;
    this.status = status;
  }
}

const PUBLIC_RPCS = new Set([
  'list_hardware_workflows', 'get_hardware_workflow',
  'request_hardware_reservation', 'request_hardware_entry', 'request_hardware_release',
]);
const WORKER_RPCS = new Set([
  'claim_hardware_operation', 'mark_hardware_dispatch', 'record_hardware_result',
  'list_hardware_operations', 'reconcile_hardware_deadlines',
]);
const ERROR_MESSAGES = {
  AUTH_REQUIRED: 'Sign in to your app booking session before using the designated bay.',
  BAY_NOT_FOUND: 'The designated bay is not registered.',
  BAY_DISABLED: 'The designated bay is disabled.',
  BAY_NOT_BOOKABLE: 'This bay is not enabled for hardware reservations.',
  BAY_RESERVED: 'Another reservation already holds this bay.',
  HARDWARE_BUSY: 'The bay has a pending or unresolved hardware operation. Refresh its status.',
  HARDWARE_DISABLED: 'Hardware control is not activated for this bay.',
  HARDWARE_NOT_READY: 'The bay needs a confirmed hardware observation before this action.',
  RESERVATION_NOT_FOUND: 'This reservation is unavailable or belongs to another session.',
  CONNECTOR_REQUIRED: 'Choose a registered connector.',
  CONNECTOR_NOT_AVAILABLE: 'The selected connector is disabled or belongs to another bay.',
  INVALID_HOLD: 'Choose a hold of 5, 10 or 15 minutes.',
  REQUEST_ID_REQUIRED: 'A reservation request identifier is required.',
  IDEMPOTENCY_CONFLICT: 'This request identifier belongs to a different operation.',
  INVALID_TRANSITION: 'The current hardware workflow does not permit this action.',
  OPERATION_NOT_FOUND: 'This hardware operation is no longer current.',
  CLAIM_LOST: 'Another worker owns this hardware operation.',
};

function jwtRole(key) {
  try {
    const parts = key.split('.');
    return parts.length === 3 ? JSON.parse(Buffer.from(parts[1], 'base64url')).role : null;
  } catch { return null; }
}

export function isHardwareServerKey(key) {
  return typeof key === 'string' && (/^sb_secret_[A-Za-z0-9_-]{10,}$/.test(key) || jwtRole(key) === 'service_role');
}

function publicKey(key) {
  return typeof key === 'string' && (/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(key) || jwtRole(key) === 'anon');
}

export class SupabaseHardwareStore {
  #url;
  #publicKey;
  #serverKey;
  #fetch;
  #timeoutMs;

  constructor({ url = '', publicKey: key = '', serverKey = '', fetchImpl = globalThis.fetch, timeoutMs = 8_000 } = {}) {
    this.#publicKey = typeof key === 'string' ? key.trim() : '';
    this.#serverKey = typeof serverKey === 'string' ? serverKey.trim() : '';
    this.#url = null;
    if (url) {
      let parsed;
      try { parsed = new URL(url); } catch { /* Fixed error below. */ }
      if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
        throw new HardwareWorkflowError('HARDWARE_CONFIGURATION', 'The hardware booking backend requires a Supabase HTTPS project origin.', 503);
      }
      this.#url = parsed.origin;
    }
    if ((this.#publicKey && !publicKey(this.#publicKey)) || (this.#serverKey && !isHardwareServerKey(this.#serverKey)) ||
      !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new HardwareWorkflowError('HARDWARE_CONFIGURATION', 'Check the public and private Supabase key types in the backend configuration.', 503);
    }
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
  }

  get configured() { return !!this.#url && publicKey(this.#publicKey) && isHardwareServerKey(this.#serverKey); }

  async userRpc(name, args, token) {
    if (!PUBLIC_RPCS.has(name)) throw new HardwareWorkflowError('HARDWARE_CONFIGURATION', 'Unsupported hardware booking operation.', 503);
    if (typeof token !== 'string' || token.length > 8_192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
      throw new HardwareWorkflowError('AUTH_REQUIRED', ERROR_MESSAGES.AUTH_REQUIRED, 401);
    }
    // Supabase verifies this JWT. Decoding an unverified user claim here would
    // not establish identity or ownership.
    return this.#rpc(name, args, this.#publicKey, token);
  }

  async workerRpc(name, args = {}) {
    if (!WORKER_RPCS.has(name)) throw new HardwareWorkflowError('HARDWARE_CONFIGURATION', 'Unsupported hardware worker operation.', 503);
    return this.#rpc(name, args, this.#serverKey, this.#serverKey.startsWith('sb_secret_') ? null : this.#serverKey);
  }

  async #rpc(name, args, key, token) {
    if (!this.configured) throw new HardwareWorkflowError('HARDWARE_CONFIGURATION', 'Hardware bookings need the applied workflow migration and backend-only Supabase server key.', 503);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(`${this.#url}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { apikey: key, ...(token ? { Authorization: `Bearer ${token}` } : {}), Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(args), redirect: 'error', cache: 'no-store', signal: controller.signal,
      });
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body ?? []) {
        bytes += chunk.byteLength;
        if (bytes > 1024 * 1024) {
          controller.abort();
          throw new HardwareWorkflowError('HARDWARE_STORE_RESPONSE', 'The hardware booking service returned an oversized response. Refresh before retrying.', 502);
        }
        chunks.push(chunk);
      }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
        throw new HardwareWorkflowError('HARDWARE_STORE_RESPONSE', 'The hardware booking service returned an unreadable result. Refresh before retrying.', 502);
      }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new HardwareWorkflowError('AUTH_REQUIRED', ERROR_MESSAGES.AUTH_REQUIRED, 401);
        if (data?.code === 'PGRST202' || data?.code === '42P01') throw new HardwareWorkflowError('HARDWARE_SCHEMA_MISSING', 'Apply the hardware workflow migration before using designated-bay reservations.', 503);
        const code = Object.hasOwn(ERROR_MESSAGES, data?.message ?? '') ? data.message : null;
        if (code) throw new HardwareWorkflowError(code, ERROR_MESSAGES[code], code === 'AUTH_REQUIRED' ? 401 : 409);
        throw new HardwareWorkflowError('HARDWARE_STORE_FAILED', 'The hardware booking request could not be confirmed. Refresh its state before trying again.', 502);
      }
      return data;
    } catch (error) {
      if (error instanceof HardwareWorkflowError) throw error;
      throw new HardwareWorkflowError(controller.signal.aborted ? 'HARDWARE_STORE_TIMEOUT' : 'HARDWARE_STORE_UNAVAILABLE',
        'The hardware booking result is unknown. Reconcile its state before trying another action.', controller.signal.aborted ? 504 : 502);
    } finally { clearTimeout(timer); }
  }
}
