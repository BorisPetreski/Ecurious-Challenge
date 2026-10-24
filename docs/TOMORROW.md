# Your plan for WATT THE HACK

Teams form at the event tomorrow. You plan to contribute coding; agree responsibilities after meeting the team. Bring BayReady as an optional starting point, and choose the stack and mission areas together. The proposed goal is one reliable hardware demonstration plus thoughtful handling of no-shows and blocked bays.

## Event and arrival

**Saturday 24 October 2026, 09:00–19:00, Europe/Berlin.** TUM's main campus, Arcisstraße 21, 80333 Munich; the Munich Climate Week listing names the Audimax. Aim to arrive around 08:30–08:45, subject to the check-in information in your ticket. The start/end times are published; the work blocks below are a suggested team schedule, not an official agenda. [TUM event](https://www.tum.de/aktuelles/veranstaltungen/details/energie-ki-hackathon-watt-the-hack), [event registration](https://luma.com/mcw2026-foj2), [Climate Week venue listing](https://www.munichclimateweek.de/de/event-calendar/event/watt-the-hack-energy-ai-hackathon-evt-ffoqkynos5glo34).

## Tonight in 45 minutes

- [ ] Run `npm run doctor`, `npm test`, and `npm start`; complete the simulator cycle once.
- [ ] Rehearse expiry and blocking once. Read the first-hour integration checklist below.
- [ ] Prepare a short introduction explaining your coding strengths and the starter you can offer. Treat no-shows + blocked bays as a proposal for tomorrow's team discussion.
- [ ] Confirm registration, check-in room, submission format, pitch length, and the rules for reusing prepared starter code from your event materials or organisers. This is a prepared starter, so disclose its origin if required.
- [ ] Charge laptop and phone. Pack laptop charger, USB-C hub/HDMI adapter, phone cable, headphones, water, and a power bank if available. Keep hotspot access ready.
- [ ] Open this folder in your editor and keep the source PDF available offline. Be ready to show the simulator and explain its limitations.
- [ ] Keep the local repository ready to share. Choose a team remote and check other developers' setup after the team forms.
- [ ] Stop adding features and get some sleep.

## After your team forms

Spend the first 10–15 minutes comparing skills, understanding the challenge, and agreeing on one achievable demo. Offer the starter and its reasoning, then adapt to the team's preferences and the event's reuse rules.

Agree who owns hardware/backend integration, the app and discovery experience, and documentation/business/pitch. Combine responsibilities according to team size. If you take hardware integration, ask someone to record mentor answers and test observations while you code. Confirm the mission areas, stack, shared repository, and submission deadline before splitting up.

## Requirements that decide your scope

The supplied brief requires a charger discovery prototype using GoingElectric, the full app ↔ Ecurious server ↔ hardware reservation cycle, plate-based arrival, process documentation, answers to at least two mission areas, and limitations/scaling ideas. A full live hardware cycle is a prerequisite for the top ranks.

| Jury criterion | Weight | Evidence to show |
| --- | ---: | --- |
| Technical implementation | 30% | Real bay responds; confirmed arrival; charging evidence; safe release; edge cases |
| Concept and innovation | 20% | A clear arrival promise and practical recovery when it fails |
| Business and CPO value | 20% | A fee hypothesis, fair exceptions, and measurable operator outcomes |
| Interoperability and scalability | 15% | Separate hardware adapter, clear identifiers, documented event and API contract |
| Documentation and pitch | 15% | Build log, architecture, actual requests, failures, concise live demo |

The technical score is the tie-breaker. Polish follows a working integration. [Challenge brief, pages 2–4](../source/challenge-brief.pdf).

## First hour with an Ecurious mentor

Have a teammate record the answers in `BUILD-LOG.md` while you test the smallest documented operation.

1. Get the test server URL, documentation, authentication method, permitted test bay ID, network/VPN requirements, and hardware access window.
2. **Clarify “release”:** does it open the physical barrier for arrival, finish a booking, or both? Which command keeps an empty bay protected? Which sensor/interlock prevents unsafe movement?
3. Ask what proves “charge” for judging. Is actual charger control available, or do they accept an observed/test charging phase? A reservation barrier cannot itself start EVSE power delivery.
4. Find plate events: polling, WebSocket, webhook, or another mechanism? What event IDs, confidence values, timestamps, and booking correlations are supplied? How is event authenticity established?
5. Determine whether responses mean command accepted or physical action confirmed. Ask how to recover from timeouts, stale status, duplicate events, no-shows, and simultaneous reservations.
6. Confirm GoingElectric access and approved app/browser usage. Request a key or the approved access process; test browser CORS early.
7. Confirm the test vehicle/plate, who may move the hardware, allowed data handling, and how to demonstrate blocking safely.

**First coding milestone:** one documented status read and one safe reserve/release interaction on the designated test bay. Record the exact request shape with credentials removed. If access fails, escalate to a mentor promptly while a teammate works on discovery and the pitch.

## Suggested build blocks

| Time | Your coding focus | Teammate output |
| --- | --- | --- |
| 09:00–10:00 | Team formation, roles/scope agreement, then access and first status read as time permits | Shared approach, mentor answers, test vehicle |
| 10:00–12:00 | Smallest real reserve → plate arrival → charge evidence → release cycle | UX copy, GoingElectric access, diagram, continuous build notes |
| 12:00–13:30 | Wire UI, discovery, and explicit station-to-bay mapping | Draft pitch and value hypothesis |
| 13:30–15:00 | No-show timer, occupied bay, plate uncertainty, status/error handling | Test scenarios and observed results |
| 15:00–16:00 | Stabilize and check real cycle again | Explain interoperability and KPIs; prepare submission |
| 16:00 onward | Freeze features and fix only demo blockers | Rehearse within official pitch limit; capture permitted backup evidence |

Move these blocks around the official talks, breaks, judging, and submission deadline. If the real cycle is late, drop everything except that cycle, basic discovery, the two mission-area explanations, and documentation.

## Scope agreement

**Build:** one real mapped bay, one current reservation per bay, a clear deadline, plate arrival, known/unknown status, safe expiry/cancellation, and a blocked-bay message with an operator escalation/retry option.

**Explain and measure:** no-show policy, operator responsibility when a bay is unavailable, utilisation KPIs, and how another app could use the reservation service.

Keep payments, accounts, route optimisation, a custom OCR model, roaming implementation, and multi-location deployment for later. Do not infer live charging availability from a station-directory entry.

## Five terms to know

- **CPO:** charge point operator, who operates charging infrastructure.
- **EVSE:** the charging equipment; one location may contain several EVSEs/connectors and parking bays.
- **GoingElectric:** station discovery data; a directory record does not prove a specific bay is free now.
- **Ecurious:** the provided reservation hardware/server; its actual API is the integration you need tomorrow.
- **OCPP / OCPI:** possible future integration standards. An adapter design is a scaling plan, not evidence of compliance.
