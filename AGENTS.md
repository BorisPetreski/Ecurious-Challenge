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

- All reservation hardware and charging in the prepared starter are simulated. The adapter throws until implemented from the actual on-site documentation.
- Internal `/api/*` routes are not Ecurious API endpoints. Confirm reserve/release semantics, occupancy interlocks, status acknowledgements, and actual plate event delivery before wiring live behavior.
- The mobile Map tab displays the official GoingElectric website directly in react-native-webview; no API key or scraping is used. Its directory badge is separate from the reservation simulator badge. The original browser demo also has an optional direct API request with an approved key. A custom native API integration remains pending; keep attribution, timestamps, per-station links, and separation from simulated stations when implementing it. Do not silently proxy or redistribute directory data.
- Directory station IDs do not automatically map to a reservable Ecurious bay. Only the designated hardware is part of the real demo.
- Preserve explicit mock/live labels. The proposed mission areas are no-shows and blocked bays; confirm scope with the newly formed team and prioritize the real full cycle over extra features.
- Keep secrets, raw plates, and camera captures out of tracked files and logs. Use fictional plates in tests. Never treat command acceptance or a missing camera event as proof of safe physical state.

## Documentation

Update `docs/BUILD-LOG.md` with actual contract details, decisions, failed attempts, and observed evidence. Keep hypothetical pricing and utilisation inputs labelled as assumptions. Avoid claiming OCPI/OCPP compliance, real charging, or GDPR compliance without evidence.
