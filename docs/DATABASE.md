# Database design

BayReady has two shared booking models: app-only holds on virtual GoingElectric choices, and holds on administrator-registered bays. Both use Supabase PostgreSQL and guest Auth identities. Registered demo bays remain software-only. Explicitly enrolled Ecurious bays now have a separate durable workflow that can request real barrier movement through the gated backend; a booking intent alone never proves physical protection or vacancy.

All eleven migrations were applied and checksum-verified at `2026-10-24T13:50:46.533Z`, with no pending versions and eleven application tables. Version eleven changes the interface power constraint and adds no table. The first-eight deployment's guest Auth/read/private-denial smoke passed; the ninth verified deadline projections/private work reads, and the tenth verified owner-derived privacy functions, grants and queue RLS without creating an erasure request. Private backend credentials are configured. [Supabase setup](SUPABASE.md) records exact deployment evidence.

After deployment, the user-selected `lock-0002` was separately enrolled as a real **barrier-only test**, using `BARRIER_TEST` with `powerKw:0`, no GoingElectric ID and no coordinates. The user relayed mentor confirmations for the interlock flag and later confirmed exclusive team ownership. Those are user-supplied operational confirmations, separate from the observations below.

The database control is now explicitly `enabled=true`, `interlocks_confirmed=true`, and root `.env` agrees with the running backend on port 3001. After an earlier pause/rejected activation while telemetry was unknown, a genuinely fresh lowered/vacant, fault-free, auto-access-disabled observation at **2026-10-24T14:22:21.966Z** reconciled the bay to idle; activation independently rechecked freshness and absence of unresolved operations/owners. The next old sample can still produce `blocked / TELEMETRY_UNKNOWN`. Observed reports were about three minutes apart, so a queued booking intent must be distinguished from confirmed protection. Movement freshness guards remain unchanged.

Separately authorized direct API bench calls reported raised/vacant at `2026-10-24T13:54:55.309Z`, then lowered/vacant at `13:54:59.709Z`, with newer observations and no reported errors. The first whitelist clear was verified at `13:55:56.915Z`, after which other users restored rules. After the user confirmed exclusive team ownership, a second clear returned disabled access on four readbacks over fifteen seconds. These dated setup observations do not establish the current stale device state.

The durable worker subsequently dispatched an **idle release** at `2026-10-24T14:01:41Z` and recorded confirmation at `14:01:45.502842Z`. That is observed worker/ledger evidence, separate from the direct bench calls and from a customer booking. A complete in-app booking → fresh matching plate → occupied arrival → departure → confirmed cleanup remains unverified; the barrier-only interface establishes no charging equipment or energy delivery.

The confirmed timing is arrival 15:00 → protection 14:50 → unused timeout 15:10, plus purchased minutes. The ninth migration passed its focused local PostgreSQL contract before its guarded hosted delta.

## Sources of authority

| Information | Authority | What the database knows |
| --- | --- | --- |
| Public station names, coordinates, connector types, power and listed counts | GoingElectric, requested directly by the phone | No copied directory catalog |
| BayReady hold on a listed choice | `directory_plug_reservations` | Station reference, opaque virtual slot key, owner and deadline |
| Registered locations, physical bays and identified plugs | Administrator-provided inventory | Explicit rows in `charging_locations`, `bookable_bays` and `bay_connectors` |
| BayReady hold on a registered bay | `booking_reservations` | The selected connector and an exclusive hold on its whole bay |
| Physical occupancy, barrier position and hardware faults | Ecurious telemetry, read by the Node backend | Selected provider observations are retained by the physical workflow with age/conflict guards; the provider remains the sensor source |
| Driver profile and mock payment preference | Device SecureStore | No raw plate, contact or payment fields in SQL; scheduled hardware bookings retain a backend HMAC and masked suffix |

The in-memory `/reserve` simulator is a third, independent rehearsal flow. Its state is not stored in Supabase. See [integration boundaries](INTEGRATION.md) and [the Ecurious contract](ECURIOUS-API.md).

## Relationships and allocation units

```mermaid
erDiagram
  charging_locations ||--o{ bookable_bays : contains
  bookable_bays ||--o{ bay_connectors : offers
  bookable_bays ||--o{ booking_reservations : holds
  bay_connectors ||--o{ booking_reservations : selects
  AUTH_USERS ||--o{ booking_reservations : owns
  AUTH_USERS ||--o{ directory_plug_reservations : owns
  bookable_bays ||--o| hardware_controls : enrolls
  booking_reservations ||--o{ hardware_operations : requires
  hardware_controls ||--o{ hardware_operations : serializes
  bookable_bays ||--o{ hardware_slot_bookings : schedules
  bay_connectors ||--o{ hardware_slot_bookings : selects
  AUTH_USERS ||--o{ hardware_slot_bookings : owns
  booking_reservations |o--o| hardware_slot_bookings : activates
  hardware_slot_bookings ||--o{ hardware_slot_extensions : extends
  directory_plug_reservations ||--o{ directory_plug_extensions : extends
  AUTH_USERS ||--o| privacy_erasure_requests : requests
```

`AUTH_USERS` represents Supabase's existing `auth.users` table. The application migrations reference it; they do not create a replacement Auth service. Directory holds have no foreign key to registered inventory or a copied station table.

| Model | Unit held exclusively | Meaning of an unreserved result |
| --- | --- | --- |
| Directory-listed choice | `(station_id, slot_key)` | No active BayReady hold on that virtual choice |
| Registered inventory | `bay_id`, across all its connectors | No active BayReady hold on that registered physical bay |

Directory choices are independent app allocations because the source does not identify their physical bay assignments or simultaneous charging capacity. Registered bay A1 can offer two plugs to one vehicle; choosing either plug holds A1 and prevents another booking through its other plug.

These domains do not synchronize automatically. A directory hold does not hold a registered bay, and a registered-bay hold does not create a directory hold. An optional GoingElectric mapping is not a hardware authorization or a cross-domain locking rule. A future physical integration must resolve that mapping and choose one authoritative allocation path before claiming a guaranteed bay.

## Stored tables

All eleven application tables have row-level security enabled. Direct table privileges are revoked from `PUBLIC`, `anon` and `authenticated`. Phones access projected RPC results, not raw rows. Private hardware state and extension ledgers are described below.

### `public.charging_locations`

| Column | Type / default | Rule |
| --- | --- | --- |
| `id` | UUID, generated | Primary key |
| `label` | Text, required | Trimmed length 1–120 |
| `goingelectric_id` | Bigint, nullable | Positive when present; optional administrator-confirmed reference, not unique |
| `latitude`, `longitude` | Double precision, nullable | Both absent or both present; ranges −90…90 and −180…180 |
| `created_at` | Timestamptz, database clock | Required creation time |

Coordinates are fictional/demo or supplied by an operator. No automated directory import populates this table. Missing coordinates remain representable rather than inventing a location; the mobile map can omit an unrenderable location while retaining booking context.

### `public.bookable_bays`

| Column | Type / default | Rule |
| --- | --- | --- |
| `id` | UUID, generated | Primary key; identifies one physical one-vehicle space |
| `location_id` | UUID, required | References `charging_locations`; location deletion restricted |
| `label` | Text, required | Trimmed length 1–120 |
| `integration_mode` | Text, `demo` | Only `demo` or `ecurious` |
| `ecurious_lock_id` | Text, nullable, unique | Must be absent for demo rows; nonblank and present for Ecurious rows |
| `enabled` | Boolean, `false` | Controls visibility in the registered-inventory list RPC |
| `created_at` | Timestamptz, database clock | Required creation time |

An enabled bay is not necessarily bookable: rehearsal `reserve_bay` calls require demo mode and an enabled connector. Ecurious mode uses the dedicated physical RPCs and control gates below. An enabled demo bay with no enabled plugs can still be returned as inventory, without a selectable booking option.

### `public.bay_connectors`

| Column | Type / default | Rule |
| --- | --- | --- |
| `id` | UUID, generated | Primary key; identifies one operator-registered plug or explicit barrier-test interface |
| `bay_id` | UUID, required | References `bookable_bays`; connector rows cascade if their bay can be deleted |
| `label` | Text, required | Trimmed length 1–120 |
| `connector_type` | Text, required | Trimmed length 1–40; not a database enum |
| `power_kw` | Numeric, required | 0–2000 inclusive; actual connector types require positive power; `BARRIER_TEST` requires exactly zero |
| `enabled` | Boolean, `false` | Required for a new hold |
| `created_at` | Timestamptz, database clock | Required creation time |

The numeric bound rejects negative, nonfinite and excessive values. Actual connector types require positive power even when disabled. `BARRIER_TEST` accepts only zero and explicitly means no charger/rating is asserted. The historical exception is `UNKNOWN`/0 kW with `enabled=false`, preserving old bookings whose plug was never recorded. `CCS` and `Typ2` are seeded charging types. Fallback requires the same interface type, so a barrier test cannot switch to a real charger. JSON stays `{id,label,type,powerKw,enabled}`; zero is valid for the explicit test type without being a charging-power measurement.

`UNIQUE (id, bay_id)` supports a composite reservation foreign key. This prevents even a direct administrator insert from pairing a connector with another physical bay.

### `public.booking_reservations`

| Column | Type / default | Rule |
| --- | --- | --- |
| `id` | UUID, generated | Primary key |
| `bay_id` | UUID, required | References the registered bay; deletion restricted |
| `connector_id` | UUID, required | `(connector_id, bay_id)` references the same connector/bay pair; deletion restricted |
| `owner_id` | UUID, required | References `auth.users`; user deletion cascades to their reservations |
| `starts_at`, `expires_at` | Timestamptz, required | Positive interval, no longer than 130 minutes including scheduled protection lead-in; immediate/rehearsal RPCs still cap their own requests at 30 |
| `status` | Text, `held` | Only `held`, `cancelled` or `expired` |
| `idempotency_key` | UUID, required | Unique together with `owner_id` |
| `created_at` | Timestamptz, database clock | RPC sets it equal to `starts_at` |

`booking_reservations_one_held_per_bay` is a unique index on `bay_id WHERE status='held'`. A second connector does not create a second allocatable parking space. An owner/creation-time index supports ownership history, with additional foreign-key lookup indexes on bay locations and connectors.

### `public.directory_plug_reservations`

| Column | Type / default | Rule |
| --- | --- | --- |
| `id` | UUID, generated | Primary key |
| `station_id` | Bigint, required | 1…9007199254740991, preserving exact JavaScript/JSON identity |
| `slot_key` | Text, required | Exactly 64 lowercase hexadecimal characters |
| `owner_id` | UUID, required | References `auth.users`; user deletion cascades to their holds |
| `created_at`, `expires_at` | Timestamptz, required | Database creation time and allocation end; scheduling/extension interval rules below |
| `status` | Text, `held` | Only `held`, `cancelled` or `expired` |
| `idempotency_key` | UUID, required | Unique together with `owner_id` within this table |

Migration eight replaces the earlier partial unique index with a GiST exclusion constraint on `(station_id,slot_key,tstzrange(protection_starts_at,expires_at,'[)')) WHERE status='held'`. Non-overlapping future allocations may share a virtual choice; overlapping software lead-in/end intervals cannot. An owner/creation-time index supports ownership reads. No names, coordinates, connector descriptions, counts, raw plates or camera payloads are stored.

New fields are `booking_mode` (`legacy`, `now`, `scheduled`), `starts_at`, `protection_starts_at`, `initial_expires_at`, `reservation_fee_cents`, `payment_status` (`not_required`, `mock_paid`) and `extension_minutes`. Now begins at DB time for ten free minutes. Scheduled begins at a requested arrival within seven days, ends ten minutes later and reserves a ten-minute software lead-in for €1 mock. Each accepted extension adds ten minutes/€1, capped at eleven extensions and 120 minutes for new options. Existing legacy intervals survive without retroactive lead-in; their older initial 1–30 minutes remain representable.

`directory_plug_extensions` is the tenth application table. Its owner/request primary key, reservation reference, accepted expiry and creation timestamp provide extension idempotency. Its Auth/reservation foreign keys cascade with software history; RLS and revoked guest grants keep the ledger private. These rows still represent only BayReady software allocations, with no hardware action or actual payment. See [scheduled sessions](SCHEDULED-SESSIONS.md).

There is no need to provision every empty slot. After a successful, current hold read for a station, a listed choice absent from the returned holds is app-unreserved. Missing schema, a failed request, an unqueried station or stale data does not establish an unreserved result.

## Virtual directory keys

The phone derives shared allocation keys in [directory-slots.ts](../mobile/src/lib/directory-slots.ts). It merges identical connector type/power groups and generates:

```text
canonical = JSON.stringify(["bayready-directory-v1", stationId, type, power])
slotKey   = SHA256(canonical).slice(0, 56)
            + ordinal.toString(16).padStart(8, "0")
```

The ordinal starts at 1. Reordering source groups does not change keys, and increasing a group's count retains existing ordinal keys. A type/power change or a count reduction can leave an active hold without a corresponding current listed choice. Owned holds remain retrievable and cancellable even after a viewport or catalog change.

This is a virtual identity, not an operator's physical connector ID. The database checks its format, not the hash algorithm, actual ordinal, source count or station existence. Catalog data stays on the phone; the service does not fetch a directory catalog to validate incoming claims. That trust limit is acceptable for this software prototype, not evidence of physical capacity enforcement.

## Auth and RPC access

The public Supabase client key identifies the project. A separate anonymous Auth sign-in creates a guest `auth.users` identity and an `authenticated` session. Merely possessing an anon/publishable key does not grant booking RPC execution.

The Account screen can link and verify an email on the existing guest identity, then set a password; preserving its user UUID preserves reservation ownership. It also supports email/password sign-in. Email belongs to Supabase Auth, not the booking tables. Hosted anonymous Auth and manual-linking settings have been verified; email delivery, verification links/codes and cross-device account usage have not been exercised by the setup smoke checks.

The six software-booking RPCs use `SECURITY DEFINER`, an empty `search_path`, qualified relation references, and an explicit non-null `auth.uid()` check. Execution is revoked from `PUBLIC` and `anon`, then granted to `authenticated`. Physical workflow guest RPCs follow the same rule; worker RPCs are granted only to `service_role`. There are no direct client table policies; function-owner execution deliberately performs the checks and returns curated fields. This boundary does not restrict project administrators or substitute for keeping privileged credentials off the phone.

### Registered inventory RPCs

```sql
list_bay_availability() returns jsonb
reserve_bay(
  p_bay_id uuid,
  p_hold_minutes integer default 10,
  p_request_id uuid default null,
  p_connector_id uuid default null
) returns jsonb
cancel_reservation(p_reservation_id uuid) returns jsonb
```

`reserve_bay` still requires a request UUID and connector UUID at runtime. SQL accepts 1–30 minutes; the UI offers 5, 10 or 15. The earlier three-argument overload is removed to avoid ambiguous PostgREST function resolution.

`list_bay_availability` returns:

```text
{ serverNow, bays: [{
  id, label, locationId, locationLabel, goingelectricId,
  latitude, longitude, mode, lockId,
  connectors: [{ id, label, type, powerKw, enabled }],
  availability: "unreserved" | "reserved",
  reservedUntil, isMine, myReservationId, myConnectorId
}] }
```

Only enabled demo bays are listed; Ecurious bays now use `list_hardware_workflows` so an elapsed deadline cannot hide a still-protected physical booking. Disabled connectors remain included with their explicit state. Other holders' identities and reservation IDs are omitted. `myReservationId` and `myConnectorId` are present only for the caller's own active hold, otherwise null. An unreserved result has a null deadline and no ownership fields. Location coordinates and directory mapping can be null.

Reserve/cancel results are `{id, bayId, connectorId, status, startsAt, createdAt, expiresAt}`. Dates are serialized database timestamps. A list response is a booking observation, not a promise that a later write cannot conflict.

### Directory hold RPCs

```sql
list_directory_holds(p_station_ids bigint[]) returns jsonb
reserve_directory_plug(
  p_station_id bigint,
  p_slot_key text,
  p_hold_minutes integer,
  p_request_id uuid
) returns jsonb
cancel_directory_hold(p_reservation_id uuid) returns jsonb
reserve_directory_booking(p_station_id bigint,p_slot_key text,
  p_booking_mode text,p_starts_at timestamptz,p_request_id uuid) returns jsonb
extend_directory_booking(p_reservation_id uuid,p_request_id uuid) returns jsonb
```

The list input is a one-dimensional array of at most 500 positive safe-integer station IDs. An empty array is valid. The result is:

```text
{ serverNow, holds: [{
  stationId, slotKey, reservedUntil, isMine, myReservationId
}], myBookings: [...] }
```

`holds` includes requested-station allocations whose software protection interval has started, plus all caller-owned current allocations outside that area. Future protection intervals do not make a marker reserved early. `myBookings` separately includes all caller-owned unexpired held bookings, including future reservations. An empty station input restores owned current/future bookings without exposing other stations' holders. Other users receive only current slot/deadline facts and `myReservationId:null`; owner identities and future private payment details are not returned. This preserves cancellation access to orphan keys.

Reserve/cancel/extend results include `{id,stationId,slotKey,status,createdAt,expiresAt,bookingMode,startsAt,protectionStartsAt,reservationFeeCents,paymentStatus,extensionMinutes}`. The compatibility `reserve_directory_plug` RPC now accepts only ten minutes and forwards to the free Now option; changed free variable durations are rejected. Scheduled mode requires an explicit future start; Now requires `p_starts_at=NULL` so DB time is authoritative. No catalog or vehicle-profile fields are accepted.

### Fixed application errors

| Error message | Meaning |
| --- | --- |
| `AUTH_REQUIRED` | No authenticated guest/user identity |
| `INVALID_HOLD` | Invalid rehearsal duration, or a compatibility directory call requesting anything except ten minutes |
| `REQUEST_ID_REQUIRED` | Missing request UUID |
| `IDEMPOTENCY_CONFLICT` | A prior request UUID was reused with different allocation parameters |
| `RESERVATION_NOT_FOUND` | Unknown reservation or one belonging to somebody else |
| `BAY_NOT_FOUND`, `BAY_DISABLED`, `BAY_NOT_BOOKABLE` | Missing, disabled or non-demo registered bay |
| `CONNECTOR_REQUIRED`, `CONNECTOR_NOT_AVAILABLE` | Missing connector or one disabled/not belonging to the target bay |
| `BAY_RESERVED` | Registered physical bay already held |
| `INVALID_STATION`, `INVALID_STATIONS`, `INVALID_SLOT` | Invalid directory reference or list scope |
| `PLUG_RESERVED` | Virtual station/slot pair already held |

Auth failures use SQLSTATE `42501`, invalid scalar/list input uses `22023`, and semantic conflicts/refusals use `P0001`. Invalid SQL argument types can be rejected before a function runs. The phone maps known errors to fixed messages and does not display arbitrary upstream error text.

## Atomic allocation and retries

Both reserve paths first take a transaction-scoped advisory lock for the owner and inspect their request history. This serializes concurrent retries, including ones targeting different allocations. It does **not** limit an owner to one active hold. Idempotency uniqueness is per owner and per reservation table, not a shared cross-domain request ledger.

For a new registered-bay hold:

1. Compare any earlier matching request's bay, connector and duration; reject mismatches.
2. Lock the bay row with `FOR UPDATE`, then sample the database clock.
3. Reconcile elapsed `held` rows for that bay to `expired`.
4. Verify enabled demo inventory and lock/check the selected enabled connector with `FOR SHARE`.
5. Reject any remaining held row, then insert the new hold and deadline.

For a directory hold, the sequence is the same except that a transaction-scoped advisory lock on the station/slot pair replaces the inventory row lock. No physical inventory row or catalog verification is performed. Different directory slots can commit concurrently; competing requests for the same slot cannot both allocate it.

Registered immediate holds retain a partial unique index; scheduled physical/directory intervals use GiST exclusion constraints. All work commits together; an exception rolls back that transaction's changes. No application-controlled read-then-write sequence establishes exclusivity.

A repeated request UUID with identical parameters returns the original reservation and deadline, including its later `cancelled` or `expired` status. It never renews or creates a replacement hold. In the registered domain, an existing request can still be returned after its inventory or connector was disabled. A deliberate new hold uses a new UUID.

The mobile client currently generates one UUID per deliberate reserve call, disables SDK write retries, and performs a read after success, rejection or uncertain delivery. It does not persist a request UUID for arbitrary later retransmission. The SQL contract supports exact retries, but the UI's recovery path is reconciliation rather than blind resend. See [bookings-api.ts](../mobile/src/lib/bookings-api.ts).

Cancellation takes the same owner lock and allocation lock order. It looks up only caller-owned history, so unknown IDs and somebody else's IDs produce the same error. Repeated cancellation returns the existing result. A past-deadline held row becomes `expired`; an unexpired held row becomes `cancelled`.

## Time, expiry and recovery

The database clock sets all new deadlines after allocation locks are acquired. A waiting request cannot reuse an old pre-lock time. Both list RPCs exclude holds whose deadline has passed, even if their stored status still says `held`.

Expiry is lazy: list calls have no cleanup writes, while reserve/cancel reconcile relevant rows within their transactions. The unique held indexes intentionally include elapsed rows until that reconciliation. A valid new reserve expires the stale row before inserting its replacement. There is no scheduled cleanup worker or cron requirement for app booking availability.

The phone polls while foregrounded and uses a local freshness guard. A displayed countdown reaching zero does not fabricate a new available state: the next successful database read confirms the booking outcome. Network failure or a changed directory scope invalidates the current availability observation. These are app connection rules, not hardware freshness thresholds.

Software-only expiry and cancellation do not send barrier commands, change whitelists, prove physical vacancy or record charging completion. The physical workflow below instead queues safe cleanup and keeps its booking held until the cleanup is confirmed. Its durable operation ledger is not a distributed transaction with Ecurious.

## Durable physical workflow

The [hardware migration](../supabase/migrations/20261024150000_hardware_workflow.sql) reuses `booking_reservations` for whole-bay ownership and adds two private tables. Migrations seed no real hardware. The separately enrolled barrier-only `lock-0002` uses this unchanged durable workflow; its direct API bench tests did not create reservation operations. See [activation and operator recovery](HARDWARE-SETUP.md).

### Private state and ledger

`hardware_controls` has one row per enrolled bay, with its current reservation and operation references, phase, release intent/reason, entry intent, and the last selected sensor observation. It defaults to `enabled=false`, `interlocks_confirmed=false`, and a 5000 ms local observation-age limit, configurable within 1000–15000 ms. These are workflow policies; they are not provider safety guarantees.

Its phases are `idle`, `protect_pending`, `protecting`, `protected`, `entry_pending`, `entering`, `entry_open`, `release_pending`, `releasing`, `blocked` and `uncertain`. Observation fields contain only provider timestamp, stable barrier/presence values, fault presence and access-policy mode. A conflict latch prevents contradictory same-timestamp samples from being treated as fresh safe state; only a strictly newer sample clears it.

`hardware_operations` records immutable operation identity, sequence, bay/reservation/lock mapping, kind (`protect`, `entry`, `release`), target, status, requested/dispatch/acknowledgement/confirmation times, claim token/worker/lease, selected observation time and a fixed reason code. Targets are raised for protection and lowered for entry/release. Its statuses are `queued`, `claimed`, `dispatching`, `acknowledged`, `uncertain`, `confirmed` and `cancelled`.

A partial unique index allows one unresolved operation per bay. The control row points to the current operation, and ledger mappings are captured when queued. A trigger refuses changes to a bay's integration mode or assigned lock while its physical workflow is active. Restrictive references preserve the booking/ledger instead of allowing Auth-user deletion or inventory removal to silently remove a physical guard.

### Guest and worker interfaces

Authenticated guests can call:

```sql
list_hardware_workflows()
get_hardware_workflow(p_bay_id uuid)
request_hardware_reservation(
  p_bay_id uuid, p_connector_id uuid,
  p_hold_minutes integer, p_request_id uuid
)
request_hardware_entry(p_reservation_id uuid)
request_hardware_release(p_reservation_id uuid)
```

Requests return the current workflow, not a command-completed claim:

```text
{
  serverNow, bay: {id,label,lockId,connectors},
  reservation: {id: ownIdOrNull,isMine,expiresAt},
  phase,reason,controlsEnabled,interlocksConfirmed,telemetryMaxAgeMs,
  observation: {observedAt,conflicted,barrier,occupancy,faulted,accessMode},
  operation: {id,kind,target,status,requestedAt,dispatchedAt} | null,
  capabilities: {canReserve,canRequestEntry,canRequestRelease}
}
```

The list response is `{serverNow,workflows:[...]}`. Another owner's reservation ID is omitted. An overdue physical reservation retains its ID/deadline and physical guard, unlike a software-only hold that disappears at expiry. Manual entry requires the owning session, confirmed protection and an unexpired arrival deadline; it is not an LPR or charging authorization claim.

Only `service_role` can call:

```sql
list_hardware_operations()
claim_hardware_operation(p_worker_id uuid, p_operation_id uuid default null)
mark_hardware_dispatch(
  p_operation_id uuid, p_claim_token uuid,
  p_observed_at timestamptz, p_barrier text,
  p_occupancy text, p_faulted boolean, p_access_mode text
)
record_hardware_result(
  p_operation_id uuid, p_claim_token uuid, p_outcome text,
  p_observed_at timestamptz default null,
  p_barrier text default 'unknown', p_occupancy text default 'unknown',
  p_reason text default null, p_faulted boolean default true,
  p_access_mode text default 'unknown'
)
reconcile_hardware_deadlines()
```

Private operation results include `{id,bayId,lockId,reservationId,kind,target,status,claimToken,requestedAt,dispatchedAt,acknowledgedAt,controlsEnabled,interlocksConfirmed,telemetryMaxAgeMs}`. The operation list is `{serverNow,operations:[...]}`. Listing hides tokens for queued/live-claimed operations; the winning claimant receives its token. Already-dispatched tokens permit result reconciliation, never a second dispatch. Read-only monitoring of a current confirmed operation accepts a null token.

Result outcomes are `blocked`, `unknown`, `acknowledged`, `uncertain`, `confirmed` and `failed`; the longer preflight aliases are also accepted. Before dispatch, an unsafe/unknown result returns the job to a queue for another fresh preflight. After dispatch, a failure or unknown result cannot requeue physical movement. Fixed reason codes exclude arbitrary upstream bodies.

### Claim, dispatch and confirmation boundaries

Admission atomically creates a held booking, binds the control row, and queues protection. Competing plugs/users cannot bypass the whole-bay guard. The old rehearsal reserve/cancel implementations are private helpers, guarded against Ecurious rows; their lazy expiry cannot free a physical workflow.

A claimed operation has a 30-second predispatch lease. Expired claims can be replaced with a new token, and cancellation can invalidate an unsent claim. `mark_hardware_dispatch` locks the current control/operation, checks the active token/lease/mapping/configuration, and requires a fresh, known, vacant, fault-free preflight. It rejects older observations and contradictory same-time facts. Protection additionally requires disabled automatic plate access. An already-correct target is confirmed as a no-op instead of obtaining a movement permit.

The dispatch permit is persisted before the provider POST and can be obtained once. Dispatching, acknowledged and uncertain operations never become claimable again. A timeout of the permit RPC itself means the worker must not send: the permit might already have committed.

Confirmation after dispatch requires a persisted acknowledgement, the expected stable target, appropriate vacancy/fault/access state, and a provider observation **strictly newer** than dispatch. An equal or cached timestamp does not confirm movement. Acknowledgement is retained across later failed reads. Entry monitoring can retain `entry_open` when occupancy is observed, without claiming plate recognition or charging.

Without acknowledgement, a matching GET cannot automatically clear delivery uncertainty: a paused old dispatcher might still send late, and Ecurious supplies no device-side fencing or idempotency token. Operator recovery must retire old dispatchers/in-flight actions before a new cleanup operation is queued. The implementation provides one durable dispatch permit per operation, not exactly-once execution at the device.

Cancellation and no-show deadlines set release intent but keep `booking_reservations.status='held'`. An in-flight/uncertain operation must resolve before an opposite command is queued. Occupied or unknown cleanup remains blocked. Only confirmed lowered/vacant cleanup clears the control's reservation and changes the booking to `cancelled` or, for expiry/no-show, `expired`. Pricing is a labelled mock; no payment is collected and no missing-event inference establishes vacancy.

## Scheduled physical sessions

The [fifth migration](../supabase/migrations/20261024160000_scheduled_hardware_slots.sql) adds `hardware_slot_bookings`. It schedules a registered whole bay while retaining one selected connector. Its UUID, owner, bay/connector, exact requested start/end, source, request UUID and creation/update timestamps form a separate scheduling ledger. `hardware_reservation_id` remains null until activation. The optional reference is unique, and composite connector/bay foreign keys prevent selecting a plug on another bay. Owner deletion and referenced booking deletion are restricted to preserve physical recovery history.

`booking_mode='now'` creates exactly ten free minutes from the database clock, with immediate protection intent. `booking_mode='scheduled'` starts at an arrival within seven days, with a fixed €1 mock fee, `protection_starts_at=starts_at−10 minutes` and an initial unused deadline ten minutes after arrival. New requests use `ends_at=starts_at+10 minutes`; requested times remain immutable for retries. `protection_deadline_at` is the authoritative unused cutoff, separate from arrival and retained historical planned ends. A 60-second allowance for a just-past requested start covers confirmation latency. Actual movement cannot precede creation or the protection lead-in. Existing historical ends and physical quarantine are preserved; only unused calendar deadlines are shortened to the reviewed policy.

`hardware_slot_no_overlap` is a PostgreSQL GiST exclusion constraint over `(bay_id, tstzrange(protection_starts_at,protection_deadline_at,'[)'))`, using `btree_gist`. It covers `scheduled`, `active`, `blocked` and `cancel_requested`. This enforces whole-bay exclusivity across plugs and servers, including lead-in and purchased unused minutes. Adjacent calendar intervals are allowed. Final states are `cancelled`, `completed` and `expired`; a physical guard can outlast its calendar deadline and prevents later activation until safely cleaned up.

Creation obtains the owner advisory lock, then the bay/control locks, checks idempotency and inserts a schedule row. Original requested resource IDs and exact requested times are retained separately from assigned IDs/DB-normalized Now times. Retries remain idempotent after fallback or extension; changed original identity, mode, plate hash or suffix produces `IDEMPOTENCY_CONFLICT`. Overlaps produce `SLOT_RESERVED`. The older immediate hardware RPC mirrors its booking into the same physical-interval exclusion ledger; conflicts roll back its allocation and protection operation. Operators cannot remap a lock while pending/active slots use the bay.

### Scheduling RPCs

Authenticated guest calls:

```sql
list_hardware_slots(p_bay_id uuid default null,
  p_from timestamptz default null, p_until timestamptz default null)
list_my_hardware_slots()
get_hardware_slot(p_slot_id uuid)
request_hardware_slot(p_bay_id uuid,p_connector_id uuid,
  p_starts_at timestamptz,p_ends_at timestamptz,p_request_id uuid,
  p_plate_hash text,p_masked_plate text,p_booking_mode text default 'scheduled')
cancel_hardware_slot(p_slot_id uuid)
request_hardware_slot_extension(p_slot_id uuid,p_request_id uuid)
```

Lists return `{serverNow,slots:[...]}`; get/create/cancel/extend return `{serverNow,slot:{...}}`. Each slot includes the identity, time, status and session fields above plus `bookingMode,protectionStartsAt,protectionDeadlineAt,reservationFeeCents,paymentStatus,requestedBayId,requestedConnectorId,extensionCount,failureReason`. Other owners see calendar mode/protection timing but no owner ID, masked plate, session details, original requested IDs or payment facts. No hash is returned. Directory booking projections alias `protectionDeadlineAt` to their existing `expiresAt`. Lists cap at 1000 rows and eight days plus one minute per requested window; own unresolved sessions remain recoverable beyond that window. The default own list covers the previous day and next seven days. A truncated calendar is not a booking guarantee; insertion is authoritative.

`hardware_slot_extensions` stores the owner/request UUID pair, slot reference, accepted new end and database creation timestamp. It has RLS and no guest table grants. An owning Now or Scheduled slot in scheduled/active state can extend before its unused deadline and before accepted matching entry, adding ten minutes/€1 mock, up to 120 minutes. The UI exposes extension while protection is active; SQL also permits preparing one on an owned future Scheduled booking. Owner → bay → control → slot locks serialize it. The extended exclusion interval, unused deadline, planned end, physical expiry and request ledger commit atomically; conflict rolls back everything and retries add nothing. Deadline reconciliation rereads the current cutoff under the control lock.

Only `service_role` can call:

```sql
reconcile_hardware_slots()
list_hardware_slot_work(p_limit integer default 100)
record_hardware_bay_observation(p_bay_id uuid,p_observed_at timestamptz,
  p_barrier text,p_occupancy text,p_faulted boolean,p_access_mode text)
authorize_hardware_plate_entry(p_slot_id uuid,p_plate_hash text,
  p_recognized_at timestamptz,p_event_key text)
list_hardware_booking_alternatives(p_slot_id uuid)
```

The work list returns `{serverNow,controls:[{bayId,lockId,phase,controlsEnabled,interlocksConfirmed,telemetryMaxAgeMs}],slots:[...]}` with at most 100 of each. Its slot rows contain the private HMAC and session facts needed by the backend; they are never forwarded to phones. Reconciliation reports activation/completion/block counters and invokes the existing guarded deadline cleanup. It does not make HTTP calls.

### Idle, activation, recognition and departure

The intended idle state is lowered and vacant. A fresh occupied idle observation marks the control blocked. Unknown, stale, contradictory or faulty observations do not restore availability. A fresh lowered/vacant observation can restore idle only when no unresolved operation exists. A raised/vacant idle bay queues a normal `release` operation with `reservation_id=NULL`; it goes through the same claim, dispatch, acknowledgement and confirmation guards. Only idle release operations may have a null reservation. A matching read cannot clear an idle command lacking acknowledgement.

At `protection_starts_at`, the scheduler locks the bay/control and rechecks mapping, connector, safely idle state, and fresh lowered/vacant/fault-free telemetry with automatic access disabled. It atomically creates the held allocation and protection operation. An unactivated unavailable target can move to another physical bay at the same registered location, with the same connector type and at least the requested power rating. Selecting another plug on the occupied bay is insufficient. Requested resource IDs stay immutable; assigned IDs reflect the alternate. Candidate bay locks use `SKIP LOCKED`, and interval exclusion is rechecked atomically. No activated booking is moved. An unresolved dispatched operation on the original bay keeps the new slot blocked rather than switching it.

If no compatible safe bay is available, an unactivated slot becomes `cancelled` with `failure_reason='LOCATION_FULL'`; a paid mock booking becomes `mock_refunded`, while a free Now booking remains `free`. No physical guard is cleared by this failure. The private alternatives RPC returns up to three nearest other registered locations with operator-provided coordinates and fresh safely idle compatible bays for the same interval. It returns labels, coordinates, straight-line distance, available bay count and connector types, with no directory catalog copy or automatic external booking. The backend verifies the failed slot belongs to the caller before invoking this private read. Alternatives are point-in-time observations, not guarantees. Enabled fallback inventory must be served by an assigned/allowlisted running worker.

For this implementation, the backend normalizes a driver-supplied plate in request memory and stores only an HMAC-SHA256 fingerprint using its stable secret, plus a masked two-character suffix. A camera event is compared privately against that fingerprint. Guest-supplied hashes are unverified booking claims, not proof of plate ownership, and cannot authorize movement: only the private entry RPC can consume a matching recognition. The public manual entry RPC refuses scheduled plate-bound sessions with `PLATE_AUTH_REQUIRED`; it remains available for the older immediate prototype path.

Entry authorization requires the active slot, its current protected allocation, disabled automatic access, fresh vacant/fault-free raised telemetry, a matching hash, and a recognition timestamp strictly after protection confirmation, no more than 15 seconds old and not in the future. Event keys make accepted retries idempotent. Authorization records `entry_authorized_at` and queues the existing fenced lower operation. It does not claim the car is parked. Only a later fresh occupied/lowered sensor sample after entry opens records `arrived_at`. A strictly later fresh vacant/lowered sample records `departed_at` and queues cleanup. The slot becomes completed only after confirmed cleanup ends its physical allocation. Charging and energy delivery remain unmeasured.

The authoritative `_hardware_slot_deadline` helper is used by both scheduling and private recognition authorization. Now begins with a ten-minute unused hold; Scheduled arrival T protects at T−10 and times out at T+10. Paid minutes extend the deadline for either option. Before T−10, a future booking causes no hardware operation and does not mark a presently idle bay occupied. Both DB time and a new recognition event must precede the deadline.

An accepted matching recognition exits **both** automatic expiry paths: neither scheduled no-show cleanup nor the older physical booking-expiry worker can free the entering driver's allocation. `entry_authorized_at` is authorization evidence; it does not fabricate `arrived_at`. Physical occupied → later vacant observations and confirmed cleanup complete the session. If that sensor sequence never arrives, the owner/operator must request safe cancellation; a missing event never frees the bay. Unmatched unused expiry queues guarded cleanup, retaining the allocation while occupied/unknown/uncertain. Cancellation before activation is immediate; after activation it keeps the guard until cleanup completes.

Current pricing is fixed: Now starts free; each accepted ten-minute extension adds €1; Scheduled starts at €1. `reservation_fee_cents` and `payment_status` are server-controlled, with `free`, `mock_paid` and `mock_refunded` states. The older per-minute estimate is superseded. Timing/waiver fields remain as diagnostic history; they do not create a payment processor or a real charge. Plate-ownership verification, key rotation and automatic retention remain unimplemented.

## Migration history and seeds

| Migration | Effect |
| --- | --- |
| [Initial bookings](../supabase/migrations/20261024120000_bayready_reservations.sql) | Introduces registered bays, owned holds, RPC access, and one fictional demo bay |
| [Location/bay/connector hierarchy](../supabase/migrations/20261024130000_location_bay_connectors.sql) | Moves location fields into location rows, registers plugs, preserves previous holds, and replaces the reserve RPC signature |
| [Directory app holds](../supabase/migrations/20261024140000_directory_plug_holds.sql) | Adds virtual directory-slot holds and their separate RPCs without changing physical-bay allocation semantics |
| [Durable hardware workflow](../supabase/migrations/20261024150000_hardware_workflow.sql) | Adds private physical guards/operation ledger, owner intents, fenced worker RPCs, strict confirmation, and guards around rehearsal APIs; enrolls no real hardware |
| [Scheduled hardware slots](../supabase/migrations/20261024160000_scheduled_hardware_slots.sql) | Adds whole-bay window exclusion, deferred activation, private plate-match authorization, sensor session facts, no-show cleanup and idle lowering; enrolls no real hardware |
| [Plate arrival deadline](../supabase/migrations/20261024170000_plate_arrival_deadline.sql) | Rejects new plate authorization once either current database time or recognition time reaches the no-show/window cutoff, including between scheduler ticks |
| [Booking options](../supabase/migrations/20261024180000_booking_options.sql) | Replaces pricing/deadlines with Now and Scheduled modes, reserves protection lead-in, adds idempotent paid extensions, safe same-location fallback/refunds and nearby registered alternatives |
| [Directory booking options](../supabase/migrations/20261024190000_directory_booking_options.sql) | Adds free ten-minute Now, €1 mock Scheduled with software lead-in, €1 extensions, owner-only future bookings and interval exclusion without importing a directory catalog or operating hardware |
| [Arrival grace](../supabase/migrations/20261024200000_arrival_grace.sql) | Separates planned arrival/unused deadline, confirms T−10/T+10 timing, enables both-mode extensions, and keeps accepted matched entry out of automatic deadline cleanup without inventing physical occupancy |
| [Privacy rights](../supabase/migrations/20261024210000_privacy_rights.sql) | Adds owner-only booking exports and idempotent pending-review erasure intake without deleting Auth/history or changing physical guards |
| [Barrier-test interface](../supabase/migrations/20261024220000_barrier_test_interface.sql) | Supports exactly-zero `BARRIER_TEST`, positive real ratings and disabled historical `UNKNOWN` rows; changes no enrollment/command guard and seeds no hardware |

The hierarchy migration preserves the original demo bay ID and creates its fictional location. Other existing bays each receive a separate location containing their previous label, coordinates and directory mapping; shared sites are not guessed. Bay-level coordinate/directory columns are then removed so location metadata has one authority.

For every bay with old reservations, it creates a disabled `UNKNOWN`/0 kW legacy connector and backfills those reservations to it. Original reservation IDs, owners, states, timestamps and request UUIDs survive. This records that the historical connector is unknown instead of inventing a selected plug. The owner can still cancel that hold.

The fresh seed is one fictional Berlin location (`52.52, 13.405`), three bays and four enabled plugs: A1 has CCS 150 kW and Type 2 22 kW; A2 has CCS 150 kW; A3 has Type 2 22 kW. There is no GoingElectric ID or Ecurious lock mapping. The directory domain has no inventory or initial reservation seed: unreserved app slots are derived from successful reads, not copied catalog rows.

Separate privileged enrollment registered the selected `lock-0002` with a labelled test location/bay and one `BARRIER_TEST` interface. The location has null directory reference/coordinates. It was created with disabled controls/interlocks; later user-confirmed activation is a separate configuration change. Neither that real registration nor the direct API setup tests is a migration seed or charging demonstration.

Migrations are ordered schema changes, not idempotent setup scripts or a database reset. The test-only `_bayready_upgrade_expected` table is created by the upgrade fixture in a disposable database; it is not part of the deployed application schema.

## Validation and deployment limits

`npm run test:database` runs [the isolated Docker harness](../scripts/test-database.mjs). It applies the schema versions in order, tests the original contract, injects fictional upgrade history, then tests hierarchy preservation and directory holds. It creates minimal local Auth shims; no `.env`, remote Supabase account or directory API is used.

The SQL suites cover auth/grants/RLS, private projections, input constraints, ownership, expiry, cancellation, idempotency, connector/bay consistency, unknown historical plugs and migration preservation. Independent PostgreSQL sessions also verify:

- Different plugs on one registered bay produce one winner and `BAY_RESERVED`.
- Concurrent identical registered-bay requests return one ID and unchanged deadline.
- Two users requesting one virtual plug produce one winner and `PLUG_RESERVED`.
- Different virtual plugs can commit concurrently.
- Concurrent identical directory requests return one ID and unchanged deadline.
- Owner cancellation removes the active directory hold for other users.
- Physical admission through different plugs yields one held booking; competing workers obtain one claim and one dispatch permit.
- Overlapping scheduled windows through different plugs yield one winner; concurrent identical retries preserve one unchanged future window and create no early operation.

The hardware contract suite also exercises default-disabled enrollment, private grants, stale/conflicting source observations, lease fencing, owner-only entry/release, cancellation before/after dispatch, acknowledgement retention, no-ACK quarantine, strict command/sample ordering, occupied cleanup, no-show retention and active-mapping guards. All lock IDs in those tests are fictional; no Ecurious HTTP call is made.

The scheduled-slot suite covers future-only scheduling, adjacency/overlap, legacy immediate rollback on future conflict, private projections, recognition replay/age/ownership checks, manual-entry rejection for scheduled sessions, occupied arrival, sensor departure, no-show grace, persistent billing stops and nullable-owner idle cleanup with no-ACK quarantine.

`node scripts/test-database.mjs --arrival-grace-only` applies the migrations in an isolated database and checks only the latest timing contract: future availability, T−10 activation, T+10 unused cutoff, Scheduled extension/idempotency, late-scan refusal, matched entry surviving both deadline workers, and subsequent sensor-driven departure. This focused run passed; unrelated broad suites were not repeated for the timing change.

`node scripts/test-database.mjs --barrier-test-only` passed the focused zero-power contract: `BARRIER_TEST` requires exactly zero, real types reject zero/negative ratings, historical disabled `UNKNOWN` survives, and disabled controls/interlocks cannot reserve or claim an operation. A separately enabled fictional fixture exercises the unchanged protection/matching/sensor/cleanup ledger. It sends no provider request and does not validate the real interlocks.

These passed against PostgreSQL 17 in a container with no network, published port or persistent volume; the harness removes its own container. They do not establish hosted Auth configuration, JWT issuance, PostgREST exposure, two-phone behavior, production load characteristics or a real hardware cycle. See [build evidence](BUILD-LOG.md).

The current deployed-service gaps are explicit:

- All eleven hosted versions/checksums are verified. The barrier is registered; mentor confirmations and exclusive ownership were supplied by the user. Direct bench movement/access checks and one guarded idle-worker release are observed. The current database gate is disabled with `TELEMETRY_UNKNOWN`; fresh-report polling timed out and reactivation was rejected. A complete customer booking/plate/occupied/departure cycle and cross-phone use remain unverified.
- Anonymous identity is device/session based. Losing an unlinked identity can lose owner cancellation access. Email identity upgrade/sign-in are implemented, but email delivery and cross-device use remain unverified and forgotten-password recovery is not implemented.
- Cancelled and expired rows retain request history with no automated retention policy. Auth deletion cascades software history, but referenced physical booking/operation history is protected by restrictive foreign keys and needs deliberate archival/recovery policy.
- Inventory/connector deletion is restricted where booking history references it. Disabled demo bays disappear from the registered list RPC; physical guards remain visible through their dedicated workflow list, including overdue/disabled enrolled bays.
- There is no per-user active-hold quota, anonymous-account abuse control, catalog authenticity check or operator booking permission model for directory slots. Valid-looking caller-supplied station/slot references can create software holds without proving a real plug exists.
- Directory edits can orphan virtual choices. Owned holds are recoverable, but no physical connector reconciliation or external operator booking synchronization exists.
- No payments, no-show penalties, charging metering, physical reservation guarantee, OCPI/OCPP compliance or GDPR compliance is established by this schema.

## Owner data access and erasure intake

Migration ten adds `privacy_erasure_requests`: one private pending-review row per Auth owner, UUID reference and original request/update timestamps. RLS is enabled and direct phone grants are revoked. The private `_privacy_request_json(uuid)` helper is unavailable even to service-role callers; owner-facing security-definer RPCs invoke it internally with `auth.uid()` and an empty search path.

`export_my_bayready_data()` uses explicit owner-filtered projections across directory/bay/hardware reservations and extension ledgers. It excludes private plate hashes, camera event keys, worker credentials and images. The local profile and Auth email are separate export sources; provider data and fuller access requests require operator handling. Very large histories need future pagination; this convenience export is not complete access-request fulfillment.

`request_my_data_erasure()` is idempotent and `get_my_privacy_request()` reads the caller's request or null. Intake does not erase data, change Auth, cancel a booking or alter a physical guard. The pending request must be handled by Ecurious under an approved retention/rights process. Automatic retention, terminal plate-link removal and complete erasure fulfillment remain unimplemented; see [PRIVACY.md](PRIVACY.md).
