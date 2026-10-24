# Native Ecurious OCR rehearsal

Run the focused test with no credentials or running services:

```sh
node --test test/ecurious-native-ocr.test.mjs
```

The test uses the real `EcuriousAdapter`, `HardwareSlotService` and guarded `HardwareWorkflowService`. A mocked HTTPS transport returns the native Ecurious JSON shapes; an in-memory private store substitutes for PostgreSQL. It sends no network request, cloud write, physical command or payment. All plates are fictional test values.

The native path is `GET /api/v1/locks/{id}/plate/latest` → private HMAC comparison → `authorize_hardware_plate_entry` → durable entry intent → guarded `POST /unlock` → acknowledgement → separate, strictly newer status observation. Wrong, pre-protection, equal-time, future and missing/404 camera observations cannot authorize entry. A command acknowledgement does not establish an open barrier, parked car, charging session or departure. The built-in response does not supply a required recognition-confidence value; the test does not invent a score.

The separate whitelist test checks exact `POST /api/v1/locks/{id}/whitelist` bodies `{ "plates": ["MDEMO42"] }` and `{ "plates": [] }`. These replace the camera access policy; they do not inject a camera recognition. The POST echo is an acknowledgement only. `getPlateAccessMatch()` privately reads the policy back without returning plate strings. That policy read is not a newer motion observation and does not prove a vehicle arrived.

The production guarded lowering path keeps automatic plate access disabled. Do not combine a specific-plate or wildcard auto-lowering policy with software-dispatched lowering: that creates two independent actors. A supervised hardware demonstration must choose and verify one control owner, confirm organizer interlocks and mapping, and record real command/observation evidence. This mocked test does not establish physical safety, hosted transaction behavior, real OCR accuracy or a complete live charging cycle. No YOLO model is required for the built-in polling path; the optional private recognition callback remains a separate integration.
