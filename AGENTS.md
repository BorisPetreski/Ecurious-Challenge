# Project context

This is BayReady, a local preparation starter for the Ecurious WATT THE HACK challenge on 24 October 2026. Read `README.md`, `docs/INTEGRATION.md`, and the source brief before changing the integration. The user handles coding within a team.

## Working commands

- Node 24+, no dependency installation for the current starter.
- `npm start` serves the local app; `npm run dev` watches server changes.
- `npm test` exercises lifecycle and HTTP behavior.
- `npm run check` checks JavaScript syntax; `npm run doctor` checks the local setup.

## Integration facts

- All reservation hardware and charging in the prepared starter are simulated. The adapter throws until implemented from the actual on-site documentation.
- Internal `/api/*` routes are not Ecurious API endpoints. Confirm reserve/release semantics, occupancy interlocks, status acknowledgements, and actual plate event delivery before wiring live behavior.
- GoingElectric discovery is a direct browser request with an approved key. Keep source attribution, timestamp, per-station links, and separation from simulated stations. Do not silently proxy or redistribute directory data.
- Directory station IDs do not automatically map to a reservable Ecurious bay. Only the designated hardware is part of the real demo.
- Preserve explicit mock/live labels. The chosen mission areas are no-shows and blocked bays; prioritize the real full cycle over extra features.
- Keep secrets, raw plates, and camera captures out of tracked files and logs. Use fictional plates in tests. Never treat command acceptance or a missing camera event as proof of safe physical state.

## Documentation

Update `docs/BUILD-LOG.md` with actual contract details, decisions, failed attempts, and observed evidence. Keep hypothetical pricing and utilisation inputs labelled as assumptions. Avoid claiming OCPI/OCPP compliance, real charging, or GDPR compliance without evidence.
