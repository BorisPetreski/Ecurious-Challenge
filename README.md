# Ecurious Challenge

BayReady is an Expo mobile starter for the Ecurious WATT THE HACK challenge on 24 October 2026. The primary target is Android with Expo Go. The proposed mission areas are no-shows and blocked bays; confirm final product scope with your team.

Read the [complete system design](docs/SYSTEM-DESIGN.md) for architecture, data flows, reservation rules, privacy boundaries and limitations. The [documentation index](docs/README.md) links database/API references, operations, integration evidence and the business model.

## Start the mobile app

Node 24+ and npm are required. Dependencies are already installed in the current workspace. On a fresh checkout:

```sh
git clone https://github.com/BorisPetreski/Ecurious-Challenge.git
cd Ecurious-Challenge
npm --prefix mobile ci
```

From the project root:

```sh
npm start
```

This runs both the local reservation API on port 3000 and Expo Metro on port 8081. Update Expo Go on your Android phone, connect the phone and laptop to the same Wi-Fi, and scan the terminal QR code in Expo Go. Ctrl+C stops both processes. If API port 3000 is busy, use `PORT=3001 npm start`.

The mobile app uses Expo SDK 58, React Native, Expo Router, and TypeScript. It connects to the existing simulator over the local network. See [mobile setup and troubleshooting](mobile/README.md) for API address overrides and connection details.

## Current behavior

- First-launch profile setup, then a full-screen native map with a filter dropdown and floating location/navigation controls.
- First-launch local driver profile, saved connector preference, and mock payment selection.
- Location → bay → individual connector selection, with a reservation holding the whole bay.
- Individually selectable directory app slots: an unreserved listed plug can receive a shared software hold that blocks the same slot for other BayReady users.
- Supabase booking integration prepared for registered bays, shared holds, expiry and owner-only cancellation; hosted migration/auth setup pending.
- Native reservation screen and activity timeline backed by the local simulator.
- Separate read-only Ecurious diagnostics and a designated-bay protect/entry/release screen.
- Guarded durable hardware commands with worker claims, sensor confirmation, blocked-state recovery and no-show cleanup intents; activation remains pending.
- Fictional station cards with one reservable demo bay.
- Reserve, simulated plate check, simulated charging, departure, and release.
- No-show expiry, blocked-bay scenarios, low-confidence recognition, and capability-driven controls.
- Typed API client with bounded requests and polling while the app is active.

The Node lifecycle rehearsal remains simulated. A separate guarded Ecurious workflow is implemented for explicitly enrolled test bays, with commands **off by default**. It needs the fourth migration, a backend-only Supabase server key, operator enrollment/interlock confirmation and an assigned-lock allowlist before activation. No physical movement or complete live cycle has been verified. See [hardware setup](docs/HARDWARE-SETUP.md) and [blocked-bay/no-show behavior](docs/BAY-LIFECYCLE.md).

Activity diagnostics use real Ecurious reads. Stale/offline readings remain unknown. The dedicated hardware screen separates booking state, command acknowledgement and physical observations; unknown delivery stays quarantined. The native map still retrieves GoingElectric directly with source/time/entry links. Directory app slots do not automatically map to Ecurious hardware.

Put the registered GoingElectric app key in the root `.env` as `ELECTRIC_API_KEY` (also accepts `GOINGELECTRIC_API_KEY`). Root launchers pass this directory key to the phone for direct requests. It stays out of tracked source; it is available on the end device. Restart Expo after key changes. The opening map fills the screen; use **Filters** for connector/power, reported faults, reserved bays/deadlines, and directory-only chargers. The location control sits at the lower right. The initial view is Berlin, not a detected location. Required basemap branding remains visible; no website is embedded.

First launch offers profile setup with name, email, phone, plate, connector and a mock payment preference. It is saved on the device; **Explore map first** permits browsing without personal details. Your saved connector automatically filters the map, while minimum power stays in the dropdown. Edit the profile from the map's **Profile** control.

The map shows real GoingElectric locations and their listed plugs by default. After a fresh database read, plugs without active BayReady holds start unreserved in the app. Choose a plug, review the masked vehicle/mock payment and duration, then confirm a shared hold. Other BayReady users cannot reserve the same app slot until cancellation or server expiry. Physical occupancy and operator availability remain unverified. Directory counts define virtual app slots, not assigned physical bay IDs.

Separately, registered bays are grouped by location; choosing one of their connectors holds the whole physical bay in the app inventory. Shared booking code and four schema migrations are prepared for the supplied Supabase project; hosted activation still needs administrator access. Follow [the setup and reservation model](docs/SUPABASE.md). Fictional test inventory is optional in Filters; the independent local simulator remains at `/reserve`.

Set `ECURIOUS_API_KEY` in the root `.env` and restart `npm start` to enable hardware diagnostics. The supplied challenge service is the default origin; `ECURIOUS_BASE_URL` can override it with an HTTPS origin. The key stays on the backend and is removed from the Expo child process environment. Run `npm run hardware:inspect` for the same redacted, read-only report in the terminal. See the [verified Ecurious API contract and observations](docs/ECURIOUS-API.md).

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm start` | Expo and the phone-accessible simulator API together |
| `npm run mobile` | Expo only |
| `npm run server:lan` | Simulator API only, reachable from a phone on the LAN |
| `npm run server` | Original browser demo and API on loopback |
| `npm run dev` | Watch and restart the standalone backend |
| `npm test` | Lifecycle, HTTP, directory slot, profile and booking contract checks |
| `npm run test:database` | Isolated Postgres migration, permission, expiry and concurrency checks using Docker |
| `npm run check` | JavaScript syntax and native TypeScript checks |
| `npm run mobile:doctor` | Expo project checks |
| `npm run doctor` | Backend setup and available-port check |
| `npm run hardware:inspect` | Read assigned Ecurious locks without sending commands or printing plates |

The standalone browser demo is available at http://127.0.0.1:3000 while the API runs. Optional backend settings go in `.env`, copied from `.env.example`. Mobile address overrides go in `mobile/.env`, copied from `mobile/.env.example`. Both actual environment files are ignored by Git. Never place hardware secrets in an `EXPO_PUBLIC_` variable; those values are bundled into the app.

## Where to develop

| Path | Purpose |
| --- | --- |
| `mobile/src/app/` | Native screens and navigation |
| `mobile/src/components/` | Shared mobile UI and state provider |
| `mobile/src/hooks/use-reservation.ts` | Foreground polling and booking actions |
| `mobile/src/lib/reservation-api.ts` | Typed client and API address selection |
| `mobile/src/lib/goingelectric-api.ts` | Direct device directory requests and station normalization |
| `mobile/src/lib/bookings-api.ts` | Supabase guest session and validated booking RPC client |
| `mobile/src/hooks/use-directory-bookings.ts` | Scoped shared holds for listed directory plugs |
| `supabase/migrations/` | Reviewed database schema and atomic booking functions |
| `mobile/app.json` | Expo app configuration |
| `server.mjs` and `lib/simulator.mjs` | Local API and reservation rules |
| `lib/ecurious-adapter.mjs` | Backend-only reads and single-attempt lock/unlock command adapter |
| `lib/hardware-workflow.mjs` and `lib/hardware-store.mjs` | Authenticated intents, durable claims, guarded dispatch and reconciliation |
| `public/` | Original browser prototype |

## Team and submission references

- [Preparation plan and team formation](docs/TOMORROW.md).
- [System design and complete documentation index](docs/README.md).
- [Architecture and integration guide](docs/INTEGRATION.md).
- [Demo and pitch rehearsal](docs/PITCH.md).
- [Business model: pricing, no-shows, blocked bays and unit economics](docs/BUSINESS-MODEL.md), with [editable assumptions](docs/business-model/assumptions.json) and [scenario results](docs/business-model/scenarios.csv).
- [Build log and evidence checklist](docs/BUILD-LOG.md).
- [Original challenge brief](source/challenge-brief.pdf) and [extracted text](source/challenge-brief.txt).

The repository is [BorisPetreski/Ecurious-Challenge](https://github.com/BorisPetreski/Ecurious-Challenge). The user manages Git; no push is performed by the setup scripts. Keep `.env`, private runtime data, real plates, and camera captures out of commits. The scripts do not create cloud builds, publish an app, or configure a production backend.

## Integration priorities

The latest read-only check authenticated team `E-Indifferent` with three assigned locks. At `2026-10-24T10:54:04.599Z`, `lock-0001` was offline, `lock-0002` had a recent raised/vacant report, and `lock-0003` was stale. All reported wildcard camera access. These are dated observations, not current-state guarantees or confirmed physical bay mappings. Ask the Ecurious mentors to confirm current connectivity, occupancy interlocks, relift behavior, specific-plate access, actual event delivery, and accepted charging evidence before enabling movement. Connect one full real reservation cycle before adding extra features. A polished app is optional in the brief; a working hardware integration is required for top ranks.

Source references: [GoingElectric API documentation](https://www.goingelectric.de/stromtankstellen/api/docs/), [GoingElectric API terms](https://www.goingelectric.de/stromtankstellen/api/terms/), and [Expo documentation](https://docs.expo.dev/). Product defaults and hypothetical pricing remain proposals for the team.
