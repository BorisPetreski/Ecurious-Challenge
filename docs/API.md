# API contracts

Interactive schemas, examples and executable requests are available at **`/docs`** on the Node server. See [the Swagger/OpenAPI guide](OPENAPI.md), [backend OpenAPI JSON](openapi.json), and [separate observed Ecurious OpenAPI JSON](openapi-ecurious.json). Direct Ecurious operations use the upstream server, not the Node `/api/*` namespace.

This reference describes the checked-in implementation. The primary presentation flow is the direct **Map → Audimax** integration added in `05b7986`; its request and local-state contract is below. The longer-lived Node/Supabase reservation contracts remain separate.

## Current Audimax map demo

Source: [phone API client](../mobile/src/lib/audimax-lock-api.ts), [Map orchestration](../mobile/src/app/map.tsx) and [booking modal](../mobile/src/components/audimax-booking-modal.tsx).

The phone calls the configured Ecurious HTTPS origin directly, using its assigned Audimax credential as the `apiKey` query parameter. The launcher maps `AUDIMAX_API_KEY` or `ECURIOUS_API_KEY` to `EXPO_PUBLIC_AUDIMAX_API_KEY`; this test credential is available on the device. No actual key belongs in this document or a recorded URL.

| Method / provider path | Input | Current behavior |
| --- | --- | --- |
| `GET /api/v1/locks` | Assigned API key | Accepts `locks` or `assignedLocks`; supplies status, occupancy, camera, battery, signal and error cards |
| `POST /api/v1/locks/:id/lock` | No JSON body | First step of Now activation; requests raising |
| `POST /api/v1/locks/:id/whitelist` | `{ "plates": ["M-DEMO-42"] }` | Second activation step; registers the chosen plate for native camera access |
| `POST /api/v1/locks/:id/whitelist` | `{ "plates": [] }` | First release step; attempts to clear automatic plate access |
| `POST /api/v1/locks/:id/unlock` | No JSON body | Release lowering; also invoked by the foreground no-show timer |

`reserveAudimaxLock` returns success after both HTTP responses succeed; it does not separately verify arm position. If whitelist registration fails after raising, no local hold is committed and no automatic rollback is issued. Release continues after a non-success whitelist-clear HTTP response, so an unlock response alone does not prove whitelist revocation. The direct client has no durable idempotency or cross-device allocation transaction. These are current contracts, not the stricter semantics of the older backend adapter.

`AudimaxActiveHold` is stored locally with lock ID/name, raw selected test plate, reservation/arrival/raise/expiry times, mode and `scheduled | active | occupied` status. Now is thirty seconds; Scheduled raises at T−30 seconds and expires at T+30; extensions add thirty seconds for €1 mock. Reported occupied state stops unused-hold expiry; departure is explicit Leave Bay. Timers require the running Map screen. The hardware whitelist performs native optical matching; this path does not call `/plate/latest` or create a Supabase hardware slot.

## Eventbrite event feed

Source: [backend integration](../lib/eventbrite-events.mjs), [mobile client](../mobile/src/lib/events-api.ts), [feed hook](../mobile/src/hooks/use-events.ts).

`GET /api/events` on the local Node origin returns:

```ts
type EventFeed = {
  configured: boolean;
  source: 'eventbrite';
  scope: 'organization' | 'curated' | 'not_configured';
  fetchedAt: string;
  reason: string | null;
  events: Array<{
    id: string; title: string; subtitle: string;
    category: 'tech' | 'sports' | 'culture' | 'concert'; emoji: string;
    venue: string; address: string; latitude: number; longitude: number;
    date: string; expectedAttendance: 'Not provided';
    url: string; startsAt: string; source: 'eventbrite';
  }>;
};
```

The backend uses `EVENTBRITE_PRIVATE_TOKEN` (alias `EVENTBRITE_TOKEN`) as a Bearer header. Configure `EVENTBRITE_ORGANIZATION_ID`, provide up to ten comma-separated `EVENTBRITE_EVENT_IDS`, or let the integration discover a single accessible organization. It reads organization events with venue expansion or the configured individual events. Only public live/started, not-ended, in-person events with valid venue coordinates within 50 km of Munich reach the client. Dates display in Europe/Berlin; attendance is not invented.

Provider reads have six-second per-request timeouts, response bounds, sanitized errors and a shared sixty-second cache. Expected configuration/provider failures return an empty feed with a reason, without forwarding credentials or provider bodies. There are no Eventbrite writes, ticket purchases or checkout operations. The launcher removes all `EVENTBRITE_*` variables from Expo's environment. The mobile client has a twenty-second bound and explicit refresh, empty/error states and **Use demo events**; sample events are never substituted as a successful live feed.

Eventbrite retired unrestricted public event search. This integration is an organization/curated feed, not a search of every Munich event. [Official API reference](https://www.eventbrite.com/platform/new/api), [official changelog](https://www.eventbrite.com/platform/docs/by-date).

## Other application data paths

| Path | Authority and current status |
| --- | --- |
| Phone → local Node `/api/*` | One in-memory simulator, read-only diagnostics, and an authenticated designated-bay workflow. Physical commands default off; simulation writes remain separate. |
| Phone → Supabase Auth and RPCs | Prepared shared software holds for registered demo bays and separate directory-derived virtual app slots. Hosted migrations and anonymous/email Auth are configured; no fallback booking is fabricated. |
| Phone → GoingElectric | Direct directory lookup and on-device derivation of virtual app choices. A directory result does not establish a physical bay/plug identity, occupancy, or charging-session state. |
| Phone → Ecurious directly | Current Audimax map demo: local hold, native plate whitelist and direct barrier requests; separate from Node hardware reservations |
| Phone → Node → Eventbrite | Private-token organization/curated public event reads; separate from charger availability |

These paths do not share reservation IDs or perform an atomic transaction across services. Directory/demo holds do not reserve the simulator bay or move an Ecurious barrier. Explicitly enrolled hardware bays instead use the durable command workflow below. See [database contracts](DATABASE.md), [Supabase deployment/setup](SUPABASE.md), and the [Ecurious provider contract](ECURIOUS-API.md).

## Local Node HTTP API

Source: [`server.mjs`](../server.mjs), [`lib/simulator.mjs`](../lib/simulator.mjs), and [`lib/ecurious-adapter.mjs`](../lib/ecurious-adapter.mjs).

The default origin is `http://127.0.0.1:3000`. `npm start` and `npm run server:lan` intentionally bind the development server to `0.0.0.0` for phone access; the phone uses the laptop's LAN address. `PORT` changes the port. The mobile client accepts an origin-only `EXPO_PUBLIC_API_URL`; otherwise it derives a development host from Expo and uses `EXPO_PUBLIC_API_PORT` or `3000`. Android emulator fallback is `10.0.2.2`.

The simulator and diagnostic routes have **no client authentication or user isolation**. Clients reaching this process share one simulator and can read its hardware diagnostics. The separate hardware booking routes require a verified Supabase guest JWT and database ownership. It is a laptop development service, not a deployed multi-user booking backend. There is no browser CORS configuration; native phone requests do not require it. `ECURIOUS_MODE` values other than `mock` refuse startup.

| Method and exact path | Body | Successful status and response |
| --- | --- | --- |
| `GET /api/health` | None | `200`, `{ "healthy": true, "mode": "mock" }`. Does not check providers, database, or hardware. |
| `GET /api/state` | None | `200`, `ReservationState` below. Also reconciles simulated arrival expiry. |
| `GET /api/hardware` | None | `200`, redacted `HardwareSnapshot` below. No hardware write. |
| `POST /api/reservations` | `{ "plate": "M-DEMO-42", "holdMinutes": 10 }` | `201`, updated `ReservationState`. Creates a simulator hold only. |
| `POST /api/actions` | `{ "action": "..." }`, with arrival fields when needed | `200`, updated `ReservationState`. Simulator actions only. |
| `GET /api/hardware/bookings` | None; bearer guest JWT when activated | `200`, designated workflow snapshot; disabled setup is public. |
| `POST /api/hardware/bookings` | Registered bay/connector, duration, request UUID | `202`, current workflow snapshot after durable reservation intent. |
| `POST /api/hardware/actions` | Entry/release intent with bay and own reservation UUID | `202`, current workflow snapshot after durable action intent. |

There are no raw individual-hardware movement, plate-recognition or directory-proxy routes. Hardware booking routes forward a narrow authenticated intent; they are not a general Supabase proxy. `EcuriousAdapter.getStatus()` and `getLatestPlate()` are backend methods; they are not exposed as extra HTTP endpoints.

POST requests require `Content-Type: application/json` (a charset parameter is accepted), a JSON object, and at most **8 KiB** of body bytes. Known routes called with another method return `405` and an `Allow` header. This includes `HEAD` and `OPTIONS` on API routes. `/api/hardware/bookings` permits `GET, POST`; `/api/hardware/actions` permits `POST`. Unknown `/api/*` paths return `404`. No query parameters are consumed. Successful and error JSON responses use `Content-Type: application/json; charset=utf-8` and `Cache-Control: no-store`.

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
    activeErrors: string[]; faultsKnown: boolean; waterIngress: boolean | null;
    battery12V: number | null; battery3_7V: number | null; signalStrength4G: number | null;
    whitelist: { mode: 'any-plate' | 'specific-plates' | 'disabled' | 'unknown'; count: number | null };
    plateObservation: { detected: boolean; timestamp: string | null } | null;
  }[];
};
```

With no configured key, this route returns `200` with `configured: false`, `team: null`, and `locks: []`, without a network request. Configured failures return errors rather than a fabricated empty assignment. At most 100 lock records are accepted. Raw plates, whitelist entries, camera captures, serials, and arbitrary upstream fields are omitted.

`status` and `lastReportedPresence` retain the report; derived current state becomes unknown for offline/unknown status or missing, future, or older-than-60-second telemetry. A moving barrier is never rendered as a confirmed raised/lowered position. The **60-second window is a local display policy**, not a verified hardware guarantee. The mobile panel further ages retained snapshots and marks them unknown after refresh failure. It fetches on mount and manual refresh; its five-second timer updates display age only, without hardware polling. The diagnostic route itself performs no writes and there is no SSE consumer. Guarded movement uses the separate workflow below; this flow keeps automatic whitelist access disabled. Private whitelist adapter setters exist but are not used by scheduled entry.

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

## Designated hardware booking API

Sources: [hardware workflow](../lib/hardware-workflow.mjs), [backend Supabase transport](../lib/hardware-store.mjs), [mobile client](../mobile/src/lib/hardware-workflow-api.ts), [hardware hook](../mobile/src/hooks/use-hardware-workflows.ts) and [fourth migration](../supabase/migrations/20261024150000_hardware_workflow.sql). Activation and recovery requirements are in [HARDWARE-SETUP.md](HARDWARE-SETUP.md).

These routes are guarded by backend configuration and an assigned-lock allowlist. The phone supplies a Supabase user JWT in `Authorization: Bearer <user-token>`. The backend forwards it with the public project key to authenticated intent RPCs; Supabase verifies identity and ownership. The separate worker uses only its backend secret/service-role key. No private key or phone-supplied lock ID is accepted as user authorization.

A disabled `GET` returns `{source:'ecurious',commandsEnabled:false,reason:'HARDWARE_SETUP_REQUIRED',serverNow,workflows:[],observations:[]}` without requiring guest auth. Enabled reads require auth. `POST` while disabled returns `503`; missing/malformed bearer auth while activated returns `401`. The mobile client may retry an unauthenticated GET once with its restored guest token; it never automatically retries a write.

```ts
// POST /api/hardware/bookings
{ bayId: string, connectorId: string, holdMinutes: 5 | 10 | 15, requestId: string }
// POST /api/hardware/actions
{ action: 'entry' | 'release', bayId: string, reservationId: string }
```

IDs are UUIDs. `release` is an owner cancellation/cleanup intent, not a direct unlock. Both successful POSTs return HTTP **202**, even when movement is still queued or uncertain. A committed intent followed by a failed read can produce an error: reconcile by GET before another action. These legacy immediate/manual routes omit profile/plate/payment data. New plate-bound bookings use the scheduled routes below; manual entry refuses those reservations.

```ts
type WorkflowSnapshot = {
  source: 'ecurious'; commandsEnabled: boolean; reason: string | null;
  serverNow: string;
  workflows: {
    serverNow: string;
    bay: { id: string; label: string; lockId: string; connectors: BayConnector[] };
    reservation: { id: string | null; isMine: boolean; expiresAt: string | null };
    phase: 'idle' | 'protect_pending' | 'protecting' | 'protected'
      | 'entry_pending' | 'entering' | 'entry_open'
      | 'release_pending' | 'releasing' | 'blocked' | 'uncertain';
    reason: string | null;
    operation: null | {
      id: string; kind: 'protect' | 'entry' | 'release';
      target: 'raised' | 'lowered';
      status: 'queued' | 'claimed' | 'dispatching' | 'acknowledged'
        | 'uncertain' | 'confirmed' | 'cancelled';
      requestedAt: string; dispatchedAt: string | null;
    };
    capabilities: { canReserve: boolean; canRequestEntry: boolean; canRequestRelease: boolean };
  }[];
  observations: HardwareSnapshot['locks'];
};
```

The database also projects operator configuration and last stored observation metadata; the current mobile client uses the fields above. Other users see the deadline but not the reservation owner/ID. `observations` are separate current diagnostic reads and can be old, unknown or unavailable despite a successful application read. Hardware callbacks/capabilities do not establish verified LPR arrival or charging.

The worker claims through service-role-only RPCs, then commits a fenced single dispatch permit after current mapping and fresh/vacant/stable/fault/access checks. Predispatch claims may expire after 30 seconds and rotate their token; dispatched operations are never reclaimed. The observation policy defaults to 5 seconds, configurable by an administrator within 1–15 seconds. A response delayed beyond this age causes no POST and leaves the permit unresolved. Explicit fault-list presence (`faultsKnown`) and a known false water-ingress flag are required by the worker.

The adapter maps `raiseBarrier(id)` to provider `POST /api/v1/locks/:id/lock` and `lowerBarrier(id)` to `/unlock`, each with `{cancelAutoLift:false}`. Acknowledgement is `{lockId,requestedBarrier,acknowledged:true,confirmed:false,requestedAt}`. The service validates it and durably records it. Confirmation of dispatched movement requires a strictly newer provider observation and the target state. An already-correct claimed target can complete without movement.

No-ACK delivery uncertainty is quarantined even when a later GET matches: an old process could still resume after its permit and send late. Operator recovery must stop dispatchers/in-flight requests before resolving that state; neither timer expiry nor a general app button clears it. Known acknowledgements survive failed polling and can later be confirmed through reads. Entry can observe occupancy after acknowledged opening without claiming a plate match; release still requires vacancy. See [database invariants](DATABASE.md).

Public database RPCs are `list_hardware_workflows`, `get_hardware_workflow`, `request_hardware_reservation`, `request_hardware_entry` and `request_hardware_release`. Private worker RPCs are `list_hardware_operations`, `claim_hardware_operation`, `mark_hardware_dispatch`, `record_hardware_result` and `reconcile_hardware_deadlines`. Helpers and private tables have no phone grants. Generic demo reserve/cancel cannot expire or free hardware-backed holds, and generic map inventory excludes Ecurious rows.

Handled failures use the existing Node `{error:{code,message}}` envelope. Hardware configuration/schema failures return `503`; booking auth failures `401`; fixed semantic conflicts/refusals `409`; malformed user input `400`; bounded store/provider failures `502`/`504`. Worker errors never forward raw provider bodies or JWTs. The client polls every five foreground seconds, pauses actions after fifteen seconds without a successful read, serializes writes and reads after every mutation outcome. These policies do not replace physical interlocks.

## Supabase booking RPC client

Source: [`bookings-api.ts`](../mobile/src/lib/bookings-api.ts), [`booking-contract.ts`](../mobile/src/lib/booking-contract.ts), [`directory-booking-contract.ts`](../mobile/src/lib/directory-booking-contract.ts), and the booking hooks. See [DATABASE.md](DATABASE.md) for SQL, locking, permissions, expiry and constraints, and [SUPABASE.md](SUPABASE.md) for hosted setup evidence. The third migration adds directory-slot holds; it does not replace registered-bay holds.

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

## Current booking options

The fixed-fee Now/extension/calendar routes and projections are documented in [SCHEDULED-SESSIONS.md](SCHEDULED-SESSIONS.md). Hardware create and quote payloads include `bookingMode: now|scheduled` and an initial ten-minute arrival window. `POST /api/hardware/slots/extend` takes `slotId` and `requestId`, accepts either unused mode and adds ten minutes/€1 mock. Scheduled hardware protection starts ten minutes before arrival; `protectionDeadlineAt` is ten minutes after arrival plus extensions. A timely matching plate records `entryAuthorizedAt` and stops unused-hold expiry; sensor-confirmed arrival/departure remain separate. A full location yields a cancelled slot with `failureReason: LOCATION_FULL`, explicit mock refund state and advisory nearest-location alternatives.

Public-directory RPCs `reserve_directory_booking`, `extend_directory_booking` and `list_directory_holds` implement software-only intervals. The latter separates current `holds` from owner-only future/current `myBookings`. Neither directory app holds nor their scheduled lead-in send hardware commands.

## Private recognition-service handoff

The primary worker reads native Ecurious `GET /api/v1/locks/:id/plate/latest`; it needs no external model or callback token. That documented response has no confidence score. The worker privately compares the fresh post-protection recognition and queues the existing guarded entry workflow. `POST .../whitelist` programs device auto-access and does not create OCR events; current backend-controlled entry keeps that auto-access disabled. See [native OCR and whitelist integration](MODEL-INTEGRATION.md).

`POST /api/integrations/plate-recognition` optionally allows another trusted OCR service to submit a recognition event. Configure the backend-only `BAYREADY_VISION_TOKEN` (32–256 random URL-safe characters) and give it only to that service. Send it as `Authorization: Bearer <private-token>` over a private/trusted connection; production transport must use HTTPS. An app's Supabase JWT is not this credential. The Expo launcher strips this setting from the device environment. Existing command activation, explicit lock allowlist, operator mapping and interlock requirements still apply; this route is unavailable while hardware setup is disabled.

The JSON body contains exactly these fields; the plate below is fictional:

```json
{
  "lockId": "operator-assigned-lock-id",
  "eventId": "40000000-0000-4000-8000-000000000099",
  "observedAt": "2026-10-24T13:02:00.000Z",
  "licensePlate": "M-DEMO-42",
  "confidence": 0.96
}
```

Generate a fresh UUID per recognition and retain it for retries. Replace the example timestamp with the real UTC capture time: events must be no older than fifteen seconds, not future-dated and strictly newer than confirmed protection. Clocks must be synchronized. Only explicitly assigned locks are accepted. No image, camera URL or extra fields are allowed. Confidence below **0.90** is accepted as a non-match; this cutoff is a prototype assumption, not a calibrated model or safety guarantee.

Node normalizes the plate in memory, compares its keyed HMAC against an active booking and re-reads the assigned lock observation. The private database RPC checks the deadline, ownership, phase, telemetry and prior event authorization under locks. SQL stores the booking fingerprint and event digest; the raw recognition and image are not persisted, logged or returned. If accepted, the response is HTTP **202** with `{ "accepted": true, "matched": true, "entryRequested": true }`. This queues entry; the guarded worker separately dispatches and confirms lowering. HTTP 202 with `matched: false`, `entryRequested: false` and `reason: LOW_CONFIDENCE | NO_MATCHING_ACTIVE_BOOKING` requests no entry. Invalid credentials return 401; malformed bodies 400; stale events/deadline conflicts 409; disabled setup 503. Unknown write outcomes require a booking read; an event retry must reuse its UUID.

This optional endpoint was verified with fictional events and mocked hardware. A separate model is not required for Ecurious's native OCR. Actual camera-to-lock enrollment, live event timing, camera accuracy, physical movement and electrical charging remain separate evidence.

## Multi-car rehearsal routes

`GET /api/simulation` returns the isolated lab snapshot: `mode: simulation`, revision, virtual time, fictional cars/locations/bays, booking owners, observed occupants/barrier, pending acknowledged command, bounded events, scenario definitions and result checks. `POST /api/simulation/actions` takes exactly the relevant fields for one action:

| Action | Additional fields |
| --- | --- |
| `reset` | None |
| `scenario` | `scenarioId`: `race`, `plate-check`, `no-show`, `extension`, `scheduled-window`, `blocked-fallback`, `full-refund` |
| `advance` | Whole `minutes` from 1 to 180 |
| `reserve` | `carId`, `bayId`, `bookingMode`; scheduled additionally needs `arrivalMinutesFromNow` |
| `extend` | `carId`, `bookingId` |
| `scan` | `carId`, `bayId`, numeric `confidence` from 0 to 1 |
| `park`, `block` | `carId`, `bayId` |
| `depart` | `carId` |
| `observe`, `clear` | `bayId` |

Cars are `car-a`/`car-b`/`car-c`; bays are `bay-1`/`bay-2`/`bay-3`. Inputs cannot contain an actual plate, image, lock ID, account ID or API key. Every response uses no-store. Invalid controls return 400, state/owner conflicts 409, unsupported methods 405. Mutations are synchronous in one bounded process-local world. They never touch the hardware adapter, hosted database, real payments or the original single-bay simulator. See [the walkthrough and verification boundary](MULTI-CAR-SIMULATION.md).

## Privacy rights RPCs

Migration ten adds no-argument authenticated RPCs. Each derives the owner from `auth.uid()`; the phone cannot supply another owner ID. `export_my_bayready_data` projects the caller's directory reservations/extensions, registered-bay reservations and hardware bookings/extensions, plus erasure-request state. Private fingerprints/event keys/credentials/captures are omitted. This is a product data export, not the complete operator response to every access request; Auth, local device data and provider-held data are separate sources.

`request_my_data_erasure` inserts one idempotent private queue row. `get_my_privacy_request` returns the caller's request or null. The request includes ID, `status: pending_review`, original request/update times, whether active hardware allocations exist and a notice. It does not cancel reservations, delete Auth identities, erase data or change hardware state. Repeated calls preserve the original request. The table has RLS and no direct phone grants. Ecurious must review/fulfill requests, settle retention and publish the controller contact; see [PRIVACY.md](PRIVACY.md).
