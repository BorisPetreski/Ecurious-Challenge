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

## On site contract

| Question | Actual answer |
| --- | --- |
| Test server and documentation location | [non-secret URL/reference] |
| Authentication scheme | [scheme only; no credential] |
| Authorized bay/EVSE/charger mapping | [IDs approved for documentation] |
| Reserve command and physical confirmation | [documented meaning] |
| Release/open/cancel semantics | [documented meaning] |
| Occupancy and hardware interlocks | [confirmed rules] |
| Plate event delivery and authenticity | [documented source and correlation] |
| Accepted charging evidence | [mentor answer] |
| GoingElectric browser access approval | [answer and tested result] |
| Retention and access agreement | [answer] |

## Actual API call record

| Time | Operation | Method and path | Redacted input shape | Observed response and hardware outcome |
| --- | --- | --- | --- | --- |
| [time] | [status/reserve/arrival/release] | [actual endpoint] | [no keys/plates] | [accepted vs confirmed] |

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
| GoingElectric discovery | Approved API/browser request | Locations, connectors, attribution, links | [fill in] | Untested live |
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
