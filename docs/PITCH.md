# Demo and pitch rehearsal

**Concept:** BayReady gives an arriving EV driver a reserved bay with a clear deadline and a useful recovery when the bay cannot be provided. No-shows and blocked bays are the two proposed mission areas; agree the final scope with your team after it forms at the event. The starter is a rehearsal tool; swap the script's live claims for actual observations after the hardware integration works.

## Three minute outline

| Time | Show | Say |
| --- | --- | --- |
| 0:00–0:20 | Driver problem | “Knowing where a charger is does not mean the bay will be usable when you arrive.” |
| 0:20–1:25 | Real discovery and full hardware cycle | Find a compatible charger, reserve the mapped bay, show the hardware response, matching plate event, agreed charging evidence, departure and completed release. |
| 1:25–2:05 | No-show and blocked-bay recovery | Show a clearly labelled accelerated deadline and occupied-bay scenario. Explain what prevents a stranded driver and how uncertainty reaches the operator. |
| 2:05–2:35 | CPO value | “Bounded holds and fair expiry are intended to reduce reservation waste. We would measure idle reserved minutes and successful arrivals alongside actual charging utilisation.” |
| 2:35–3:00 | Architecture and next step | Show the adapter boundary, actual limitations, and what another charging app/operator would need to integrate. |

Use the organiser's actual pitch limit. Name any simulated steps explicitly. If live hardware is unavailable during the pitch, use a permitted earlier recording with its context and describe the limitation; it does not automatically replace the required hardware demonstration.

## Rehearsal acceptance checks

1. Happy path: reserve the free bay, expected plate arrives, access is confirmed, charging is evidenced, vehicle departs, booking ends, empty bay returns to the agreed state.
2. No-show: reserve without arrival, advance the labelled demo clock, observe safe expiry. Confirm occupancy before physical actions in the real integration.
3. Blocked bay: simulate an unrelated car; reservation is unavailable or flagged, driver gets an honest status, operator owns recovery. Demonstrate safe clearing and retry only if implemented.
4. Plate uncertainty: submit low confidence or a mismatch; no automatic authorization; demonstrate a corrected observation or explain the manual fallback.
5. Timeout/stale status: explain what is confirmed and what is unknown. Do not describe a capability as implemented unless you tested it.

## Business hypothesis to validate

Try a **€1 reservation fee credited toward charging** and a **€3 disclosed no-show fee**, waived when the operator cannot provide the bay or arrival cannot be determined reliably. These are pitch hypotheses, not market prices, implemented payments, or validated willingness to pay. A retailer could instead sponsor the reservation as a customer benefit.

Track successful check-ins per booking, no-show rate, blocked-arrival rate, reserved idle bay-minutes, and charging minutes divided by available bay-minutes. Compare against a baseline; reservations could lower utilisation if they keep bays empty for too long.

For a transparent scenario: 20 recovered minutes of charging at an assumed average 50 kW is about 16.7 kWh. At an assumed €0.10 contribution per kWh, that is about €1.67 contribution before hardware and operating costs. Every input is illustrative; no uplift has been measured by this starter.

## Short answers to likely judge questions

**What is actually live?** Name the source of directory data, reservation commands, plate events, occupancy, and charging evidence individually. The prepared starter has simulated hardware and charging.

**What if the server times out?** Keep the result uncertain, read authoritative status, and reconcile before retrying a physical command. Explain the actual implementation, including any missing recovery.

**Can another app use it?** A documented reservation service and provider adapter are the path. Map stable station/EVSE/bay and booking IDs, authentication, event delivery, and ownership of state. Do not claim OCPI/OCPP compliance without an implemented, validated mapping.

**Why no custom AI camera model?** The challenge supplies plate-recognition hardware; the product challenge is using its events reliably and handling uncertainty.

**What happens to plates?** Explain exactly what the prototype stores, what the server/hardware stores, who can access it, and the retention agreed with organisers. Masking alone does not establish compliance.
