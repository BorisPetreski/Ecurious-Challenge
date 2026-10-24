# Plate recognition: Ecurious OCR and optional model handoff

**Ecurious's built-in OCR is the primary integration. No YOLO model is required.** The existing worker calls `GET /api/v1/locks/:id/plate/latest` through `getPlateMatch()`, compares the transient plate with the booked HMAC and atomically requests entry. The user selected **`lock-0002`** as the test device on 24 October 2026; occupancy interlocks and automatic re-raising still need operator confirmation before live motion.

## Native Ecurious path

1. Create the owner-bound hardware booking. At T−10 the normal worker checks assigned device/mapping, fresh vacancy/fault state and the approved access policy before protecting the bay.
2. After protection is confirmed, poll the latest OCR read. Its flat documented response contains `lockId`, `timestamp`, `licensePlate` and `plateType`; it supplies no documented confidence score or unique event UUID. Do not invent either. A 404 means no recognition, not vacancy.
3. Require the event to be strictly newer than confirmed protection and timely against the database deadline. Compare the plate privately; the database checks freshness/phase under locks and deduplicates the booking/event correlation.
4. A matching native recognition queues guarded lowering. Acknowledgement, newer lowered observation, occupied arrival and later vacant departure remain distinct. A timely accepted match ends the unused-hold timer. No camera or plate text is returned to the phone.

### Whitelist is access configuration

`POST /api/v1/locks/:id/whitelist` with `{ "plates": ["MDEMO42"] }` programs automatic access for that fictional plate; `{ "plates": [] }` disables plate-triggered automatic lowering. It does **not** insert an OCR event, reserve an arrival interval or automatically expire the plate rule.

The current scheduled workflow uses **backend-controlled entry**, with device automatic plate access disabled. It then reads native OCR and issues the single guarded lowering request itself. Enabling whitelist-based automatic entry at the same time would create a second movement controller. A future alternative that delegates entry entirely to the device needs a durable policy-write/revocation lifecycle, no duplicate backend lowering, confirmation/uncertainty handling and an approved retention policy. Future scheduled whitelist programming also needs transient/encrypted plate availability: a stored HMAC cannot recover the original text. Do not add plaintext storage just to bypass that decision.

The narrow adapter already supports `setPlateAccess`, `clearPlateAccess` and private policy read-back. Whitelist ACK remains `confirmed: false`. The [native API rehearsal](NATIVE-OCR-TEST.md) verifies their exact requests and the full adapter → matching → guarded-entry path with mocked provider responses. No live whitelist or barrier POST was sent. Mentors must confirm that native recognition still reports while automatic lowering is disabled. [Current provider evidence](ECURIOUS-API.md) records the read-only checks.

## Optional external service

The [Scenario lab](MULTI-CAR-SIMULATION.md) supplies fictional events independently of inference accuracy. The private callback below remains optional for a future external OCR/model service; it is not needed for native Ecurious recognition. No separate model has been supplied or executed in this branch.

### Integration steps if a separate model is used

1. Inspect its format, inference entry point, dependency versions, license and documented training/evaluation limits. Check whether its wrapper uploads frames, saves debug crops or enables external telemetry. Keep weights, captured frames and actual plates out of Git. Do not run an unfamiliar install script before reviewing it.
2. Run inference beside the designated camera, using an in-memory frame buffer. Detect a plate, decode its characters, and attach a capture timestamp and confidence. Detection confidence and OCR confidence may differ; establish a documented conversion rather than labelling an arbitrary score as a probability.
3. Give the recognition service an operator-approved camera → lock mapping. The phone cannot choose the executable device. Read `BAYREADY_VISION_TOKEN` from that service's private environment and send a small event to the Node endpoint over a trusted private connection, with HTTPS for deployed transport. Do not send frames or crop URLs.
4. Normalize and compare the plate in Node, using the existing stable server HMAC key. The private database entry function checks the active reservation, timely recognition, confirmed protection, device observations and current phase under locks. A successful response requests entry; the normal worker handles lowering and confirmation.
5. Test wrong vehicle, uncertain OCR, corrected OCR, duplicate event, late event, timeout and matching arrival against a fictional adapter first. Then verify camera-to-device mapping, interlocks and the complete cycle with the Ecurious operator on the designated hardware. Inference, authorization, lowering, sensor arrival and charging are separate evidence.

### Optional event contract

Use `POST /api/integrations/plate-recognition` with `Authorization: Bearer <private-token>` and exactly:

```json
{
  "lockId": "operator-assigned-lock-id",
  "eventId": "40000000-0000-4000-8000-000000000099",
  "observedAt": "2026-10-24T13:02:00.000Z",
  "licensePlate": "M-DEMO-42",
  "confidence": 0.96
}
```

The plate is fictional. Replace the timestamp with the real UTC capture time and use a fresh event UUID, retained for retries of that same observation. Capture and backend clocks must agree: events older than fifteen seconds or future-dated events are refused, and recognition must follow confirmed protection. The current 0.90 cutoff is a prototype assumption requiring model calibration. A token-authenticated event is trusted service input; an arbitrary phone check-in does not become authoritative recognition.

The response states `matched` and `entryRequested`, never completed physical movement. On an unknown write outcome, read the booking before retrying with the same event UUID. See the [complete route/error contract](API.md#private-recognition-service-handoff).

## Different vehicles and recognition errors

The lab's Car A/B/C represent different synthetic vehicle identities. A reservation for Car A must refuse Car B even when B has high confidence; a low-confidence A observation must not open the barrier either. Correcting OCR is a new observation, not a client-side override of `matched`.

Currently, changing a booked vehicle means cancelling and rebooking, subject to the normal cleanup and availability checks. A future **Change vehicle** action should verify ownership and atomically replace the fingerprint only before protection or entry; an already protected/entering reservation needs an operator-reviewed flow. Add a plate-country field and evaluate foreign/temporary plate ambiguity before relying on character strings across jurisdictions. Do not silently accept fuzzy matches or charge a penalty for an unreadable plate.

## Privacy boundary

Ecurious is the intended operator, per the user's direction. This branch does not persist recognition frames or raw backend plates, and the endpoint refuses extra image fields. Model-side frame buffering, logs, cloud inference, training reuse and retention remain unverified until the model is reviewed. Disable frame/crop storage, telemetry and training reuse by default. A model license or an in-memory implementation does not establish a lawful basis or complete GDPR compliance. The operator must settle the notice/contact, lawful basis, camera assessment, retention and rights process described in [PRIVACY.md](PRIVACY.md).
