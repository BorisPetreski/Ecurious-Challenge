# Ecurious parking-lock API

The challenge service exposes real parking-barrier telemetry and commands. Authenticated read access now works through the backend and the mobile Activity screen. During discovery on 24 October 2026, the assigned lock first reported offline and later reported raised with vacant occupancy. No physical commands were sent, and a full hardware reservation cycle remains untested.

Source: the service's own [REST and real-time reference](https://parking-lock-service-production.up.railway.app/), including its participant dashboard JavaScript. The endpoint and payload descriptions below are documented contracts; the observation table records the narrower behavior actually seen. No physical commands were sent during discovery.

## Connection and scope

Base URL:

```text
https://parking-lock-service-production.up.railway.app
```

The reference accepts either an `X-API-Key` header or an `apiKey` query parameter. Keep the key in the backend's `ECURIOUS_API_KEY` environment variable and use header authentication for backend requests. Do not put it in `EXPO_PUBLIC_*`, URLs, app source, tracked files, or logs. The service scopes access to locks assigned to the caller's team.

The application integration is a separate, read-only view of assigned locks and status through `GET /api/hardware`. The mobile Activity screen fetches this view; simulator bookings and controls remain explicitly labelled as simulated. Hardware writes remain disabled and the server still runs in mock mode. The user-supplied host name contains `production`; only the challenge-assigned test hardware is in scope.

To fetch a redacted status report from the laptop:

```sh
npm run hardware:inspect
```

The command loads the backend `.env` without printing its contents. Backend requests use a six-second timeout, a 1 MiB response cap, and redirect rejection. The Expo launcher excludes `ECURIOUS_API_KEY` from its child environment. Diagnostic output contains selected fields, whitelist mode/count, and plate-observation metadata; raw plates, camera captures, upstream bodies, and credential echoes are excluded.

The adapter preserves `status` and `lastReportedPresence` as last-reported values. It derives `barrier`, `occupancy`, and `telemetryFresh` using a **60-second local display policy**: missing/future/stale timestamps and offline/unknown status produce unknown current state. This interval is not an Ecurious guarantee or permission to move hardware. A successful fetch does not reset the provider observation's age.

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
| `carPresence` | `vacant` or `occupied`; keep missing or unfamiliar values unknown |
| `battery12V`, `battery3_7V` | Device battery readings |
| `signalStrength4G` | Cellular signal telemetry; scale is not defined in the reference |
| `waterIngress`, `activeErrors` | Hardware fault information |
| `lastSeenAt` | Provider's last-seen timestamp; do not interpret an old observation as current state |

The dashboard also reads `whitelist` and `latestPhoto.licensePlate` from lock objects. These may carry personal data even on a general list/status request: select permitted output fields rather than forwarding the upstream object wholesale. Never log upstream response bodies, plate lists, camera captures, or arbitrary provider errors.

`GET /api/v1/locks/:id/whitelist` appears in an HTML comment, but has no rendered request/response specification. Its behavior is not verified; do not rely on it as an established endpoint.

## Documented commands; disabled in the initial integration

| Method and path | Body | Documented physical meaning |
| --- | --- | --- |
| `POST /api/v1/locks/:id/unlock` | Optional `{ "cancelAutoLift": false }` | Lower the barrier to permit entry or exit. |
| `POST /api/v1/locks/:id/lock` | Optional `{ "cancelAutoLift": false }` | Raise the barrier to prevent parking. The reference describes this as reserving/protecting the bay, but it is not a booking resource. |
| `POST /api/v1/locks/:id/keep-state` | `{ "state": "normal" }`, `"keep_open"`, or `"keep_closed"` | Select standard timeout behavior or permanent open/closed mode. |
| `POST /api/v1/locks/:id/whitelist` | `{ "plates": ["[FICTIONAL-PLATE]"] }` | Program allowed plates for hardware-triggered automatic lowering. |

`cancelAutoLift: true` is described as disabling the automatic relift timeout. The reference does not specify the timeout duration or the full interaction between commands, occupancy, and keep-state modes. The participant dashboard sends `cancelAutoLift: true` for its Lock button and an empty object for Unlock. That dashboard choice is not evidence that it is appropriate for our reservation flow.

Command response examples contain `success`, `message`, and `result`. Messages say the command was sent and the barrier is raising or lowering. Treat these as acknowledgements. Keep the UI at **command requested / awaiting observation** until a fresh, authenticated hardware observation confirms the target state.

The unlock example maps numeric `deviceStatus: 2` to lowered and `carPresence: 2` to vacant; the lock example maps `deviceStatus: 1` to raised. These examples do not define a complete numeric enum. Preserve unknown values rather than inferring a physical state.

### Whitelist rules persist in hardware

The reference says the camera EEPROM accepts up to ten specific plate entries. A recognised matching vehicle automatically lowers the barrier without a separate application command.

- `{ "plates": [...] }` installs specific allowed plates.
- `{ "wildcard": true }` permits any recognised plate to trigger lowering.
- `{ "plates": [] }` disables automatic plate-triggered lowering.
- The dashboard represents wildcard access as `*` or a wildcard-labelled value.

Writing a whitelist changes future physical access. It is not a read-only recognition check or a booking with an automatic expiry. Confirm format, overwrite behavior, retention, rollback, and timeout cleanup before using it for a reservation. Do not change the existing wildcard configuration during exploration.

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

1. Recheck `lock-0001` and have the mentor confirm its connection and the earlier lowering-stall condition. Later raised status superseded the initial offline report, but no motor movement or fault recovery was directly observed. Confirm which telemetry proves hardware connectivity.
2. Identify the exact assigned test bay, physical layout, sensor behavior, and any accepted GoingElectric/charger mapping. Do not operate unrelated infrastructure.
3. Confirm occupancy interlocks and safe lock/unlock sequencing, including relift and keep-state behavior. Unknown or stale occupancy must not enable a movement based on a claimed empty bay.
4. Establish how a booking installs and removes a specific plate rule, how expiry/cancellation restores the agreed configuration, and which actual recognition event proves arrival. Verify the SSE name mismatch with real observations.
5. Implement backend commands with explicit requested/confirmed/failed/unknown outcomes. Following a timeout, reconcile status before retrying; confirm any supported idempotency mechanism rather than assuming one.
6. Agree what constitutes real charging evidence. This lock API alone cannot supply it.
7. Record reserve/protect → recognised arrival → accepted charging evidence → departure/release using fresh hardware observations in `BUILD-LOG.md`. Keep simulator steps labelled, and retain no raw plates, credentials, or camera captures in tracked evidence.

Until these prerequisites are met, successful list/status requests are evidence of authenticated read access only. They are not a completed hardware integration or a live reservation cycle.
