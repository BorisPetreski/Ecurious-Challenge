# Demo and pitch rehearsal

**Concept:** BayReady gives an arriving EV driver a reserved bay with a clear deadline and a useful recovery when the bay cannot be provided. The current depth is no-shows, blocked bays and trusted plate check-in. Show the difference between implemented software and observed physical evidence: the guarded hardware code exists, but no live barrier cycle or electrical charging has been verified. [CHALLENGE-WORKFLOW.md](CHALLENGE-WORKFLOW.md) turns all 20 guiding questions from brief pages 2–3 into concrete implementation suggestions and priorities.

## Three minute outline

| Time | Show | Say |
| --- | --- | --- |
| 0:00–0:20 | Driver problem | “Knowing where a charger is does not mean the bay will be usable when you arrive.” |
| 0:20–1:25 | Real discovery and full hardware cycle | Find a compatible charger, reserve the mapped bay, show the hardware response, matching plate event, agreed charging evidence, departure and completed release. |
| 1:25–2:05 | No-show and blocked-bay recovery | Open the **Scenario lab** for clearly labelled accelerated fictional cases: wrong car, missed deadline, blocked target/fallback and full-site mock refund. Explain what prevents a stranded driver and how uncertainty reaches the operator. |
| 2:05–2:35 | CPO value | “Bounded holds and fair expiry are intended to reduce reservation waste. We would measure idle reserved minutes and successful arrivals alongside actual charging utilisation.” |
| 2:35–3:00 | Architecture and next step | Show the adapter boundary, actual limitations, and what another charging app/operator would need to integrate. |

Use the organiser's actual pitch limit. Name any simulated steps explicitly. If live hardware is unavailable during the pitch, use a permitted earlier recording with its context and describe the limitation; it does not automatically replace the required hardware demonstration.

## Rehearsal acceptance checks

1. Happy path: reserve the free bay, expected plate arrives, access is confirmed, charging is evidenced, vehicle departs, booking ends, empty bay returns to the agreed state.
2. No-show: reserve without arrival, advance the labelled demo clock, observe safe expiry. Confirm occupancy before physical actions in the real integration.
3. Blocked bay: simulate an unrelated car; reservation is unavailable or flagged, driver gets an honest status, operator owns recovery. Demonstrate safe clearing and retry only if implemented.
4. Plate uncertainty: a mismatched or stale built-in Ecurious observation requests no entry; demonstrate a corrected fresh scan or explain the operator fallback. Low confidence is a separate fictional-lab/optional-model case: the provider's latest-plate response has no confidence score.
5. Timeout/stale status: explain what is confirmed and what is unknown. Do not describe a capability as implemented unless you tested it.

The [multi-car rehearsal](MULTI-CAR-SIMULATION.md) uses a separate fictional world. Its `race` scenario shows deterministic competing requests, not simultaneous hosted database writes. The `plate-check` scenario distinguishes a match, entry intent, acknowledged command and later physical observation. Do not present green scenario checks as proof of built-in camera accuracy or a real hardware cycle.

## Current reservation policy

- **Now:** ten minutes free.
- **Schedule:** €1 mock. For arrival at 15:00, protection begins no earlier than 14:50 and the unused deadline is 15:10.
- **Add ten minutes:** €1 mock, with the new deadline confirmed by the server and conflicts rejected atomically.
- A timely trusted match stops unused-hold expiry. Actual arrival/departure need separate occupancy evidence; release waits for safe cleanup.
- A blocked requested bay can switch to a compatible physical bay at the same location before activation. A full site cancels and records a mock refund, with verified alternatives offered separately.

Public directory holds are shared software slots; they do not move barriers or prove vacancy. The hardware rules require an explicitly enrolled test bay. Mock fees are not real payments. For the exact contract, see [SCHEDULED-SESSIONS.md](SCHEDULED-SESSIONS.md).

## Business hypothesis to validate

The [full business model](BUSINESS-MODEL.md) explores commercial experiments separately from the implemented mock tariff above: a sponsored/credited reservation, operator subscription and paid reservation offer. These are alternatives for a later pilot, not additional app charges or settled Ecurious prices. The user identifies **Ecurious as the intended operator**; the exact commercial agreement is not supplied.

No automatic extra no-show penalty is implemented. Before introducing one, require reliable service/arrival evidence, disclosed terms, operator-failure waivers and review of ambiguous recognition. A missed plate event alone cannot establish a fair charge. The older business model's hypothetical penalty, credit and subscription figures are assumptions to validate, not this demo's billing rules.

The illustrative conservative case loses **€11.72/bay/month excluding penalties** and needs about **66.68 recovered usable bay-minutes/day** to break even at its other assumptions. Select sites and prices through a pilot; do not claim observed uplift or general profitability. A retailer could sponsor the service where measured additional retail contribution justifies it.

Track successful check-ins per booking, no-show rate, blocked-arrival rate, reserved idle bay-minutes, and charging minutes divided by available bay-minutes. Compare against a baseline; reservations could lower utilisation if they keep bays empty for too long.

For a transparent scenario: 20 recovered minutes of charging at an assumed average 50 kW is about 16.7 kWh. At an assumed €0.10 contribution per kWh, that is about €1.67 contribution before hardware and operating costs. Every input is illustrative; no uplift has been measured by this starter.

## Short answers to likely judge questions

**What is actually live?** Directory requests retrieve real listings; Supabase stores shared app bookings. The guarded command/plate workflow exists but activation and the physical cycle remain unverified. The scenario lab and original simulator are fictional, payments are mock, and real energy/charging telemetry is unavailable. Name every source separately.

**What if the server times out?** Keep the result uncertain, read authoritative status, and reconcile before retrying a physical command. Explain the actual implementation, including any missing recovery.

**Can another app use it?** A documented reservation service and provider adapter are the path. Map stable station/EVSE/bay and booking IDs, authentication, event delivery, and ownership of state. Do not claim OCPI/OCPP compliance without an implemented, validated mapping.

**Do you need a custom AI model?** No. The existing worker privately polls Ecurious's built-in `GET /api/v1/locks/:id/plate/latest` and matches against the booking HMAC. The response has `plateType`, not confidence. A separate model has an optional private handoff but is not on the critical path. See [recognition integration](MODEL-INTEGRATION.md).

**Why not just write the whitelist?** It changes persistent device auto-access and may lower the barrier; it does not create a timed booking or inject a camera observation. Our guarded worker requires auto-access disabled to keep one lowering controller. A future whitelist-controlled alternative would need durable policy ownership, revocation and uncertain-cleanup handling; existing HMACs cannot reconstruct the raw plate for later installation.

**What happens to plates?** Explain local profile storage, transient Node matching, SQL HMAC/mask, and the separate provider camera system. Show the privacy screen's stated export/delete scopes. Ecurious must complete legal identity/contact, lawful-basis, supplier, camera-notice, retention and rights-fulfilment work. An erasure request is pending review, not deletion. [PRIVACY.md](PRIVACY.md) records controls and gaps; do not claim GDPR compliance from hashing or a demo checkbox.
