# API contracts

This reference describes the checked-in implementation. There are three separate application data paths:

| Path | Authority and current status |
| --- | --- |
| Phone → local Node `/api/*` | One in-memory simulator, plus a separate real read-only Ecurious diagnostic view. Reservation and charging writes are simulated. |
| Phone → Supabase Auth and RPCs | Prepared shared software holds for registered demo bays and separate directory-derived virtual app slots. Hosted migrations and anonymous-auth activation remain pending; no fallback booking is fabricated. |
| Phone → GoingElectric | Direct directory lookup and on-device derivation of virtual app choices. A directory result does not establish a physical bay/plug identity, occupancy, or charging-session state. |

These paths do not share reservation IDs or perform an atomic transaction across services. A Supabase hold does not reserve the simulator bay or move an Ecurious barrier. See [database contracts](DATABASE.md), [Supabase deployment/setup](SUPABASE.md), and the [Ecurious provider contract](ECURIOUS-API.md).

## Local Node HTTP API

Source: [`server.mjs`](../server.mjs), [`lib/simulator.mjs`](../lib/simulator.mjs), and [`lib/ecurious-adapter.mjs`](../lib/ecurious-adapter.mjs).

The default origin is `http://127.0.0.1:3000`. `npm start` and `npm run server:lan` intentionally bind the development server to `0.0.0.0` for phone access; the phone uses the laptop's LAN address. `PORT` changes the port. The mobile client accepts an origin-only `EXPO_PUBLIC_API_URL`; otherwise it derives a development host from Expo and uses `EXPO_PUBLIC_API_PORT` or `3000`. Android emulator fallback is `10.0.2.2`.

The local API has **no client authentication or user isolation**. Clients reaching this process share one simulator and can read its hardware diagnostics. It is a laptop development service, not a deployed multi-user booking backend. There is no browser CORS configuration; native phone requests do not require it. `ECURIOUS_MODE` values other than `mock` refuse startup.

| Method and exact path | Body | Successful status and response |
| --- | --- | --- |
| `GET /api/health` | None | `200`, `{ "healthy": true, "mode": "mock" }`. Does not check providers, database, or hardware. |
| `GET /api/state` | None | `200`, `ReservationState` below. Also reconciles simulated arrival expiry. |
| `GET /api/hardware` | None | `200`, redacted `HardwareSnapshot` below. No hardware write. |
| `POST /api/reservations` | `{ "plate": "M-DEMO-42", "holdMinutes": 10 }` | `201`, updated `ReservationState`. Creates a simulator hold only. |
| `POST /api/actions` | `{ "action": "..." }`, with arrival fields when needed | `200`, updated `ReservationState`. Simulator actions only. |

There are no local individual-booking, individual-hardware, plate-recognition, directory-proxy, or Supabase-proxy routes. `EcuriousAdapter.getStatus()` and `getLatestPlate()` are backend methods; they are not exposed as extra HTTP endpoints.

POST requests require `Content-Type: application/json` (a charset parameter is accepted), a JSON object, and at most **8 KiB** of body bytes. Known routes called with another method return `405` and an `Allow` header. This includes `HEAD` and `OPTIONS` on API routes. Unknown `/api/*` paths return `404`. No query parameters are consumed. Successful and error JSON responses use `Content-Type: application/json; charset=utf-8` and `Cache-Control: no-store`.

### Simulator reservation and state

`plate` is required. It accepts ASCII letters/numbers, spaces and hyphens, at most 20 input characters and 2–12 characters after removing spaces/hyphens. Matching ignores case and those separators. `holdMinutes` defaults to `10`; supplied values must be integers from `1` to `30`. Only one hold may exist, and the virtual bay must be empty.

The plate is received in request memory. The simulator retains a per-process keyed fingerprint and returns a masked display, not the raw plate. All examples and tests use fictional plates. This is not a country-aware recognition or compliance implementation.

```ts
type ReservationState = {
  mode: 'mock';
  now: string; // ISO timestamp from the simulator clock
  bay: {
    id: 'demo-bay-1';
    label: string;
    status: 'free' | 'reserved' | 'blocked' | 'charging' | 'occupied' | 'awaiting-release';
    occupied: boolean;
    barrier: 'raised' | 'lowered';
  };
  reservation: null | {
    id: string;
    status: 'awaiting-arrival' | 'manual-review' | 'authorized' | 'charging' | 'completed' | 'expired-occupied';
    maskedPlate: string;
    createdAt: string;
    expiresAt: string;
    arrivedAt?: string;
    startedAt?: string;
    completedAt?: string;
    reviewReason?: 'low-confidence' | 'plate-mismatch';
  };
  events: { id: string; at: string; type: string; message: string }[];
  capabilities: {
    canReserve: boolean; canArrive: boolean; canStartCharge: boolean;
    canDepart: boolean; canRelease: boolean; canBlock: boolean;
    canClear: boolean; canExpire: boolean; canReset: boolean;
  };
};
```

Events are newest first, capped at 40, and redacted. Capabilities help the UI enable actions; the server independently enforces transitions. State, event history, and fingerprints disappear on server restart. `reset` also clears the simulated environment. There is no database or idempotency key for these local writes.

| `action` | Additional fields | Preconditions and effect |
| --- | --- | --- |
| `arrive` | Required `plate`; optional numeric `confidence` from `0` to `1`, default `0.99` | Requires a waiting hold and empty bay. A matching plate at confidence ≥ `0.9` lowers the virtual barrier and marks the vehicle authorised/occupied. Otherwise sets `manual-review`; corrected observations may be submitted. This is a UI-supplied simulation, not a trusted camera event. |
| `start-charge` | None | Requires the authorised reserved vehicle. Sets `charging`; no EVSE control or power delivery. |
| `depart` | None | Requires a reserved vehicle in the bay, including before charging. Marks it empty and the hold completed. |
| `release` | None | Requires an existing hold and an empty bay. Removes the hold and raises the virtual barrier. It can also cancel an unused hold. |
| `block` | None | Requires an empty bay. Simulates an unrelated vehicle, occupied bay, and lowered barrier. |
| `clear` | None | Requires an unrelated blocking vehicle. Makes the bay empty, restores protection when applicable, and reconciles expiry. |
| `expire` | None | Requires a waiting hold. Advances the simulator clock past its deadline. It does not advance any provider/database clock. |
| `reset` | None | Replaces the entire simulated environment with an empty protected bay, clears holds/events, and restores clock offset. |

Expiry is reconciled when simulator state is read or changed, not by an independent background worker. An overdue waiting hold is removed if empty; an occupied bay produces `expired-occupied` until cleared. An authorised/charging session is not expired by its arrival deadline. Absence of a real plate event is never interpreted by this simulator as proof of physical vacancy.

### Read-only hardware snapshot

`GET /api/hardware` makes a server-side `GET /api/v1/locks` using the backend `ECURIOUS_API_KEY` as `X-API-Key`. The phone receives selected telemetry only. The Ecurious origin defaults to the supplied challenge service; `ECURIOUS_BASE_URL` must be an HTTPS origin without path, user info, query or fragment. Redirects are rejected.

```ts
type HardwareSnapshot = {
  source: 'ecurious'; access: 'read-only'; configured: boolean;
  fetchedAt: string; team: string | null; freshnessLimitMs: 60000;
  locks: {
    id: string; name: string; hasCamera: boolean;
    status: 'raised' | 'lowered' | 'raising' | 'lowering' | 'offline' | 'unknown';
    lastSeenAt: string | null; telemetryFresh: boolean;
    barrier: 'raised' | 'lowered' | 'unknown';
    occupancy: 'vacant' | 'occupied' | 'unknown';
    lastReportedPresence: 'vacant' | 'occupied' | 'unknown';
    activeErrors: string[]; waterIngress: boolean | null;
    battery12V: number | null; battery3_7V: number | null; signalStrength4G: number | null;
    whitelist: { mode: 'any-plate' | 'specific-plates' | 'disabled' | 'unknown'; count: number | null };
    plateObservation: { detected: boolean; timestamp: string | null } | null;
  }[];
};
```

With no configured key, this route returns `200` with `configured: false`, `team: null`, and `locks: []`, without a network request. Configured failures return errors rather than a fabricated empty assignment. At most 100 lock records are accepted. Raw plates, whitelist entries, camera captures, serials, and arbitrary upstream fields are omitted.

`status` and `lastReportedPresence` retain the report; derived current state becomes unknown for offline/unknown status or missing, future, or older-than-60-second telemetry. A moving barrier is never rendered as a confirmed raised/lowered position. The **60-second window is a local display policy**, not a verified hardware guarantee. The mobile panel further ages retained snapshots and marks them unknown after refresh failure. It fetches on mount and manual refresh; its five-second timer updates display age only, without hardware polling. No SSE consumer or movement/whitelist write is connected to the app.

### Local errors

All handled local failures use this shape, with the HTTP status on the response:

```json
{
  "error": {
    "code": "BAY_OCCUPIED",
    "message": "A reservation requires an empty bay."
  }
}
```

| HTTP status | Codes and conditions |
| --- | --- |
| `400` | `INVALID_INPUT`: malformed object, action, plate, hold or confidence. `INVALID_JSON`: unreadable JSON. `INVALID_PATH`: invalid static-file path. |
| `404` | `NOT_FOUND`: unknown API route or absent/out-of-scope static file. |
| `405` | `METHOD_NOT_ALLOWED`, with route-specific `Allow`. |
| `409` | Simulator transition conflicts: `BAY_OCCUPIED`, `RESERVATION_EXISTS`, `NOT_AWAITING_ARRIVAL`, `NOT_AUTHORIZED`, `NO_RESERVED_VEHICLE`, `NO_RESERVATION`, `NO_BLOCKING_VEHICLE`. |
| `413` / `415` | `BODY_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE`. |
| `502` | Ecurious `ECURIOUS_AUTH`, `ECURIOUS_NOT_FOUND`, `ECURIOUS_HTTP`, `ECURIOUS_RESPONSE`, or `ECURIOUS_CONNECTION`. An upstream `401`/`403` becomes local `502 ECURIOUS_AUTH`; provider bodies are not returned. |
| `504` | `ECURIOUS_TIMEOUT` after the backend read deadline. No hardware command was sent. |
| `500` | `INTERNAL_ERROR`: fixed message for unexpected failures, without request/provider bodies. |

Adapter configuration errors use `ECURIOUS_CONFIGURATION`/`503` and normally prevent server startup. Adapter direct methods can also produce `ECURIOUS_LOCK_ID`/`400` or `ECURIOUS_NOT_CONFIGURED`/`503`; there is no HTTP route for those methods, and the unconfigured list route instead returns the configuration state above.

The phone's simulator client validates the complete response, exposes `ReservationApiError` with `code`, `message` and optional `status`, and adds client-only `INVALID_CONFIGURATION`, `INVALID_RESPONSE`, `HTTP_ERROR`, `REQUEST_TIMEOUT`, or `NETWORK_ERROR`. Caller cancellation produces `AbortError`. Hardware-client failures are displayed as fixed messages and do not use the simulator state's schema. Failed writes are not automatically retried: a timeout can occur after a simulator mutation completed.

## Supabase booking RPC client

Source: [`bookings-api.ts`](../mobile/src/lib/bookings-api.ts), [`booking-contract.ts`](../mobile/src/lib/booking-contract.ts), [`directory-booking-contract.ts`](../mobile/src/lib/directory-booking-contract.ts), and the booking hooks. See [DATABASE.md](DATABASE.md) for SQL, locking, permissions, expiry and constraints, and [SUPABASE.md](SUPABASE.md) for pending hosted activation. The third migration adds directory-slot holds; it does not replace registered-bay holds.

These calls go directly from the phone through the Supabase SDK. They do not use local `/api/*`. Configuration requires a project origin and public publishable/legacy anon key; privileged server keys are rejected. The client restores a persisted native SecureStore session or calls `auth.signInAnonymously()`, obtaining an authenticated guest identity. A public anon key alone is not a signed-in guest. Web preview session storage is memory only. The first-launch driver profile is a separate local object and is not an authentication identity.

| RPC | Supplied arguments | Returned JSON |
| --- | --- | --- |
| `list_bay_availability` | None | `{ serverNow, bays: [...] }`, with registered location/bay/connector metadata and projected booking state. |
| `reserve_bay` | `p_bay_id`, `p_hold_minutes`, `p_request_id`, `p_connector_id` | `{ id, bayId, connectorId, status, startsAt, createdAt, expiresAt }`. |
| `cancel_reservation` | `p_reservation_id` | Same reservation shape; only the caller's hold, including its existing cancelled/expired result. |

For these registered-bay RPCs, IDs are UUIDs. The client sends a fresh request UUID for each deliberate reservation call. The UI accepts holds of `5`, `10`, or `15` minutes; SQL accepts `1–30`. Reservation status is `held`, `cancelled`, or `expired`. SQL returns `startsAt`; the current mobile `BookingReservation` validator/type uses `createdAt` and `expiresAt` and does not require `startsAt`.

Each returned bay includes `id`, `label`, `locationId`, `locationLabel`, optional confirmed `goingelectricId`, paired nullable coordinates, `mode: 'demo' | 'ecurious'`, nullable `lockId`, and `connectors: [{id,label,type,powerKw,enabled}]`. Its booking projection is `availability: 'unreserved' | 'reserved'`, `reservedUntil`, `isMine`, `myReservationId`, and `myConnectorId`. Another user's reservation/connector IDs and identity are not returned. The client rejects inconsistent ownership/availability, duplicate identities, invalid timestamps/coordinates, over 1,000 bays, or over 100 connectors per bay.

Choosing a registered connector holds its entire physical bay. This registered-inventory RPC accepts only demo-mode inventory; Ecurious-mode reservations are rejected. Separately, the directory-slot RPCs below allocate virtual app choices without creating physical inventory. Directory aggregate counts never create physical connector/bay IDs. “Unreserved” means no current BayReady software hold, not a physically empty or operational charger.

Reserve/cancel SDK retries are explicitly disabled. Database request identity protects the same owner/request UUID with matching bay, connector and duration, but the current UI creates a new UUID for a new tap: refresh/reconcile after uncertainty before attempting another reservation. The provider serializes mutations, reads after successful, rejected or uncertain writes, polls every ten foreground seconds, and pauses actions when its last successful read is older than 25 seconds or the app is inactive. Device countdown expiry alone never declares a bay unreserved.

RPC failures are mapped to `BookingApiError { message, code }`, not the Node error envelope. Recognised SQL message codes are `AUTH_REQUIRED`, `BAY_NOT_FOUND`, `BAY_DISABLED`, `BAY_NOT_BOOKABLE`, `BAY_RESERVED`, `INVALID_HOLD`, `CONNECTOR_REQUIRED`, `CONNECTOR_NOT_AVAILABLE`, `REQUEST_ID_REQUIRED`, `IDEMPOTENCY_CONFLICT`, `RESERVATION_NOT_FOUND`, `INVALID_STATION`, `INVALID_STATIONS`, `INVALID_SLOT`, and `PLUG_RESERVED`. Missing schema (`PGRST202`/`42P01`) maps to `SCHEMA_MISSING`; local configuration/session/validation can produce `NOT_CONFIGURED`, `ANONYMOUS_AUTH_DISABLED`, `SESSION_STORAGE`, `INVALID_RESPONSE`, or the relevant input/auth code. Unrecognised failures get fixed read/uncertain-write messages under `BOOKING_UNAVAILABLE`; raw database messages are not displayed.

Only bay ID, connector ID, duration and request UUID are sent for a new hold. No profile contact information, plate, camera capture, or payment data is sent. There is no implemented charging, payment processor, notification, or physical-access RPC.

### Directory-derived virtual app holds

[`directory-slots.ts`](../mobile/src/lib/directory-slots.ts) derives virtual allocation keys on the device from a fresh GoingElectric result. [`use-directory-bookings.ts`](../mobile/src/hooks/use-directory-bookings.ts) owns their scoped observation, polling and mutations. These holds share Supabase guest authentication and bounded requests with registered inventory, but use `directory_plug_reservations` and separate RPCs:

| SDK wrapper / RPC | Supplied arguments | Returned JSON |
| --- | --- | --- |
| `fetchDirectoryHolds` / `list_directory_holds` | `p_station_ids`: canonical sorted/deduplicated array, maximum 500 positive safe-integer station references | `{ serverNow, holds: [{stationId, slotKey, reservedUntil, isMine, myReservationId}] }`. |
| `reserveDirectoryPlug` / `reserve_directory_plug` | `p_station_id`, `p_slot_key`, `p_hold_minutes`, fresh UUID `p_request_id` | `{ id, stationId, slotKey, status, createdAt, expiresAt }`. |
| `cancelDirectoryHold` / `cancel_directory_hold` | UUID `p_reservation_id` | Same directory-reservation shape, for the caller's own hold. |

The list returns active holds for requested stations **plus all the caller's own active holds**, including outside the viewport or changed catalog. An empty station array still restores owned holds for cancellation. Other owners' reservation IDs and identities are omitted. The response contains no rows for unheld choices: only after a complete successful read covering a station may absence of a matching slot mean **unreserved in BayReady**. No prefilled directory catalog or unreserved rows are inserted.

The validator requires an ISO-parsable `serverNow`, at most 10,000 holds, positive safe-integer station IDs, 64-character lowercase hexadecimal slot keys, future `reservedUntil` relative to `serverNow`, unique station/key pairs, unique owned reservation IDs, and consistent ownership. Out-of-query holds are accepted only when owned by the caller. Reservation results require a UUID, valid interval/status, and identifiers matching the requested station/key or cancellation ID. Malformed or excessive responses fail as unknown status; they are not treated as an empty booking list.

The hook tracks the exact successfully queried station set and observation time. A scope change invalidates displayed freshness during the render; obsolete responses cannot establish freshness for a replacement scope. It reads on scope changes and every ten foreground seconds, ages out after 25 seconds, pauses actions in the background or after failed reads, and serializes its own reads/writes. Reserve requires the station in the current scope and a valid slot key; cancel requires an owned reservation from the snapshot. Every mutation disables automatic retries and reconciles success, conflict or uncertainty with another read using the latest scope. Retained snapshots remain visibly historical; local countdowns never free a slot.

For these RPCs, only station reference, opaque slot key, duration and request UUID are sent. Supabase stores app references and hold history; names, coordinates, addresses, connector metadata, directory credentials and profile data are not uploaded. The SQL validates reference bounds and concurrency, **not** station existence, connector counts, catalog authenticity or physical availability. Exclusivity applies to the exact app `(stationId, slotKey)` pair and does not link multiple virtual choices to a physical bay. Refer to [DATABASE.md](DATABASE.md) for owner/slot advisory locks, the unique held-slot index, expiry reconciliation and idempotency.

### Stable virtual-slot key protocol

All clients must preserve this protocol to share the same allocation space:

1. Merge groups with exactly equal connector `type` and numeric `power`, summing their counts; normalise numeric negative zero to zero. Each merged count must be a positive safe integer no greater than `0xffffffff`. Group ordering is type then power; input order does not affect keys.
2. Compute SHA-256 of `JSON.stringify(['bayready-directory-v1', stationId, type, power])`. The map uses Expo Crypto. Type text remains case-sensitive. Count is deliberately absent, so increasing/decreasing count preserves existing lower-numbered slot keys.
3. Take the first 56 lowercase hex characters of that digest, then append the one-based virtual ordinal as eight zero-padded lowercase hex digits. The result is a 64-character `slotKey`.

These are **BayReady virtual ordinals**, not provider-issued physical connector numbers. Type/power changes yield a different namespace; reduced counts can leave historical holds outside current inventory. Owned holds still return in list responses so they remain cancellable. Hashing produces stable references, not an assertion of directory licensing permission or physical identity.

`directoryGroupStatus()` counts unique matching holds only against a fresh scoped read; otherwise reserved/unreserved counts are null. `directorySlotPage()` displays 12 choices per page by default, can hide reserved choices only with fresh status, and never expires a hold by comparing its deadline locally. The map disables new holds for reported-fault locations and requires its local profile before confirmation; directory browsing remains accessible without that profile.

## GoingElectric directory boundary

Source: [`goingelectric-api.ts`](../mobile/src/lib/goingelectric-api.ts). The phone calls `GET https://api.goingelectric.de/chargepoints/` with `key`, viewport bounds `sw_lat`, `sw_lng`, `ne_lat`, `ne_lng`, `min_power`, `clustering=false`, and optional `plugs`. It omits cookies, rejects redirects and requests no cache. The registered directory key is available on the device; it is distinct from the backend-only Ecurious key. Never log complete directory request URLs.

The client returns `{ stations, fetchedAt, hasMore }`. A normalised station contains its directory ID/name, coordinates/address, listed connector type/power/count groups, maximum listed power, network, canonical source URL, reported-fault flag, and source verification flag. Invalid entries are omitted, duplicates are removed, and at most the first 500 entries are considered. `hasMore` is a truncation/pagination hint; this client does not fetch subsequent pages. Keep visible source attribution, retrieval time, and each station's directory link; the map retains directory results in memory for at most one hour.

`DirectoryApiError` has `code` and a fixed message: input/configuration codes, `KEY_REJECTED` for `401`/`403`, `RATE_LIMITED` for `429`, `HTTP_ERROR`, `API_ERROR`, `INVALID_RESPONSE`, `RESPONSE_TOO_LARGE`, `REQUEST_TIMEOUT`, or `NETWORK_ERROR`. Caller cancellation is `AbortError`. External errors are not replayed to the UI, since native errors may contain the credential-bearing URL. The directory catalog stays on the device and is not proxied through Node or copied to Supabase. Directory-derived station references and opaque virtual-slot keys are separately persisted with app hold state as described above; they do not establish operator reservations or physical inventory.

## Request and freshness limits

| Layer | Implemented limit | Meaning |
| --- | --- | --- |
| Local POST body | 8 KiB, counted while reading | Reject oversized simulator input. |
| Phone → simulator | 7 seconds per request | Local client abort; no automatic mutation retry. Foreground state poll: 2 seconds, serialized with writes. |
| Phone → hardware view | 12 seconds | Allows the backend's bounded provider read; manual refresh, not sensor polling. |
| Backend → Ecurious | 6 seconds; streaming 1 MiB response cap | GET only; redirects rejected; sanitized output. |
| Hardware display | 60 seconds | Local policy applied to provider observation and retained snapshot age; not a physical safety guarantee. |
| Supabase SDK fetch | 8 seconds per underlying fetch; 1,000,000-character response check | Body is read before its size check. Session restoration/sign-in and RPC can involve multiple requests; eight seconds is not an overall operation deadline. |
| Booking UI read age | 25 seconds, foreground poll every 10 seconds | Pauses software-booking actions on stale/failed reads; unrelated to physical occupancy. |
| GoingElectric | 10 seconds; 4 Mi-character body check and Content-Length guard; 500 entries considered | Body is read before the text-size check; this is not a streaming memory cap. Directory retention is one hour in the app. |

None of these timeout or freshness policies proves physical state. A future live cycle requires a verified booking-to-bay mapping, trusted plate events, occupancy interlocks, confirmed hardware movement, and agreed charging evidence before software holds can be presented as protected charging reservations.
