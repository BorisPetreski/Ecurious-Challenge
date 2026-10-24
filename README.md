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
- Separate **Bookings** view for active/upcoming holds; compact **Reserve now** and **Schedule** choices, native date/time selection and one confirmation action.
- Scheduled arrival holds from ten minutes before arrival until ten minutes after it; a timely trusted plate match stops unused-hold expiry on enrolled hardware. Ten-minute extensions cost €1 mock.
- Hosted Supabase booking schema, persistent guest/email sign-in, shared holds and owner-only cancellation.
- Native reservation screen and activity timeline backed by the local simulator.
- Separate read-only Ecurious diagnostics and a designated-bay protect/entry/release screen.
- Guarded durable hardware commands with worker claims, sensor confirmation, blocked-state recovery and no-show cleanup intents; a barrier-only `lock-0002` is enrolled for the app test.
- Fictional station cards with one reservable demo bay.
- Reserve, simulated plate check, simulated charging, departure, and release.
- No-show expiry, blocked-bay scenarios, low-confidence recognition, and capability-driven controls.
- Typed API client with bounded requests and polling while the app is active.
- Multi-car **Scenario lab** with three fictional drivers, seven guided cases, a virtual clock and explicit command/sensor steps. Open it from Profile, Activity or the disconnected Hardware screen.
- **Profile → Privacy & data** for an explicit local export/deletion, owner-only cloud booking export and a pending-review erasure request. Contact fields are optional. Ecurious is the intended operator; legal notice, retention and fulfillment still need operator completion.

The Node lifecycle rehearsal remains simulated. The separate Ecurious workflow has an enrolled **barrier-only `lock-0002` test interface, 0 kW, no charger**. The user relayed the operator confirmations and exclusive team use. A direct raise/lower API test received acknowledgements and newer matching hardware reports; an additional worker cleanup lowering was confirmed. After a telemetry pause, a genuine fresh vacant/lowered report at **14:22:21.966 UTC** reconciled the bay and restored activation. Device reports have been about three minutes apart; a booking intent and confirmed physical protection are separate states. The complete customer plate/occupancy/departure cycle remains unverified. See the [app walkthrough](docs/LOCK-0002-WALKTHROUGH.md), [hardware setup](docs/HARDWARE-SETUP.md) and [blocked-bay/no-show behavior](docs/BAY-LIFECYCLE.md).

Activity diagnostics use real Ecurious reads. Stale/offline readings remain unknown. The dedicated hardware screen separates booking state, command acknowledgement and physical observations; unknown delivery stays quarantined. The native map still retrieves GoingElectric directly with source/time/entry links. Directory app slots do not automatically map to Ecurious hardware.

Put the registered GoingElectric app key in the root `.env` as `ELECTRIC_API_KEY` (also accepts `GOINGELECTRIC_API_KEY`). Root launchers pass this directory key to the phone for direct requests. It stays out of tracked source; it is available on the end device. Restart Expo after key changes. The opening map fills the screen; use **Filters** for connector/power, reported faults, reserved visibility and directory-only chargers. **Bookings** shows your active/upcoming holds and their deadlines. The location control sits at the lower right. The initial view is Berlin, not a detected location. Required basemap branding remains visible; no website is embedded.

First launch offers profile setup with name, email, phone, plate, connector and a mock payment preference. Profile also links to optional email sign-in and guest account conversion. It is saved on the device; **Explore map first** permits browsing without personal details. Your saved connector automatically filters the map, while minimum power stays in the dropdown. Edit the profile from the map's **Profile** control.

The map shows real GoingElectric locations and their listed plugs by default. After a fresh database read, plugs without active BayReady holds start unreserved in the app. Choose a plug, review the masked vehicle/mock payment and duration, then confirm a shared hold. Other BayReady users cannot reserve the same app slot until cancellation or server expiry. Physical occupancy and operator availability remain unverified. Directory counts define virtual app slots, not assigned physical bay IDs.

Separately, registered bays are grouped by location; choosing one of their connectors holds the whole physical bay in the app inventory. The supplied Supabase project has the shared booking schema and sign-in configured; migration evidence is tracked in the build log. Follow [the setup and reservation model](docs/SUPABASE.md). Fictional test inventory is optional in Filters; the independent local simulator remains at `/reserve`.

Set `ECURIOUS_API_KEY` in the root `.env` and restart `npm start` to enable hardware diagnostics. The supplied challenge service is the default origin; `ECURIOUS_BASE_URL` can override it with an HTTPS origin. The key stays on the backend and is removed from the Expo child process environment. Run `npm run hardware:inspect` for the same redacted, read-only report in the terminal. See the [verified Ecurious API contract and observations](docs/ECURIOUS-API.md).

## Reservation options and session

Public map plugs and enrolled hardware bays offer **Reserve now — 10 minutes free**, **Add 10 minutes — €1 mock**, and **Book ahead** with native calendar/time dialogs. Scheduled bookings currently use a €1 mock fee. Hardware protection is requested ten minutes before arrival; an occupied requested bay can switch to a compatible bay at the same location. A full location records a mock refund and suggests nearby confirmed alternatives. Public directory choices remain software holds and do not control public barriers.

Open **Profile → Sign in & account** for email/password sign-in or to keep guest bookings while verifying an email. **Hardware → View session** shows duration, vehicle, connector, booking and available hardware facts; live energy and power require charger telemetry. Native Ecurious latest OCR is the primary recognition source; no YOLO model is required. Whitelist programming is a separate device auto-access mode. See [the booking/session design](docs/SCHEDULED-SESSIONS.md) and [native OCR rehearsal](docs/NATIVE-OCR-TEST.md).

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
| `npm run test:database -- --multi-car-only` | Two concurrent owners, car matching, whole-bay exclusion and fallback in isolated Postgres |
| `npm run test:database -- --privacy-only` | Owner-only data export and erasure intake; no Auth/hardware changes |
| `npm run check` | JavaScript syntax and native TypeScript checks |
| `npm run mobile:doctor` | Expo project checks |
| `npm run doctor` | Backend setup and available-port check |
| `npm run hardware:inspect` | Read assigned Ecurious locks without sending commands or printing plates |
| `npm run hardware:enroll-test -- --lock-id lock-0002` | Preview the explicit barrier-only test enrollment; `--apply` registers it with control gates disabled |

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
- [All 20 guiding questions with concrete implementation suggestions](docs/CHALLENGE-WORKFLOW.md).
- [Multi-car lab and real database verification](docs/MULTI-CAR-SIMULATION.md), [plate-model handoff](docs/MODEL-INTEGRATION.md) and [privacy implementation/readiness](docs/PRIVACY.md).
- [Live lock-0002 app test walkthrough](docs/LOCK-0002-WALKTHROUGH.md), including plate, occupancy and release steps for the barrier-only hardware.
- [Original challenge brief](source/challenge-brief.pdf) and [extracted text](source/challenge-brief.txt).

The repository is [BorisPetreski/Ecurious-Challenge](https://github.com/BorisPetreski/Ecurious-Challenge). The user manages Git; no push is performed by the setup scripts. Keep `.env`, private runtime data, real plates, and camera captures out of commits. The scripts do not create cloud builds, publish an app, or configure a production backend.

## Integration priorities

The selected **lock-0002** is enrolled as barrier-only hardware. Direct API movement was confirmed by newer provider reports at `2026-10-24T13:54:55.309Z` (raised) and `13:54:59.709Z` (lowered). After the user confirmed exclusive team use, automatic camera access was disabled and verified in four reads. These are dated observations, not a current-state guarantee. The app's native OCR → private plate match → entry → occupancy → departure cycle still needs an actual camera/sensor run; accepted charging evidence needs organiser agreement because this rig has no charger. A polished app is optional in the brief; the core hardware cycle matters most.

Source references: [GoingElectric API documentation](https://www.goingelectric.de/stromtankstellen/api/docs/), [GoingElectric API terms](https://www.goingelectric.de/stromtankstellen/api/terms/), and [Expo documentation](https://docs.expo.dev/). Product defaults and hypothetical pricing remain proposals for the team.
