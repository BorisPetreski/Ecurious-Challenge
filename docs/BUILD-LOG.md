# Build log and submission evidence

Keep this updated during the event. Replace bracketed fields with observations; leave an item explicitly untested until it has evidence. Never paste API keys, authorization headers, raw plate data, or camera images into this tracked document.

## Starting point

- Prepared on 23 October 2026: dependency-free local Node/browser simulator, synthetic stations, optional direct GoingElectric discovery, adapter boundary, lifecycle tests, and preparation documentation.
- Real hardware integration: **not implemented in the prepared starter**.
- GoingElectric live access: **requires approved key and an on-site browser test**.
- Chosen mission areas: no-shows and blocked bays.
- Team members and responsibilities: [fill in].
- Event reuse/disclosure rules checked with: [name/source and result].

## Preparation checks

On 23 October 2026, all 15 Node tests passed, including the simulated lifecycle, concurrent reservations, unsafe release prevention, plate uncertainty, expiry, HTTP validation, and static-file boundaries. Syntax checks, the local setup/port check, HTML element bindings, and serving the actual UI assets with the initial API state also passed. No visual browser review was run. Live Ecurious hardware and authenticated GoingElectric results remain untested pending on-site access.

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
