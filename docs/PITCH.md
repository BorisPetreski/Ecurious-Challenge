# Three-minute BayReady pitch

Use the current **Map → Audimax TUM** flow. Speak the six paragraphs below; stage directions are not spoken. The script is designed for about 2:35 of speech plus 25 seconds of taps and hardware observation. Rehearse once with a timer; let a teammate handle the plate/rig while you speak.

| Time | Display / action |
| --- | --- |
| 0:00–0:20 | Map and the driver problem |
| 0:20–0:45 | Profile preference, filters, then a quick Events preview; label sample events |
| 0:45–1:25 | Audimax → lock-0002 → reserve; teammate presents the matching test plate immediately; show barrier/occupancy |
| 1:25–1:55 | Countdown/extension and scheduled controls; mention lab cases, then leave/clear the physical demo |
| 1:55–2:40 | Buyer, proposed subscription, mock fees and pilot metrics |
| 2:40–3:00 | Next step and closing promise |

## Read-aloud script

> An EV driver can find a charger on a map and still arrive to find its parking space blocked. That uncertainty wastes the driver's time and can cost the operator a charging session. BayReady connects finding a charger with protecting its bay.

> Our mobile app shows real charging locations from GoingElectric. Drivers save a connector preference, filter by charging power and choose a plug. Event planning connects a visit with nearby charging options. We have an Eventbrite integration and clearly labelled sample events for demonstrating that journey.

> Here at Audimax, the app connects to Ecurious's real test barrier. I select our designated bay and reserve it. The app requests raising and registers the selected plate in the hardware whitelist, letting the onboard camera recognise the arriving vehicle. Reported occupancy stops the unused-reservation countdown. At departure, Leave Bay clears the whitelist and requests lowering. This rig demonstrates access control; it does not deliver electricity.

> We compress the arrival window to thirty seconds for this demonstration. Without an arrival, the app releases the hold. Drivers can extend it for a mock one-euro fee or schedule ahead. Our separate multi-car lab demonstrates wrong-car arrivals, competing requests, blocked bays, fallback and refunds. The wider prototype also includes shared Supabase bookings, account access and privacy controls.

> Our buyer is the charging operator, retailer, hotel or event host that wants more successful charging visits. Our starting business proposal is twenty-nine euros per equipped bay per month, with hardware and installation quoted separately. A four-bay site would pay one hundred and sixteen euros monthly for software. Driver fees are experiments, and today's payments are simulated. We want revenue from useful, reliable access, rather than dependence on penalties.

> Next, we connect the working hardware demo to shared booking ownership and reliable server-side scheduling. We pilot with one operator site, measuring successful arrivals, blocked arrivals, empty reserved minutes and net charging contribution. BayReady's promise is simple: find a charger, protect the bay, arrive with confidence.

## Presenter notes

- Present the matching plate immediately after reserving; the demo hold is only thirty seconds. Keep Map foreground throughout. If necessary, use the extension button and explicitly call its fee mock.
- If Eventbrite is configured but returns no matching events, choose **Use demo events** and say those are sample events. Do not present sample dates or attendance as real schedules.
- Public directory listings and shared app holds do not establish real-time vacancy or control public infrastructure. Only the designated Audimax rig is the physical demo.
- The new Audimax hold is local to the phone. The older Supabase/Hardware workflow supplies separate database-backed booking/session features. Do not claim the direct demo already has their cross-user allocation guarantees.
- This path uses native camera whitelist access, not an external YOLO model or app-side latest-OCR comparison. Check what the actual arm/sensor does; HTTP success alone does not prove movement.
- The stage proof is bay access. Charging power/energy and payments are not live. The new direct-map path has no dedicated charging-duration screen.

## Short answers for the judges

**Who pays?** Our proposed buyer is the CPO/site host. €29 per equipped bay/month is a price hypothesis; hardware and installation are separate. Driver fees are an experiment, with mock amounts in the app.

**Does this improve utilisation?** That is a pilot question, not a measured result. Compare recovered usable minutes with empty reserved minutes and actual site charging contribution. The illustrative base model is about **−€11.72/bay/month**, with break-even near **67 recovered usable minutes/day** under its assumptions. We will choose viable sites and pricing rather than claim universal ROI. [Full model](BUSINESS-MODEL.md).

**What if nobody arrives?** The foreground demo timer expires and invokes whitelist cleanup/lowering. The thirty-second schedule is accelerated. The broader product policy is a ten-minute window; production timers need server ownership.

**What if a bay is blocked or another driver books it?** The scenario lab demonstrates blocked-bay/fallback/refund behavior, and the separate database flow provides atomic allocation. The direct phone demo has no shared hardware ownership ledger yet; connecting those parts is the next integration step.

**What makes it different from a charger map?** BayReady connects discovery and arrival planning with physical bay protection and vehicle-specific access.

**How do plates work?** The direct demo sends the plate to the device whitelist. The hardware camera handles matching. Leaving/expiry attempts to clear access. Local profile data and the direct hold use phone storage. Explain the actual provider retention and cleanup scope; do not claim GDPR compliance.

**Why events?** Events create a concrete arrival deadline and a venue buyer. The planner connects an event with nearby charging suggestions; its live feed uses accessible Eventbrite events, while its sample dataset remains labelled.

**Can it work with other operators?** The planned path is explicit location/bay/connector mapping, a shared booking API and provider adapters. OCPI/OCPP compatibility, other operators and production rollout have not been validated.

[Demo runbook](DEMO.md) · [Setup/frameworks](SETUP.md) · [System design](SYSTEM-DESIGN.md) · [All challenge questions](CHALLENGE-WORKFLOW.md)
