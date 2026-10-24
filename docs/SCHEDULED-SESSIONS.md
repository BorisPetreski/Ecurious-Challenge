# Scheduled bays, accounts and session details

This describes the implemented scheduled hardware path, added on 24 October 2026. Hosted deployment evidence belongs in [BUILD-LOG.md](BUILD-LOG.md) and [SUPABASE.md](SUPABASE.md). The feature requires an explicitly enrolled, operator-confirmed physical bay. GoingElectric app slots remain software reservations and never inherit hardware control.

## Driver journey

1. Browse the map with the saved connector preference. A location contains physical bays; each bay has one or more individually selectable connectors. Selecting one connector allocates its entire one-car bay.
2. On the map, **Reserve** opens a compact Now/Schedule form for the selected public plug; **Bookings** separates active and upcoming app bookings. **Filters** contains map filters. Open **Hardware** for an enrolled Ecurious bay. Reserve now holds for ten minutes free; Add ten minutes costs €1 mock. Schedule uses a calendar/time picker, a €1 mock fee and an arrival within seven days. The form displays Europe/Berlin times and explicit offsets; when a clock time occurs twice at the daylight-saving transition, the driver chooses the occurrence.
3. Review the server's fixed **mock** reservation fee, masked vehicle and mock payment preference. Only final confirmation sends the plate to the private backend. Future reservations do not raise the barrier early.
4. For Now, protection is attempted immediately. For Book ahead, the running worker attempts protection ten minutes before arrival only with fresh, vacant, fault-free observations and confirmed interlocks. If the chosen space is occupied, the scheduler tries another compatible physical bay at the same location. If none can be confirmed free, the booking is cancelled, any mock fee is refunded, and the app suggests the closest confirmed alternative locations. A database booking does not establish physical protection.
5. After confirmed protection, a new trusted camera observation must match the booked plate. The backend verifies it privately and atomically queues entry. That accepted match stops the unused-hold timer. Acknowledgement and physical lowering are separate facts. A later fresh occupied report after authorized entry records arrival.
6. **View session** shows the selected connector and rating, booking times, masked vehicle, arrival/departure times, elapsed time and available barrier/occupancy facts. Hardware energy and live charging power remain unavailable: the lock API has no charger telemetry. An independent simulator session is explicitly labelled simulated.
7. A newer vacant observation after confirmed arrival records departure and queues cleanup. The bay becomes reusable only after the guarded cleanup confirms lowered and vacant. Cancellation, expiry and a failed request never bypass that guard.

The worker polls every five seconds; network and motor latency add delay. Scheduling means **no earlier than the protection start, ten minutes before scheduled arrival**, followed by verified completion. It does not guarantee movement at an exact millisecond. The laptop backend must remain running and reachable; production hosting/scheduling is still future work.

For a **15:00** arrival, the bay remains available for earlier non-overlapping bookings until **14:50**. Protection is attempted from 14:50; the unused-hold deadline is **15:10**, giving ten minutes of arrival grace. Each accepted extension moves that deadline ten minutes later. Without a matching plate, the deadline requests guarded lowering; the app only offers the bay again after confirmed vacant/lowered cleanup. A matching plate before the deadline keeps the allocation until sensor-confirmed departure and cleanup. Public directory slots use equivalent software intervals but have no physical sensor or barrier.

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
  API->>DB: Record arrival; record authorized arrival
  App->>API: Poll session details
  Lock-->>API: Strictly newer vacant observation
  API->>DB: Departure + guarded cleanup intent
  Note over API,DB: Release allocation only after confirmed cleanup
```

## Scheduling and race conditions

Migration five adds `hardware_slot_bookings`, separate from `directory_plug_reservations` and the active physical `booking_reservations`. Migration nine makes the unused-hold deadline explicit as `protection_deadline_at` / `protectionDeadlineAt`. A PostgreSQL exclusion constraint rejects overlapping half-open intervals `[protection_starts_at, protection_deadline_at)` for the same bay, including choices of different connectors. Adjacent intervals are allowed in the calendar, but the next physical activation still waits for the preceding bay's safe cleanup. Authorization exits both automatic unused-hold timeout paths; it does not invent an occupied sensor observation.

Idempotency binds owner/request UUID to the bay, connector, exact window and fingerprint. A retry with changed details fails. The legacy immediate/manual prototype mirrors its physical interval into this schedule, so it cannot bypass future-window exclusions. New mobile bookings use the plate-bound scheduled path; manual entry RPCs refuse those reservations.

Scheduled rows activate under bay/control locks, creating the active physical hold and durable protection operation atomically. A blocked or uncertain earlier operation survives its planned end and prevents another physical activation. The claim/dispatch ledger retains the existing no-retry and no-acknowledgement quarantine rules. See [BAY-LIFECYCLE.md](BAY-LIFECYCLE.md).

The idle worker observes enrolled bays even without a customer hold. Fresh occupied state marks an idle bay blocked. A newer vacant, healthy observation can restore an open idle bay or queue one checked lowering operation. Idle lowering has a nullable customer reservation ID; it uses the same durable movement ledger. No missing camera event establishes vacancy.

The actual provider field observed is `carPresence: 'vacant' | 'occupied'`; a `carPresent` boolean was absent. The adapter normalizes the documented string and preserves unknown values. Hardware camera auto-access must be disabled for this backend-driven matching flow. The backend does not install an indefinitely persistent customer whitelist; the private matching/read methods never return raw recognition text.

## Booking options, fallback and mock payments

| Option | Reservation | Mock price | Protection timing |
| --- | --- | --- | --- |
| Reserve now | Ten minutes from the database clock | Free | Attempt immediately, only with a confirmed empty bay |
| Add ten minutes | Extend an owned Now or scheduled unused hold by ten minutes | €1 for each accepted extension | Keep existing protection; reject after plate authorization or if the extra interval conflicts |
| Book ahead | Calendar/time picker; arrival within seven days | €1 per booking, a configurable prototype assumption | Attempt protection ten minutes before arrival |

All payments and refunds are explicit mock records. There is no per-minute fee, card authorization, transfer or payment processor. An extension records its request UUID so duplicate requests cannot add time or a fee twice. Another booking's protection lead-in is part of its exclusive interval, so an extension cannot consume it. New bookings use a ten-minute arrival window; paid additions can extend it to a maximum two-hour window. Scheduled protection additionally includes the ten-minute lead-in. This is an arrival hold, not a selected charging duration.

Before physical activation, an occupied chosen bay triggers a search of the same registered location for another enabled bay with the same connector type and at least the selected power rating. Each bay is one vehicle space: two connectors on the same occupied bay are both unavailable. Reassignment, the physical hold and its protection operation are committed together; original requested IDs remain available for idempotency and the driver's reassignment notice.

If no eligible bay is free, the unactivated booking is cancelled with `failureReason: LOCATION_FULL`. Paid bookings become `paymentStatus: mock_refunded`. The alternatives query returns up to three nearby registered locations with compatible bays, fresh vacant telemetry and a free matching interval, ordered by distance from the original location. Both sites need operator-supplied coordinates. Suggestions are advisory; selecting one still requires a new atomic booking. A directory listing alone never proves physical vacancy.

Unused Now holds expire ten minutes after creation; scheduled holds expire ten minutes after booked arrival, plus accepted extensions in either mode. A timely trusted match records `entryAuthorizedAt` and stops both unused-hold timers, even before the sensor reports arrival. A deadline requests cleanup; occupied or uncertain physical state keeps the guard. A late recognition cannot bypass the database deadline. An already dispatched or uncertain operation is never moved to a different bay by fallback: it needs guarded reconciliation/operator recovery first.

Public map plug reservations provide the same Now/extension/Book ahead choices as **software holds**. Their ten-minute lead-in blocks another BayReady booking of that opaque virtual slot; it does not operate public barriers or prove physical availability. Hardware fallback/refunds based on occupancy apply only to the enrolled Ecurious path.

## Identity and plate data

Guest authentication creates a persistent Supabase UID; a public anon API key alone is not a user identity. **Profile → Sign in & account** supports email/password sign-in and upgrading the current guest with a verified email before setting a password. Guest conversion retains the UID and its bookings. Signing into an existing account changes the UID; cached booking screens reset, and the former guest's reservations are not silently reassigned. Email confirmation remains enabled. The email delivery/verification journey needs a device and a user-controlled mailbox to verify end to end.

The chosen account email goes directly to Supabase Authentication. Other local contact fields and the mock payment choice remain in native SecureStore. A scheduled hardware booking sends only the selected resource, window, request ID and plate to Node; Node normalizes it in request memory, stores a backend-keyed HMAC plus two-character mask in private SQL, and discards the raw value. OCR matching uses the same HMAC and constant-time comparison. Neither raw booking plates nor camera images are stored by this application or returned in session projections.

`BAYREADY_PLATE_HASH_KEY` is a stable backend-only base64 32-byte secret. Preserve it across restarts; changing it invalidates matching for existing reservations. Root launchers remove all `BAYREADY_*`, `SUPABASE_*` private settings and hardware secrets from the Expo child environment. A fingerprint remains pseudonymous data; this is not a compliance certification. Provider-side camera retention is outside this application's control.

## Backend contracts

| Route | Request | Result |
| --- | --- | --- |
| `GET /api/hardware/slots` | Guest/account bearer JWT; optional `bayId` | Own slots, or scoped public windows; policy; server time |
| `POST /api/hardware/quote` | `startsAt`, `endsAt` | Matching UTC window, mode, duration, fixed mock fee, protection start and policy |
| `POST /api/hardware/slots` | JWT; `bayId`, `connectorId`, `startsAt`, `endsAt`, `requestId`, `licensePlate`, `bookingMode` | HTTP 202, refreshed own slot list |
| `POST /api/hardware/slots/extend` | JWT; `slotId`, `requestId` | HTTP 202; one ten-minute/€1 mock extension |
| `POST /api/hardware/slots/cancel` | JWT; `slotId` | HTTP 202, refreshed own list; physical cleanup may still be pending |
| `POST /api/integrations/plate-recognition` | Private recognition-service token; lock, event UUID, observation time, plate and confidence | HTTP 202; match/entry-intent result, never a direct movement confirmation |

Slot statuses are `scheduled`, `active`, `blocked`, `cancel_requested`, `cancelled`, `completed` and `expired`. Another owner's scoped calendar exposes the bay, connector, window and status, with no booking ID, plate, arrival/departure or cancellation capability. No hashes or server secrets appear in public projections. All responses use `Cache-Control: no-store`; unknown write outcomes require a read before a new request.

The private worker calls `reconcile_hardware_slots`, `list_hardware_slot_work`, `record_hardware_bay_observation` and `authorize_hardware_plate_entry`. These service-role-only RPCs carry fingerprints and observations; guest callers cannot execute them. The primary recognition source is Ecurious's native `GET /api/v1/locks/:id/plate/latest`; no separate model is required. The camera event must be fresh, strictly after protection and not previously authorized. Phones never select executable lock IDs or submit an authoritative plate-match event. An optional external service can use the [private event handoff](API.md#private-recognition-service-handoff). Whitelist programming is a separate automatic-access mode, not OCR injection; see [plate integration](MODEL-INTEGRATION.md).

Local tests exercise exclusion and identity permissions, idempotency, due activation, no-show cleanup, camera entry/departure guards, fixed mock fees/extensions, fallback/refunds, native clients and Berlin DST ambiguity. They do not prove real movement, electrical charging or physical safety. Record supervised hardware evidence separately.
