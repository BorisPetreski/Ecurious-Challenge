# Build log and submission evidence

Keep this updated during the event. Replace bracketed fields with observations; leave an item explicitly untested until it has evidence. Never paste API keys, authorization headers, raw plate data, or camera images into this tracked document.

## Starting point

- Prepared on 23 October 2026: dependency-free local Node/browser simulator, synthetic stations, optional direct GoingElectric discovery, adapter boundary, lifecycle tests, and preparation documentation.
- Real hardware integration: **not implemented in the prepared starter**.
- GoingElectric live access: **requires approved key and an on-site browser test**.
- Proposed mission areas: no-shows and blocked bays; confirm with the team at the event.
- Teams form at the event on 24 October 2026. Team members and responsibilities: [fill in after formation].
- Event reuse/disclosure rules checked with: [name/source and result].

## Preparation checks

On 23 October 2026, all 15 Node tests passed, including the simulated lifecycle, concurrent reservations, unsafe release prevention, plate uncertainty, expiry, HTTP validation, and static-file boundaries. Syntax checks, the local setup/port check, HTML element bindings, and serving the actual UI assets with the initial API state also passed. No visual browser review was run. Live Ecurious hardware and authenticated GoingElectric results remain untested pending on-site access.

## Expo mobile setup on 24 October 2026

- User chose a mobile app using Expo, with Android and Expo Go as the preview target. The user manages Git and requested no push.
- Added `mobile/` using the official Expo SDK 58 template with Expo Router, React Native, TypeScript, and a committed-ready npm lockfile. Dependencies are installed locally.
- Added native Reserve and Activity screens using the same local simulator API. Fictional plate, hold, and confidence settings stay in memory across screen navigation. Hardware and charging remain explicitly simulated; native GoingElectric discovery is pending.
- `npm start` runs the simulator with intentional LAN access plus Expo Metro. Standalone backend access remains loopback by default. The typed native client infers the laptop address from Expo, supports an explicit public URL/port override, and uses bounded requests with foreground polling.
- Native client smoke checks covered configuration, errors, the reservation cycle, and request cancellation. Hook checks covered serialized reads/writes, polling, background/foreground transitions, stale responses, and recovery. No new test framework was added for these focused checks.
- Verification passed: 16 backend tests, TypeScript/syntax checks, Expo dependency alignment, all 20 Expo Doctor checks, Android bundle export, and serving the Android Expo manifest/development bundle alongside the LAN API. Physical Android device interaction and visual layout still require preview in Expo Go.
- Real Ecurious authentication, documented hardware commands, actual plate events, accepted charging evidence, and native GoingElectric discovery remain integration work.

## GoingElectric map and repository handoff on 24 October 2026

- User requested the GoingElectric map and confirmed that no API key is available, choosing the official map for now.
- Added a Map tab that loads `https://www.goingelectric.de/stromtankstellen/` directly in Expo-compatible `react-native-webview`. The original website provides map gestures, search, filters, station pages, attribution, and its browsing experience. No scraping, content injection, directory proxy, or app-owned GoingElectric API key is used.
- Native controls provide back navigation, reload, browser fallback, progress, and recoverable errors. The Map tab uses a DIRECTORY badge and does not depend on simulator availability; Reserve and Activity keep their SIMULATOR badges. Public directory stations are not mapped to the hardware demo bay.
- Added navigation-policy checks for trusted directory hosts, outbound browser links, executable/local URL rejection, and main-document versus subresource HTTP errors.
- Verified 19 tests, native TypeScript/syntax checks, all 20 Expo Doctor checks, and Android bundle export. Physical Android map gestures, website rendering, and location permission behavior still require verification in Expo Go.
- Corrected a strict-TypeScript issue in WebView 14's declaration using its explicit extra-props generic, preserving typed props and event callbacks.
- User subsequently authorized pushing the mobile app and map integration to `BorisPetreski/Ecurious-Challenge`, replacing the earlier no-push instruction. The shared repository remains the source handoff; no app-store release or live hardware deployment is part of this change.

## Business model analysis on 24 October 2026

- User requested a complete business model based on the PDF in `source/`. Read all four PDF pages directly using macOS PDFKit, compared the text with `source/challenge-brief.txt`, and inspected a rendered first page. The brief allocates 20% to Business Case & CPO Value and requires the real hardware cycle for top ranks.
- Added `docs/BUSINESS-MODEL.md` covering customers, pricing/settlement, a ten-minute total hold including grace, no-show evidence and waivers, blocked-bay recovery, responsibility, overstay, CPO/platform economics, costs, risks, distribution, pilot KPIs and a pitch. Pricing is proposed, not an agreed contract, implemented payment flow or measured willingness to pay.
- Retained the original credited €1 hypothesis and made its zero incremental revenue explicit. Compared operator/retailer funding with a separate €1.99 paid experiment; proposed up to €3 total for verified no-shows, without stacking fees or relying on penalties for ROI.
- Consulted official incharge, Enel, EnBW, Tesla and Stripe pages for market examples, plus the European Commission AFIR Q&A and BGB §309 for relevant pricing/contract boundaries. Electra's official newsroom and help pages conflict on reservation availability; documented the conflict rather than asserting a current network-wide feature.
- Added editable commercial assumptions, a dependency-free Node calculator and generated CSV under `docs/business-model/`. The illustrative core CPO outcomes per bay/month are −€78.01 downside, −€11.72 base, €366.88 upside and −€27.65 when holds displace stronger peak demand. No-show recovery is excluded from core results; all utilisation, installed hardware, support, tax and pricing inputs remain assumptions.
- Independent arithmetic review checked outcome sums, held-empty minutes, negative energy displacement, fee splits, waiver treatment, platform contribution and break-even. Found and corrected editable-input validation that could otherwise allow missing values or numeric strings to corrupt results. Final focused verification passed: JavaScript syntax, numerical examples, calculated break-even yielding zero core contribution, no-show recovery staying outside core ROI, invalid input rejection, zero-fee handling, deterministic CSV regeneration, documentation links and Git whitespace checks. Existing app tests were not rerun because no application behavior changed.
- No live Ecurious contract, physical charging, commercial sale, payment capture or utilisation uplift was observed by this analysis. No application behavior changed and no push was requested for the business-model work.

## Ecurious authenticated read integration on 24 October 2026

- User supplied the challenge service at `https://parking-lock-service-production.up.railway.app/` and a backend-only `ECURIOUS_API_KEY`. Read the supplied brief, integration guide, service reference, and participant dashboard code. Public root returned HTTP 200; `/docs` and `/openapi.json` returned 404, so the contract was read from inline HTML and dashboard code. Documented the actual contract and discrepancies in [ECURIOUS-API.md](ECURIOUS-API.md).
- Added a read-only backend adapter for assigned locks, single-lock status, and redacted recognition metadata. Requests use `X-API-Key`, GET only, a six-second timeout, a 1 MiB response cap, and redirect rejection. Hardware writes refuse; no lock/unlock/keep-state/whitelist command was sent. Startup remains mock mode and existing reservation/charging controls remain simulated.
- Added local `GET /api/hardware`, the `npm run hardware:inspect` command, and actual status reads in the mobile Activity screen. The Ecurious key remains in the backend and is removed from the Expo child environment. Projection excludes raw plates, whitelist entries, captures, unknown upstream fields, and credential echoes; upstream errors become fixed diagnostic messages.
- Initial health at `08:57:38.462Z` showed one registered lock and zero connected sockets. The assigned camera-equipped `lock-0001` for `E-Indifferent` first reported offline, vacant, `MOTOR_LOWERING_STALL`, and last seen `08:40:54.596Z`. A later offline report had a newer timestamp and no active errors, demonstrating that timestamp changes alone do not establish connectivity or repair. No physical recovery was observed.
- The user rotated the key during exploration. Bounded reads briefly returned HTTP 401; the updated backend credential subsequently authenticated. No credential or provider error body was printed or retained in tracked evidence.
- The real CLI read fetched at `09:07:36.284Z` reported `raised`/`vacant`, last seen `09:07:01.635Z`, no active errors, wildcard access, and no latest photo. The later raised report supersedes the initial offline snapshot. No movement was requested or directly observed.
- The end-to-end local hardware route fetched at `09:08:10.494Z` returned upstream HTTP 200 with the same last-seen time. The sample was now about 69 seconds old: last-reported status stayed raised, while derived barrier and occupancy correctly became unknown. The 60-second threshold is a local display policy, not a hardware freshness or safety guarantee. Privacy assertions passed and the simulator stayed in mock mode.
- A bounded latest-plate read retrieved a historical observation dated `07:52:28.502Z`; its raw plate was not printed or stored here. A five-second event-stream read returned HTTP 200 and a service-level `connected` event only. No hardware movement, occupancy, recognition, or alarm event was observed. The reference's SSE event names disagree with the dashboard listeners; both naming families remain documented pending actual events.
- Verification at this checkpoint: 45 Node tests passed, including 24 adapter tests/subtests; JavaScript syntax and mobile TypeScript checks passed. Android bundle export succeeded before subsequent custom-map work began. The adapter's mocked tests cover header auth, response projection, unknown/stale/future/offline state, schema and ID mismatch, sanitized auth/network errors, timeout, size cap, zero-network missing configuration, and refused writes. These are software/read-path checks; no full physical cycle or physical-phone preview was completed by this work.

## Native GoingElectric map on 24 October 2026

- User supplied a GoingElectric key and requested a custom native map. Replaced the website embed with `react-native-maps` 1.29.11 and foreground-only `expo-location` ~58.0.19, selected using Expo's SDK-compatible installer. Removed the unused WebView package and its navigation helper/tests.
- Root launchers accept the existing `ELECTRIC_API_KEY` or `GOINGELECTRIC_API_KEY`, passing it as `EXPO_PUBLIC_GOINGELECTRIC_API_KEY` for direct phone requests. The directory key is available on the end device and must be used only for the registered app. Ecurious credentials remain backend-only. Neither key is tracked or logged; exported app artifacts remain ignored and must not be shared as source handoff.
- The native map starts in a labelled Berlin viewport, supports pan/zoom and explicit area searches, power filters, CCS/Type 2 filters, optional tap-triggered location, and station details. Markers and details are directory records only; no public station gains Ecurious booking controls. Directory fault reports are not live availability. The Google/Apple basemap and GoingElectric station data retain their separate attribution.
- Kept visible source attribution, retrieval timestamps, and a clickable GoingElectric page for each selected station. Queries are bounded to a viewport, requests have a ten-second timeout, filters use confirmed plug names, errors omit provider text and credential-bearing URLs, and cancelled/stale requests cannot replace newer results. Results are held in memory and cleared after roughly one hour, with foreground expiry checks; there is no data proxy, database, disk cache, website scraping or embedded website advertising. The app sends `cache: no-store` and retains no deliberate HTTP cache.
- Rechecked the [official API documentation](https://www.goingelectric.de/stromtankstellen/api/docs/), [usage terms](https://www.goingelectric.de/stromtankstellen/api/terms/), and [Expo native-map setup](https://docs.expo.dev/versions/latest/sdk/map-view/). Direct device retrieval and registered-app use remain requirements; no broader redistribution permission is claimed. Expo Go needs no extra Google Maps key; an independent Android app binary requires its own Google Maps SDK setup.
- Live read-only probes returned HTTP 200 for a small Berlin viewport and the provider's plug list. Confirmed exact filter names `CCS` and `Typ2`. At `2026-10-24T09:14:25.816Z`, the actual new client normalized 128 stations with valid source links, `hasMore: false`, and no API key in result objects. Station records were not saved as fixtures or tracked artifacts.
- Final combined verification passed: 49 Node tests, JavaScript syntax/mobile TypeScript, Expo dependency alignment, all 20 Expo Doctor checks, and Android bundle export. The generated Android bundle contains the intended directory configuration and excludes the actual Ecurious hardware key. A scan of 87 tracked/unignored source files found neither provider key; Git whitespace checks passed. These are software/API checks: physical Android gestures, rendering and permission prompts still need preview in Expo Go. No hardware commands or Git push were performed.

## On site contract

| Question | Actual answer |
| --- | --- |
| Test server and documentation location | [Service reference](https://parking-lock-service-production.up.railway.app/); detailed verified observations in [ECURIOUS-API.md](ECURIOUS-API.md). |
| Authentication scheme | Backend-only `X-API-Key`; query parameter also documented, unused by our adapter. Team-scoped assignment authenticated. |
| Authorized bay/EVSE/charger mapping | Team `E-Indifferent`, assigned camera-equipped `lock-0001`; physical bay/EVSE/GoingElectric mapping still requires mentor confirmation. |
| Reserve command and physical confirmation | Documented `POST /api/v1/locks/:id/lock` raises the barrier. No booking resource or atomic reservation ownership is documented; fresh physical confirmation and application booking service are still required. Writes untested and disabled. |
| Release/open/cancel semantics | Documented `unlock` lowers the barrier for entry/exit; `lock` raises it. Whitelist configures persistent hardware access; `keep-state` controls normal/permanent open/closed behavior. App cancellation mapping, auto-relift duration, and restoration policy remain unconfirmed. |
| Occupancy and hardware interlocks | `carPresence` reports vacant/occupied; stale or unknown data stays unknown in the app. No safe-motion interlock, guaranteed freshness, retry/idempotency contract, or occupied-bay behavior verified. Local display limit is 60 seconds only. |
| Plate event delivery and authenticity | Authenticated team-scoped SSE documented at `/events` and `/api/v1/events`; only `connected` observed. Reference uses `status_change`/`vehicle_presence`/`photo_captured`; dashboard uses `lock:status_change`/`lock:car_presence`/`lock:photo_captured`. Confidence, ordering, replay, and booking correlation unverified. |
| Accepted charging evidence | Pending mentor answer; this reference documents no charger/session/energy endpoint. Simulator charging is not physical charging evidence. |
| GoingElectric directory access | User supplied app key; direct viewport and plug-list calls returned HTTP 200. New native client normalized 128 stations with source links. Native retrieval is direct from the phone; physical device preview remains pending. Registered-app scope and terms still apply. |
| Retention and access agreement | [answer] |

## Actual API call record

| Time | Operation | Method and path | Redacted input shape | Observed response and hardware outcome |
| --- | --- | --- | --- | --- |
| `2026-10-24T08:57:38.462Z` UTC service timestamp | Public service health | `GET /health` | No credential | HTTP 200; service ok; one registered lock, zero connected hardware sockets. HTTP health did not prove hardware connectivity. |
| Initial discovery; exact request times not retained | Discover API reference | `GET /`, `GET /docs`, `GET /openapi.json` | No credential | Root HTTP 200; docs/OpenAPI paths HTTP 404. Used inline root reference and dashboard script; no hardware operation. |
| Initial discovery; exact request time not retained | Read assigned locks | `GET /api/v1/locks` | Backend key header; value omitted | Team `E-Indifferent`, lock `lock-0001`, offline/vacant, retained motor-lowering error and old last-seen time. Read only. |
| Follow-up; exact request time not retained | Read single lock | `GET /api/v1/locks/lock-0001` | Backend key header; value omitted | HTTP 200; still offline; vacant; no active errors; last seen `2026-10-24T09:01:00.380Z`. Timestamp change did not establish a connected lock. |
| Follow-up; exact request time not retained | Read latest recognition | `GET /api/v1/locks/lock-0001/plate/latest` | Backend key header; no plate input | HTTP 200; historical timestamp `2026-10-24T07:52:28.502Z`; raw recognition omitted. No arrival demonstrated. |
| Follow-up; bounded to five seconds | Observe event connection | `GET /api/v1/events` | Backend key; value omitted | HTTP 200, `text/event-stream`, 86 bytes, `connected` event only. No hardware event observed. |
| During user credential rotation | Read attempt | `GET /api/v1/locks` | Backend key header; value omitted | HTTP 401 briefly; fixed error surfaced; updated credential later succeeded. |
| `2026-10-24T09:07:36.284Z` UTC | CLI read assigned locks | `GET /api/v1/locks` | Backend key header; value omitted | Raised/vacant, last seen `09:07:01.635Z`, no active errors, wildcard, camera present, no latest photo. No physical command or movement observation. |
| `2026-10-24T09:08:10.494Z` UTC | End-to-end local hardware view | Local `GET /api/hardware` → upstream `GET /api/v1/locks` | No client credential; backend key header upstream | Upstream HTTP 200; last-seen sample unchanged and older than 60 seconds. Reported status raised, derived barrier/occupancy unknown; privacy assertions passed. Simulator remained mock. |
| `2026-10-24T09:14:25.816Z` UTC | Native directory client smoke check | GoingElectric `GET /chargepoints/` | App key omitted; Berlin viewport; clustering false | 128 normalized stations, required source links, no key in results, no stored station fixture. No reservation mapping or live availability asserted. |

## Decisions and failures

| Time | Decision or attempt | Reason | Result and next step |
| --- | --- | --- | --- |
| Prep | Node built-ins and native browser UI | No package downloads required for local rehearsal | Starter only; real provider integration remains |
| Prep | Default 10-minute immediate hold | Makes demo understandable | Product hypothesis; validate with mentors |
| Prep | Separate directory discovery from bay control | Directory entries do not prove live occupancy | Explicit mapping needed on site |
| [time] | [what was tried] | [why] | [including what did not work] |

## Verification evidence

| Scenario | Source of inputs | Expected outcome | Observed outcome and evidence | Status |
| --- | --- | --- | --- | --- |
| Full hardware cycle | Actual designated test bay | Reserve → plate arrival → charge → release | [fill in] | Untested live |
| GoingElectric discovery | Direct API request with supplied app key | Locations, connectors, attribution, links | New client normalized 128 stations; Android bundle passed. Map UI keeps attribution/time/entry links. | API verified; physical phone preview pending |
| No-show | [real timer or labelled simulation] | Safe expiry and driver/operator status | [fill in] | Untested live |
| Blocked bay | [agreed safe sensor/test scenario] | No unsafe movement, honest recovery | [fill in] | Untested live |
| Plate uncertainty | [agreed event/test input] | Manual/corrected check, no false authorization | [fill in] | Untested live |
| Competing reservations | [two requests] | One accepted booking per bay | [fill in] | Untested live |
| Command timeout/stale status | [test method] | Unknown state and reconciliation | [fill in] | Untested live |

## Final submission checklist

- [ ] Source code and setup instructions work on another teammate's machine.
- [ ] Documented actual API calls, architecture/data flow, tools, decisions, and failed attempts.
- [ ] Full live hardware cycle demonstrated and evidence recorded as permitted.
- [ ] GoingElectric discovery works with required attribution and links.
- [ ] At least two mission areas have implemented evidence or a clearly presented answer.
- [ ] Business assumptions, KPIs, limitations, and scaling path are explicit.
- [ ] Secrets and real plate/camera data removed from submission and screen captures.
- [ ] Pitch rehearsed within the actual event limit; submission location/deadline confirmed.
