# Ecurious parking-lock API

The challenge service exposes real parking-barrier telemetry and commands. Authenticated read access now works through the backend and the mobile Activity screen. During discovery on 24 October 2026, the assigned lock first reported offline and later reported raised with vacant occupancy. No physical commands were sent, and a full hardware reservation cycle remains untested.

Source: the service's own [REST and real-time reference](https://parking-lock-service-production.up.railway.app/), including its participant dashboard JavaScript. The endpoint and payload descriptions below are documented contracts; the observation table records the narrower behavior actually seen. No physical commands were sent during discovery.

## Connection and scope

Base URL:

```text
https://parking-lock-service-production.up.railway.app
```

The reference accepts either an `X-API-Key` header or an `apiKey` query parameter. Keep the key in the backend's `ECURIOUS_API_KEY` environment variable and use header authentication for backend requests. Do not put it in `EXPO_PUBLIC_*`, URLs, app source, tracked files, or logs. The service scopes access to locks assigned to the caller's team.

The diagnostic integration is a separate, read-only view of assigned locks and status through `GET /api/hardware`. The mobile Activity screen fetches this view; simulator bookings and controls remain explicitly labelled as simulated. The adapter also provides narrowly named barrier movement and single-plate access methods, plus private plate/policy comparison reads, for an authorised orchestration service. These methods are not booking operations, do not establish physical success, and their writes were tested with mocked requests only. The user-supplied host name contains `production`; only the challenge-assigned test hardware is in scope.

To fetch a redacted status report from the laptop:

```sh
npm run hardware:inspect
```

The command loads the backend `.env` without printing its contents. Backend requests use a six-second timeout, a 1 MiB response cap, and redirect rejection. The Expo launcher excludes `ECURIOUS_API_KEY` from its child environment. Diagnostic output contains selected fields, whitelist mode/count, and plate-observation metadata; raw plates, camera captures, upstream bodies, and credential echoes are excluded.

The adapter preserves `status` and `lastReportedPresence` as last-reported values. `faultsKnown` distinguishes an explicit fault array from missing/malformed fault telemetry; the control worker also requires a known false water-ingress flag. It derives `barrier`, `occupancy`, and `telemetryFresh` using a **60-second local display policy**: missing/future/stale timestamps and offline/unknown status produce unknown current state. This interval is not an Ecurious guarantee or permission to move hardware. A successful fetch does not reset the provider observation's age.

## Observed during initial discovery

Times below are UTC on 24 October 2026; Berlin was UTC+02:00.

| Observation | Actual result | What this establishes |
| --- | --- | --- |
| Public route discovery | `GET /` returned HTTP 200; `/docs` and `/openapi.json` returned HTTP 404 | The usable reference was inline in the root HTML and dashboard script; no OpenAPI document was obtained. |
| `GET /health` at `08:57:38.462Z` (`10:57:38` Berlin) | `status: "ok"`, `registeredLocks: 1`, `connectedSockets: 0` | The HTTP service responded and knew one lock; no hardware socket was connected at this snapshot. |
| Assigned team and lock | Team `E-Indifferent`, lock `lock-0001` | Authentication and assignment worked for the supplied credential. |
| Hardware connectivity | Assigned lock reported offline | Live physical control was not available at this observation. |
| Last hardware observation | `lastSeenAt: 2026-10-24T08:40:54.596Z` | Sensor data was about 17 minutes old at the health snapshot. |
| Retained occupancy | `vacant` | This was a stored observation, not proof of current vacancy. |
| Retained error | `MOTOR_LOWERING_STALL` | The provider reported a lowering fault; its cause and recovery were not verified. |
| Existing whitelist | `*` | Wildcard access was already configured; discovery did not change it. |
| Hardware events | No hardware events observed during initial discovery | The live event names, delivery timing, and physical transitions remain unverified. |

Follow-up bounded reads initially still reported offline:

| Follow-up operation | Actual result | What this establishes |
| --- | --- | --- |
| `GET /api/v1/locks/lock-0001` | HTTP 200; still offline; retained occupancy `vacant`; `activeErrors: []`; `lastSeenAt: 2026-10-24T09:01:00.380Z`; whitelist represented as `any-plate` | The timestamp and error list changed, but offline status persisted. An empty error list does not prove the motor fault was repaired. |
| `GET /api/v1/locks/lock-0001/plate/latest` | HTTP 200; recognition present with timestamp `2026-10-24T07:52:28.502Z` | A historical recognition is retrievable; it does not establish a current arrival. No raw plate was printed or retained in this guide. |
| Five-second SSE observation | HTTP 200, `text/event-stream`, 86 bytes; one `connected` event with payload keys `status` and `timestamp` | The service accepted an event-stream connection. No barrier, occupancy, recognition, or alarm event was observed. |

The HTTP service can answer successfully while hardware is offline. Always keep local request time, provider observation time, and connectivity separate. Do not replace an old `lastSeenAt` with the time a successful HTTP response was received. The follow-up demonstrates that `lastSeenAt` alone is insufficient evidence of a live hardware connection.

Later reads reported raised status, superseding the earlier offline snapshot:

| Later operation | Actual result | What this establishes |
| --- | --- | --- |
| Credential rotation | A brief HTTP 401 occurred while the user rotated the key; the updated backend key subsequently authenticated | Credential rejection was surfaced without exposing provider bodies or secrets. |
| CLI `GET /api/v1/locks` fetched at `09:07:36.284Z` | Team `E-Indifferent`; camera-equipped `lock-0001`; status `raised`; presence `vacant`; `lastSeenAt: 2026-10-24T09:07:01.635Z`; `activeErrors: []`; wildcard `*`; `latestPhoto: null` | Read access worked and the reported sample was about 35 seconds old. The local policy allowed its displayed raised/vacant values at that moment; no movement was initiated or directly observed. |
| Local `GET /api/hardware` fetched at `09:08:10.494Z` | HTTP 200 from the real upstream; same `lastSeenAt`; reported status remained `raised`, but derived `barrier` and `occupancy` were `unknown` | The sample had aged to about 69 seconds, exceeding the display policy. End-to-end projection preserved stale state and passed privacy assertions. Simulator mode and booking behavior remained unchanged. |

The empty error list and later raised report do not establish how the earlier motor stall was resolved. Obtain current observations and mentor guidance before any physical operation.

At this integration checkpoint, 45 Node tests passed, including 24 adapter tests/subtests; JavaScript syntax and mobile TypeScript checks passed. Android bundle export also succeeded before subsequent custom-map work began. The adapter tests use fictional fixtures and mocked fetches. They cover header authentication, privacy projection, stale/unknown state, schema and ID validation, sanitized failures, timeout/size limits, missing configuration, and refused writes. These checks do not prove a physical hardware cycle or on-phone rendering.

### Plate-lifecycle contract recheck

The public root reference was fetched again, followed by bounded authenticated GETs on 24 October 2026. No whitelist or movement POST was sent. The current list fetched at `11:27:36.084Z` returned three assigned camera-equipped locks:

| Lock | Reported barrier / occupancy | Last seen | Reported access and recognition |
| --- | --- | --- | --- |
| `lock-0001` | `raised` / `vacant` | `11:26:49.207Z` | Wildcard access; latest recognition `09:58:00.896Z`, a historical observation. |
| `lock-0002` | `raised` / `vacant` | `11:26:24.220Z` | Wildcard access; latest-recognition endpoint returned 404. |
| `lock-0003` | `raised` / `vacant` | `11:26:29.240Z` | Wildcard access; latest-recognition endpoint returned 404. |

Every record used **`carPresence: "vacant"` as a string**. There was no `carPresent` boolean field. The follow-up numeric fields were `deviceStatusRaw: 1` and `carPresenceRaw: 2`; these examples are not a complete numeric enum. Do not coerce the string to a boolean: both `"vacant"` and `"occupied"` are truthy JavaScript strings. The adapter accepts the documented occupancy strings and preserves unfamiliar/boolean/raw-only observations as unknown.

All three error lists were present and empty at that snapshot; `faultsKnown` distinguishes an explicitly supplied empty list from missing/malformed fault telemetry. These device observations were already older than the workflow's default five-second preflight policy; an HTTP 200 alone does not make them current.

A five-second SSE observation at `11:28:30.130Z` used header authentication and returned HTTP 200 with 86 bytes: only `connected`, containing `status` and `timestamp`. No plate, occupancy, movement or alarm event was observed. The reference/dashboard event-name discrepancy remains unresolved. No raw plate, image, credential, or upstream response body was printed or saved by these probes.

### Built-in OCR and whitelist recheck — 24 October 2026, 13:27 UTC

The service's public reference and bounded authenticated list/latest-recognition GETs were checked again at `2026-10-24T13:27:55.944Z`. The root reference and assigned-lock list returned HTTP 200. This list contained **two** assigned locks, `lock-0002` and `lock-0003`; `lock-0001` was absent. Current assignment must be checked before using an older mapping or allowlist.

| Assigned lock | Last reported state and provider sample time | Latest OCR read |
| --- | --- | --- |
| `lock-0002` | `lowered` / string `vacant`; `lastSeenAt: 13:26:33.367Z`; wildcard access; empty error list | HTTP 200; keys exactly `lockId`, `timestamp`, `licensePlate`, `plateType`; matching lock ID and a nonempty plate string; timestamp `12:25:28.267Z`, about 62 minutes old. No confidence or event-ID field. |
| `lock-0003` | `lowered` / string `vacant`; `lastSeenAt: 13:27:37.159Z`; wildcard access; empty error list | HTTP 404: no latest recognition was available. |

These are reported snapshots. The first lock's telemetry was older than the 60-second diagnostic rule; both samples were older than the default five-second movement preflight rule. Wildcard access also fails the current protection preflight. The historical OCR and the 404 do not establish arrival, vacancy, departure or a no-show. No raw plate or camera capture was printed or retained by these reads, and no policy/movement POST was sent.

The current reference explicitly describes `GET /api/v1/locks/:id/plate/latest` as the most recent result from the **onboard OCR camera**. Its documented response is `{lockId, timestamp, licensePlate, plateType}`. Neither the reference nor the observed successful response supplies a confidence score; the application must not invent one. The existing private `getPlateMatch` adapter can consume this first-party result without a YOLO model, enforcing the lock ID, timestamp boundary and private plate comparison before durable entry authorization. A result must be newer than the relevant booking/protection observation, within the accepted freshness/deadline policy, and durably deduplicated. Accepted recognition still differs from sensor-confirmed parking.

The whitelist POST has a different physical effect. `POST /api/v1/locks/:id/whitelist` programs up to ten entries into the camera's EEPROM; a matching approach automatically lowers the arm. The documented bodies are `{ "plates": ["[FICTIONAL-PLATE]"] }`, `{ "wildcard": true }`, and `{ "plates": [] }` to disable auto-unlock. The response example has `success`, `message` and an echoed `whitelist`. It is configuration acknowledgement, not an injected OCR event, EEPROM readback proof, or confirmed barrier position. Persistent rules still have no documented booking TTL or per-plate expiry.

No OCR-injection or test/simulation endpoint was documented in the current REST/MCP reference or participant dashboard. This does not establish that an undocumented organiser tool cannot exist. A mocked whitelist response can test application parsing; a real whitelist request changes physical access and requires the reviewed policy lifecycle. The current guarded movement path expects automatic plate access disabled. Using onboard OCR with that path first needs confirmation that recognition continues while auto-unlock is disabled. Choosing hardware whitelist auto-entry instead requires durable policy-write acknowledgement/uncertainty handling, fresh entry observations, expiry/cleanup and protection against old rules remaining effective; simply sending a whitelist POST would bypass those assumptions. Both physical paths still need a supervised full-cycle test on the assigned hardware.

## Later read-only assignment checkpoint

At `2026-10-24T10:54:04.599Z`, the redacted CLI list read returned team `E-Indifferent` with three assigned locks. This supersedes the initial one-lock assignment snapshot; it is not evidence of current physical mapping or an authorized movement test.

| Lock | Report at this checkpoint | Provider timestamp |
| --- | --- | --- |
| `lock-0001` | Offline; derived barrier/occupancy unknown; retained vacant report | `2026-10-24T10:29:56.817Z` |
| `lock-0002` | Raised/vacant, fresh under the 60-second diagnostic display rule | `2026-10-24T10:53:57.139Z` |
| `lock-0003` | Reported raised/vacant but stale; derived current state unknown | `2026-10-24T10:51:25.111Z` |

All three reported camera capability, no listed active errors and wildcard access. Recognition metadata was historical or absent; no raw plate or image was printed. The worker's default five-second policy is stricter than the diagnostic display window. Wildcard access fails protection preflight, and no lock was automatically enrolled or commanded.

The guarded application integration is now described in [HARDWARE-SETUP.md](HARDWARE-SETUP.md), [API.md](API.md) and [BAY-LIFECYCLE.md](BAY-LIFECYCLE.md). Its database/backend/mobile code is implemented locally; hosted activation, actual movement, plate correlation and the full live cycle remain unverified.

## Documented read endpoints

| Method and path | Documented response | Notes |
| --- | --- | --- |
| `GET /api/v1/locks` | `{ "team": "...", "locks": [...] }` | Lists the caller's assigned bays. The dashboard also tolerates an `assignedLocks` array. |
| `GET /api/v1/locks/:id` | `{ "lock": { ... } }` | Detailed state and telemetry for an assigned bay. |
| `GET /api/v1/locks/:id/plate/latest` | `{ "lockId": "...", "timestamp": "...", "licensePlate": "[REDACTED]", "plateType": "standard" }` | The latest recognition may predate the current booking. Do not expose or retain the raw plate in the read-only dashboard. |
| `GET /events` or `GET /api/v1/events` | Server-Sent Events stream | Events are documented as filtered to the caller's assigned bays. |

Documented lock fields include:

| Field | Meaning or documented values |
| --- | --- |
| `id`, `name`, `serialHex` | Lock identity and hardware serial |
| `hasCamera` | Whether the lock has the recognition camera |
| `status` | `raised` or `lowered`; barrier position, not booking status |
| `carPresence` | String `vacant` or `occupied`; no `carPresent` boolean observed. Keep missing or unfamiliar values unknown. |
| `battery12V`, `battery3_7V` | Device battery readings |
| `signalStrength4G` | Cellular signal telemetry; scale is not defined in the reference |
| `waterIngress`, `activeErrors` | Hardware fault information |
| `lastSeenAt` | Provider's last-seen timestamp; do not interpret an old observation as current state |

The dashboard also reads `whitelist` and `latestPhoto.licensePlate` from lock objects. These may carry personal data even on a general list/status request: select permitted output fields rather than forwarding the upstream object wholesale. Never log upstream response bodies, plate lists, camera captures, or arbitrary provider errors.

`GET /api/v1/locks/:id/whitelist` appears in an HTML comment, but has no rendered request/response specification. Its behavior is not verified; do not rely on it as an established endpoint.

## Documented provider commands

| Method and path | Body | Documented physical meaning |
| --- | --- | --- |
| `POST /api/v1/locks/:id/unlock` | Optional `{ "cancelAutoLift": false }` | Lower the barrier to permit entry or exit. |
| `POST /api/v1/locks/:id/lock` | Optional `{ "cancelAutoLift": false }` | Raise the barrier to prevent parking. The reference describes this as reserving/protecting the bay, but it is not a booking resource. |
| `POST /api/v1/locks/:id/keep-state` | `{ "state": "normal" }`, `"keep_open"`, or `"keep_closed"` | Select standard timeout behavior or permanent open/closed mode. |
| `POST /api/v1/locks/:id/whitelist` | `{ "plates": ["[FICTIONAL-PLATE]"] }` | Program allowed plates for hardware-triggered automatic lowering. |

`cancelAutoLift: true` is described as disabling the automatic relift timeout. The reference does not specify the timeout duration or the full interaction between commands, occupancy, and keep-state modes. The participant dashboard sends `cancelAutoLift: true` for its Lock button and an empty object for Unlock. That dashboard choice is not evidence that it is appropriate for our reservation flow.

Command response examples contain `success`, `message`, and `result`. Messages say the command was sent and the barrier is raising or lowering. Treat these as acknowledgements. Keep the UI at **command requested / awaiting observation** until a fresh, authenticated hardware observation confirms the target state.

The unlock example maps numeric `deviceStatus: 2` to lowered and `carPresence: 2` to vacant; the lock example maps `deviceStatus: 1` to raised. These examples do not define a complete numeric enum. Preserve unknown values rather than inferring a physical state.

### Implemented adapter movement boundary

The public service reference was fetched again during the integration work on 24 October 2026. Its lock/unlock payloads and acknowledgement examples remain as described above; occupancy interlocks, command idempotency, and charging control are still undocumented. Only the public reference was fetched for this update. No authenticated read was needed and **no physical command was sent**.

The backend adapter implements these explicit methods:

| Adapter method | Single provider request | Returned projection |
| --- | --- | --- |
| `raiseBarrier(lockId)` | `POST /api/v1/locks/:id/lock`, `{ "cancelAutoLift": false }` | Requested target `raised`; acknowledgement only. |
| `lowerBarrier(lockId)` | `POST /api/v1/locks/:id/unlock`, `{ "cancelAutoLift": false }` | Requested target `lowered`; acknowledgement only. |

Both require a valid assigned-lock ID shape and a configured backend credential. They use header authentication, a six-second timeout, the 1 MiB streamed response bound, and redirect rejection. They send one POST, with no automatic retry or extra motion/status request. They deliberately do not expose arbitrary provider paths, `cancelAutoLift` options or keep-state modes. Separate narrow plate-access methods are described below; arbitrary lists and wildcard writes remain unavailable. The ambiguous `reserve()` and `release()` adapter methods still refuse: application reservation/cancellation semantics require a separate verified workflow.

The provider must return boolean `success: true` both at the top level and in `result`. A usable acknowledgement returns exactly:

```json
{
  "lockId": "lock-demo-1",
  "requestedBarrier": "raised",
  "acknowledged": true,
  "confirmed": false,
  "requestedAt": "2026-10-24T10:00:00.000Z"
}
```

This example uses a fictional lock and time. `requestedAt` is captured before dispatch; it is not a sensor timestamp. Numeric device status, provider messages, serials, raw plates and result bodies are omitted. An acknowledged target must remain pending until a separate, fresh authenticated observation confirms it. The adapter does not perform that confirmation itself.

Missing/negative/malformed acknowledgements, response-size violations, non-auth HTTP errors and network failures throw `EcuriousApiError` with code `ECURIOUS_COMMAND_UNCERTAIN`, `uncertain: true`, and a fixed message requiring status reconciliation. A command timeout returns status `504` and explicitly says movement may already have been accepted; other uncertain outcomes use `502`. A failed command never reuses the read-only timeout wording that no hardware command was sent. HTTP `401`/`403` retain `ECURIOUS_AUTH`; `404` retains `ECURIOUS_NOT_FOUND`; configuration and invalid-ID failures occur before dispatch. No failure or acknowledgement confirms a safe physical position.

The calling service must establish caller authorisation, designated inventory/lock mapping, fresh trusted occupancy, fault/interlock policy, command serialization, durable operation identity, and recovery before invoking these methods. Reconcile uncertain outcomes before further movement. An application lock cannot prevent an external operator, automatic relift, or camera whitelist from moving the barrier; those remain part of the hardware contract to verify.

Focused verification at this boundary passed 38 adapter tests/subtests and a JavaScript syntax check. New mocked cases cover exact command paths/bodies/authentication, ignored numeric-state claims, redacted acknowledgements, validation before dispatch, one-attempt failures, malformed/oversized responses, and timeout uncertainty. They do not establish real movement, occupancy interlocks, charging, or a complete reservation cycle.

### Whitelist rules persist in hardware

The reference says the camera EEPROM accepts up to ten specific plate entries. A recognised matching vehicle automatically lowers the barrier without a separate application command.

- `{ "plates": [...] }` installs specific allowed plates.
- `{ "wildcard": true }` permits any recognised plate to trigger lowering.
- `{ "plates": [] }` disables automatic plate-triggered lowering.
- The dashboard represents wildcard access as `*` or a wildcard-labelled value.

Writing a whitelist changes future physical access. It is not a read-only recognition check or a booking with an automatic expiry. No per-plate deadline, server-side expiry, deduplication rule, stable event ID, or atomic whitelist-and-barrier command is documented. Matching is described as automatic in hardware; that does not establish the timing, freshness, or uniqueness of a later server recognition event. Confirm overwrite behavior, accepted plate formats, retention, rollback and timeout cleanup with mentors before the physical demo. Existing wildcard configuration was left unchanged by exploration.

### Narrow plate access methods

| Adapter method | Single provider request | Redacted acknowledgement |
| --- | --- | --- |
| `setPlateAccess(lockId, normalizedPlate)` | `POST /api/v1/locks/:id/whitelist`, `{ "plates": ["[FICTIONAL-PLATE]"] }` | `{lockId, requestedAccess:"specific-plates", acknowledged:true, confirmed:false, requestedAt}`. |
| `clearPlateAccess(lockId)` | Same endpoint, `{ "plates": [] }` | Same projection with `requestedAccess:"disabled"`. |

The setter accepts one already-normalized NFKC uppercase string of 2–15 Unicode letters/digits, with no spaces, hyphens, wildcard or arbitrary extra entries. The orchestration service normalizes and fingerprints driver input before calling it. This bounded application format is not evidence that every country/character is supported by the camera.

The provider response must contain `success: true` and an exactly matching `whitelist` echo. Even then, `confirmed` stays false: an echoed configuration is not independent proof of EEPROM programming or actual recognition behavior. The request body, echoed plates and provider messages are not returned or logged. Both methods inherit the single-attempt timeout/size/authentication/error rules above. A timeout while clearing leaves future access **unknown**, not disabled; an unresolved policy write must keep the bay quarantined rather than being blindly repeated or offered to another driver.

### Private plate and access-policy comparisons

These backend methods expose no raw plate or whitelist entries. Neither is a public HTTP route:

| Method | Input | Output |
| --- | --- | --- |
| `getPlateMatch(lockId, {expectedFingerprint, comparePlate, notBefore})` | Lowercase 64-hex fingerprint, private comparator closure, and a required timestamp boundary. Fetches `GET /api/v1/locks/:id/plate/latest`. | `{lockId, timestamp, matched}`; timestamp may be null when no event exists. |
| `getPlateAccessMatch(lockId, {expectedFingerprint, comparePlate})` | Same private fingerprint/comparator. Fetches `GET /api/v1/locks/:id`. | `{lockId, accessMode, matched, observedAt}`; `observedAt` is the provider's nullable `lastSeenAt`. |

`comparePlate(rawObservation, expectedFingerprint)` is trusted backend code holding the secret needed for HMAC/timing-safe comparison; the adapter requires a boolean result and sanitizes callback exceptions. The expected fingerprint and secret never leave this private comparison boundary in responses. The application must not use an unkeyed public hash as a substitute for its secret comparison policy.

Recognition must have the requested `lockId`, a valid timestamp **strictly newer** than `notBefore`, and no future timestamp relative to the backend clock before the comparator can run. Set the boundary from the booking and relevant plate/protection operation; record consumed observations durably so one old event cannot satisfy another reservation. A matching historical `latestPhoto` alone is never used. A 404 recognition read becomes `{timestamp:null, matched:false}` for the private method only; it cannot establish vacancy, departure, or a no-show. Wrong-lock or malformed responses remain errors. The existing public `getLatestPlate()` still returns only detection presence/time and retains its 404 error behavior.

Policy matching is true only for **exactly one** allowed plate that matches the expected fingerprint. Wildcard, multiple entries, disabled and malformed/unknown lists cannot verify that exclusive policy. `observedAt` is the device last-seen field, not a dedicated EEPROM-write timestamp. The caller must separately require valid current telemetry, observation ordering and persisted command acknowledgement; a policy comparison by itself is not a movement permit or proof of hardware programming.

The intended orchestration is specific plate policy → verified protection/raise → a new matching recognition and observed automatic lowering → observed occupancy → observed departure → remove plate access and verify barrier down before freeing the app resource. If expiry happens before arrival, remove access and safely restore the agreed idle-open state. Occupied or uncertain bays remain held for recovery. No-show timing and deduplication belong to the application database because the provider exposes neither booking expiry nor event replay guarantees. Real charging still needs separate agreed evidence.

## SSE contracts disagree with dashboard code

The public reference and its participant dashboard use different event names:

| Event purpose | Reference name | Dashboard listener |
| --- | --- | --- |
| Barrier movement | `status_change` | `lock:status_change` |
| Vehicle presence | `vehicle_presence` | `lock:car_presence` |
| Plate recognised | `photo_captured` | `lock:photo_captured` |
| Alarm | `alarm` | No listener in the participant dashboard |

Reference payloads contain `type`, `lockId`, and `timestamp`, plus:

- `status` for barrier state;
- `presence` for vehicle occupancy;
- `licensePlate` for recognition;
- `error` for an alarm, such as water ingress.

Only a service-level `connected` event has been observed; no hardware events have been observed to resolve the naming mismatch. An implementation may support both name families, but must verify real delivery before claiming hardware updates work. The docs do not establish confidence values, event IDs, ordering, replay, heartbeat meaning, or reconnection guarantees. Reconcile status after a disconnect/reconnect and avoid interpreting silence as vacancy, departure, or lack of an arriving vehicle. Filter events to the selected assigned lock and keep raw recognition data out of general activity logs.

## Resources this API does not document

The reference supplies barrier control, vehicle presence, device telemetry, and plate recognition. It does not document:

- booking ownership, reservation IDs, atomic allocation, arrival deadlines, or no-show expiry;
- charging-session control, plugged-in state, energy delivery, meter readings, or payments;
- mapping between a GoingElectric station/connector and the assigned lock;
- occupancy interlocks, safe-motion guarantees, a freshness threshold, command idempotency, or recovery from uncertain command outcomes.

These are contract gaps, not proof that every capability is absent from the wider system. Confirm them with Ecurious mentors. Booking rules remain application-owned unless another authoritative service is supplied. A lowered arm, occupied bay, or recognised plate cannot prove that EV charging started.

## Prerequisites for the first real full cycle

1. Recheck the user-selected `lock-0002` and current assignment. The earlier `lock-0001` fault snapshots are historical; that device was absent from the latest assignment. The user has confirmed the mentor's interlock/auto-relift checks for the barrier-only test. Record a supervised command cycle separately and confirm which fresh telemetry establishes movement/connectivity.
2. Identify the exact assigned test bay, physical layout, sensor behavior, and any accepted GoingElectric/charger mapping. Do not operate unrelated infrastructure.
3. Confirm occupancy interlocks and safe lock/unlock sequencing, including relift and keep-state behavior. Unknown or stale occupancy must not enable a movement based on a claimed empty bay.
4. Establish how a booking installs and removes a specific plate rule, how expiry/cancellation restores the agreed configuration, and which actual recognition event proves arrival. Verify the SSE name mismatch with real observations.
5. Wire the narrow backend movement methods through an authorised reservation service with explicit requested/confirmed/failed/unknown outcomes. Following a timeout, reconcile status before retrying; confirm any supported provider idempotency mechanism rather than assuming one.
6. Agree what constitutes real charging evidence. This lock API alone cannot supply it.
7. Record reserve/protect → recognised arrival → accepted charging evidence → departure/release using fresh hardware observations in `BUILD-LOG.md`. Keep simulator steps labelled, and retain no raw plates, credentials, or camera captures in tracked evidence.

Until these prerequisites are met, successful list/status requests are evidence of authenticated read access only. They are not a completed hardware integration or a live reservation cycle.
