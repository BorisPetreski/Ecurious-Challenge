# Project context

This is BayReady for the Ecurious WATT THE HACK challenge on 24 October 2026. The user has chosen an Expo mobile app, primarily Android with Expo Go. The app lives in `mobile/`; the existing Node reservation simulator remains its backend. Read `README.md`, `docs/INTEGRATION.md`, and the source brief before changing the integration. Teams form at the event; roles and final product scope are agreed with the team. The user manages Git; push only when explicitly requested. The user authorized pushing the mobile app and map integration on 24 October 2026.

## Working commands

- Node 24+. Install native dependencies with `npm --prefix mobile ci` on a fresh checkout.
- `npm start` runs both Expo and the simulator API with LAN access for the phone.
- `npm run mobile` runs only Expo; `npm run server:lan` runs only the phone-accessible simulator.
- `npm run server` serves the original browser demo on loopback; `npm run dev` watches backend changes.
- `npm test` exercises lifecycle and HTTP behavior.
- `npm run check` checks JavaScript syntax and mobile TypeScript; `npm run mobile:doctor` runs Expo checks.
- `npm run doctor` checks the backend's local setup and port availability.

## Integration facts

- The original reservation/charging lifecycle remains simulated. A separate guarded hardware workflow implements real lock/unlock commands, with activation off by default. Read `docs/HARDWARE-SETUP.md` and `docs/BAY-LIFECYCLE.md`; no physical command has been sent. Explicit adapter reserve/release methods still refuse because ownership belongs in the durable workflow. Read `docs/ECURIOUS-API.md` for the observed contract and unresolved interlocks before adding commands.
- Internal `/api/*` routes are not Ecurious API endpoints. Confirm reserve/release semantics, occupancy interlocks, status acknowledgements, and actual plate event delivery before wiring live behavior.
- The mobile Map tab uses react-native-maps with direct device GoingElectric API requests. Root launchers pass ELECTRIC_API_KEY (or GOINGELECTRIC_API_KEY) to EXPO_PUBLIC_GOINGELECTRIC_API_KEY; this directory credential is available on the phone, while ECURIOUS_API_KEY stays backend-only. Keep attribution, timestamps, per-station links, bounded memory retention, and separation from simulated stations. Do not proxy or redistribute directory data. The original browser demo retains an optional direct API request.
- Directory station IDs do not automatically map to a reservable Ecurious bay. Only the designated hardware is part of the real demo.
- The full-screen map uses Supabase for separate virtual directory-slot holds and registered physical-bay inventory. Read `docs/SUPABASE.md`, `docs/DATABASE.md` and `docs/SYSTEM-DESIGN.md` before changing it. Four migrations are prepared; hosted migration/auth activation remain pending. Directory app holds store station/opaque-slot booking references, without importing a catalog or controlling public hardware. A fresh scoped database read is required before missing holds mean unreserved. The registered seed is explicitly fictional. 'Unreserved in BayReady' never means physically vacant. The original simulator lives at `/reserve` and does not share these database holds.
- Inventory uses location → physical one-vehicle bay → individual connector. Booking one connector holds the entire bay. GoingElectric aggregate counts may be displayed as listed plug choices but must never become fabricated bay/connector identities or claims of vacancy. Public locations are visible by default; fictional test inventory is opt-in.
- The first-launch driver profile is local SecureStore data, separate from Supabase guest/email identity. Account email goes directly to Auth only when chosen. A final scheduled hardware booking sends its plate transiently to Node for private HMAC/camera matching; SQL stores only keyed fingerprint/masked suffix. Do not upload other profile fields or log raw plates. Keep BAYREADY_PLATE_HASH_KEY stable/backend-only. The preferred connector automatically filters the map; minimum power remains manual. Payment methods and reservation fees are mock, with no real charge. Read docs/SCHEDULED-SESSIONS.md.
- Preserve explicit mock/live labels. The proposed mission areas are no-shows and blocked bays; confirm scope with the newly formed team and prioritize the real full cycle over extra features.
- Keep secrets, raw plates, and camera captures out of tracked files and logs. Use fictional plates in tests. Never treat command acceptance or a missing camera event as proof of safe physical state.

## Documentation

Update `docs/BUILD-LOG.md` with actual contract details, decisions, failed attempts, and observed evidence. Keep hypothetical pricing and utilisation inputs labelled as assumptions. Avoid claiming OCPI/OCPP compliance, real charging, or GDPR compliance without evidence.

Keep the documentation index and system design current when contracts change. API, database and operations references must distinguish directory software slots, registered whole-bay allocation, the independent simulator, and read-only hardware observations. Provider confirmation of cross-device directory booking references remains open; hashes do not establish permission or physical plug identity.

Hardware commands require enrolled administrator-confirmed interlocks/mapping, backend-only Supabase secret credentials and an assigned-lock allowlist. Phones request owner intents; they never supply an executable lock ID. A committed dispatch permit cannot be reclaimed or retried. No-ACK uncertainty stays quarantined even after a matching GET because an old process could send late; privileged recovery must stop dispatchers first. Fresh observations must be strictly newer than dispatch for acknowledged movement, and contradictory same-time facts must not clear a recovery guard. Physical expiry/cancellation never frees a bay before confirmed cleanup.
