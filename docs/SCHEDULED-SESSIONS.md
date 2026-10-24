# Scheduled bays, accounts and session details

This describes the implemented scheduled hardware path, added on 24 October 2026. Hosted deployment evidence belongs in [BUILD-LOG.md](BUILD-LOG.md) and [SUPABASE.md](SUPABASE.md). The feature requires an explicitly enrolled, operator-confirmed physical bay. GoingElectric app slots remain software reservations and never inherit hardware control.

## Driver journey

1. Browse the map with the saved connector preference. A location contains physical bays; each bay has one or more individually selectable connectors. Selecting one connector allocates its entire one-car bay.
2. Open **Hardware** for an enrolled Ecurious bay, select a compatible connector and a UTC-backed time window. Windows last 5–120 minutes and start within seven days. The form displays Europe/Berlin times and explicit offsets; when a clock time occurs twice at the daylight-saving transition, the driver chooses the occurrence.
3. Review the server's maximum **mock** empty-bay fee, masked vehicle and mock payment preference. Only final confirmation sends the plate to the private backend. Future reservations do not raise the barrier early.
4. At the booked start, the running worker attempts protection only with fresh, vacant, fault-free observations and confirmed interlocks. If another car is present, the bay is blocked and fees are waived. A database booking does not establish physical protection.
5. After confirmed protection, a new camera observation must match the booked plate. The backend verifies it privately and atomically queues entry. Acknowledgement and physical lowering are separate facts. A later fresh occupied report after authorized entry records arrival.
6. **View session** shows the selected connector and rating, booking times, masked vehicle, arrival/departure times, elapsed time and available barrier/occupancy facts. Hardware energy and live charging power remain unavailable: the lock API has no charger telemetry. An independent simulator session is explicitly labelled simulated.
7. A newer vacant observation after confirmed arrival records departure and queues cleanup. The bay becomes reusable only after the guarded cleanup confirms lowered and vacant. Cancellation, expiry and a failed request never bypass that guard.

The worker polls every five seconds; network and motor latency add delay. Scheduling means **no earlier than the booked start**, followed by verified completion. It does not guarantee movement at an exact millisecond. The laptop backend must remain running and reachable; production hosting/scheduling is still future work.

```mermaid
sequenceDiagram
  participant App as Expo app
  participant API as Private Node backend
  participant DB as Supabase
  participant Lock as Ecurious lock/camera
  App->>API: Book bay + connector + UTC window + plate
  API->>DB: Guest JWT; window + keyed plate fingerprint + mask
  DB-->>App: Scheduled booking, no physical claim
  Note over API,DB: Worker uses database time at or after start
  API->>Lock: Read assigned device and sensor facts
  API->>DB: Reconcile; claim and commit one dispatch permit
  API->>Lock: One guarded raise request
  Lock-->>API: Acknowledgement, then newer sensor observation
  API->>DB: Confirm protection
  API->>Lock: Read latest recognition privately
  API->>DB: Fresh matching fingerprint authorizes entry once
  API->>Lock: One guarded lower request
  Lock-->>API: Newer lowered + occupied observation
  API->>DB: Record arrival; stop mock empty-bay fee
  App->>API: Poll session details
  Lock-->>API: Strictly newer vacant observation
  API->>DB: Departure + guarded cleanup intent
  Note over API,DB: Release allocation only after confirmed cleanup
```

## Scheduling and race conditions

Migration five adds `hardware_slot_bookings`, separate from `directory_plug_reservations` and the active physical `booking_reservations`. A PostgreSQL exclusion constraint rejects overlapping half-open intervals `[starts_at, ends_at)` for the same bay, including choices of different connectors. Adjacent intervals are allowed in the calendar, but the next physical activation still waits for the preceding bay's safe cleanup.

Idempotency binds owner/request UUID to the bay, connector, exact window and fingerprint. A retry with changed details fails. The legacy immediate/manual prototype mirrors its physical interval into this schedule, so it cannot bypass future-window exclusions. New mobile bookings use the plate-bound scheduled path; manual entry RPCs refuse those reservations.

Scheduled rows activate under bay/control locks, creating the active physical hold and durable protection operation atomically. A blocked or uncertain earlier operation survives its planned end and prevents another physical activation. The claim/dispatch ledger retains the existing no-retry and no-acknowledgement quarantine rules. See [BAY-LIFECYCLE.md](BAY-LIFECYCLE.md).

The idle worker observes enrolled bays even without a customer hold. Fresh occupied state marks an idle bay blocked. A newer vacant, healthy observation can restore an open idle bay or queue one checked lowering operation. Idle lowering has a nullable customer reservation ID; it uses the same durable movement ledger. No missing camera event establishes vacancy.

The actual provider field observed is `carPresence: 'vacant' | 'occupied'`; a `carPresent` boolean was absent. The adapter normalizes the documented string and preserves unknown values. Hardware camera auto-access must be disabled for this backend-driven matching flow. The backend does not install an indefinitely persistent customer whitelist; the private matching/read methods never return raw recognition text.

## No-shows and proposed pricing

The prototype gives an unused protected bay a **15-minute arrival window**, bounded by the booked end. After that, it requests safe cleanup; an occupied or uncertain bay stays guarded. This timer begins at actual protection confirmation, rather than charging the driver for a failed attempt to protect the bay.

The implemented quote is a product assumption: first ten protected, empty minutes free, then **€0.10 per started minute, capped at €3**. Matching arrival stops accrual. The server stops the estimate on cancellation/expiry and waives it for blocked or failed bookings. With a healthy 15-minute no-show deadline, the estimated no-show fee is at most €0.50. The quote remains an upper bound for the chosen window. All amounts are mock estimates; no card, payment authorization, transfer or invoice exists.

This is preferable to automatically charging because a GPS ETA exceeds ten minutes: ETA can change, does not prove that a bay was protected and is not currently connected to a routing service. A future production version needs a disclosed fee/waiver policy and a real payment provider before charging anything.

Public benchmarks informed the short hold and transparent cap; they do not establish a standard tariff for this app. Enel describes a 15-minute outlet reservation that ends when charging starts. VOOL supports operator-configured complimentary minutes and reservation pricing. EnBW's €0.10/minute fee after four connected hours, capped at €12, is an **idle/blocking** fee and is not a reservation tariff. Our ten-minute grace period and €3 cap are independent design assumptions. Sources checked on 24 October 2026: [Enel outlet reservations](https://www.enel.it/en-us/assistenza/mobilita-elettrica/ricarica-veicoli), [VOOL reservations](https://support.vool.com/en/articles/8228910-reservation), [EnBW blocking fee](https://www.enbw.com/service/faq/e-mobilitaet/blockiergebuehr/).

## Identity and plate data

Guest authentication creates a persistent Supabase UID; a public anon API key alone is not a user identity. **Profile → Sign in & account** supports email/password sign-in and upgrading the current guest with a verified email before setting a password. Guest conversion retains the UID and its bookings. Signing into an existing account changes the UID; cached booking screens reset, and the former guest's reservations are not silently reassigned. Email confirmation remains enabled. The email delivery/verification journey needs a device and a user-controlled mailbox to verify end to end.

The chosen account email goes directly to Supabase Authentication. Other local contact fields and the mock payment choice remain in native SecureStore. A scheduled hardware booking sends only the selected resource, window, request ID and plate to Node; Node normalizes it in request memory, stores a backend-keyed HMAC plus two-character mask in private SQL, and discards the raw value. OCR matching uses the same HMAC and constant-time comparison. Neither raw booking plates nor camera images are stored by this application or returned in session projections.

`BAYREADY_PLATE_HASH_KEY` is a stable backend-only base64 32-byte secret. Preserve it across restarts; changing it invalidates matching for existing reservations. Root launchers remove all `BAYREADY_*`, `SUPABASE_*` private settings and hardware secrets from the Expo child environment. A fingerprint remains pseudonymous data; this is not a compliance certification. Provider-side camera retention is outside this application's control.

## Backend contracts

| Route | Request | Result |
| --- | --- | --- |
| `GET /api/hardware/slots` | Guest/account bearer JWT; optional `bayId` | Own slots, or scoped public windows; policy; server time |
| `POST /api/hardware/quote` | `startsAt`, `endsAt` | Matching UTC window, duration, maximum mock fee and policy |
| `POST /api/hardware/slots` | JWT; `bayId`, `connectorId`, `startsAt`, `endsAt`, `requestId`, `licensePlate` | HTTP 202, refreshed own slot list |
| `POST /api/hardware/slots/cancel` | JWT; `slotId` | HTTP 202, refreshed own list; physical cleanup may still be pending |

Slot statuses are `scheduled`, `active`, `blocked`, `cancel_requested`, `cancelled`, `completed` and `expired`. Another owner's scoped calendar exposes the bay, connector, window and status, with no booking ID, plate, arrival/departure or cancellation capability. No hashes or server secrets appear in public projections. All responses use `Cache-Control: no-store`; unknown write outcomes require a read before a new request.

The private worker calls `reconcile_hardware_slots`, `list_hardware_slot_work`, `record_hardware_bay_observation` and `authorize_hardware_plate_entry`. These service-role-only RPCs carry fingerprints and observations; guest callers cannot execute them. The camera event must be fresh, strictly after protection and not previously authorized. Phones never select executable lock IDs or submit an authoritative plate-match event.

Local tests exercise exclusion and identity permissions, idempotency, due activation, no-show cleanup, camera entry/departure guards, mock pricing, native clients and Berlin DST ambiguity. They do not prove real movement, electrical charging or physical safety. Record supervised hardware evidence separately.
