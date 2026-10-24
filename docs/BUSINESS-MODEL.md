# BayReady business model

**Prepared for WATT THE HACK, 24 October 2026.** Commercial proposal, not implemented billing or validated market performance. Every BayReady price, demand input, cost, service target and forecast below is an **assumption to test**. Official external examples are cited separately. Amounts charged to drivers are gross customer amounts; B2B prices and operating contribution are net of VAT unless stated otherwise.

## 1. What the challenge requires

The four-page [original brief](../source/challenge-brief.pdf) asks for a public charging reservation feature that makes the bay available on arrival. Page 1 supplies the hardware/server/camera concept and GoingElectric discovery. Pages 2–3 explicitly ask who pays, how reservations and no-shows are priced, how blocked vehicles are handled, and whether utilisation improves. Page 4 assigns **20% to Business Case & CPO Value**, alongside 30% technical implementation, 20% concept, 15% interoperability and 15% documentation. A full real hardware cycle is required for top ranks; a business plan does not replace it.

The PDF was read directly with PDFKit and its four pages checked against the repository text extraction. This proposal addresses normal reservations, no-shows, blocked bays, utilisation and a route to other apps. It does not assume that the prepared simulator already controls hardware, takes payments, charges a real vehicle or implements a standard.

## 2. Business proposition and first customer

**BayReady sells reliable arrival and operator recovery, with short reservations that can be measured against their cost in empty bay time.** The product combines confirmed bay protection, vehicle check-in, short expiry, notifications and an operator workflow when the promise fails.

The first buyer should be a CPO or host with several chargers, recurring access problems, a named site contact and authority over parking. Start with public-facing retail or hospitality sites that have fast DC charging and reachable staff. Drivers obtain convenience; the buyer obtains additional charging contribution and fewer failed arrivals. Retailers may also obtain additional profitable visits, but those visits must be measured separately.

| Customer or partner | Their problem and value | Their commercial role |
| --- | --- | --- |
| EV driver | An apparently available charger can have an unusable bay; failed arrivals waste time | Uses the service; optionally pays a separately disclosed premium |
| CPO | Blocked bays lose charging opportunities; long reservations can also lose them | Primary software buyer; earns energy contribution and owns charging tariffs |
| Retailer/hotel/parking host | Parking conflict, service complaints and lost visits | Co-buyer or sponsor; owns site response and parking authority where agreed |
| Charging app/eMSP | Needs credible bookable inventory and consistent recovery | Distribution/integration partner after one operator works |
| Ecurious/hardware supplier | Needs a reliable software and operational workflow around its equipment | Supplies hardware/API capability under a separately agreed contract |

Do not launch across arbitrary directory stations. An explicitly contracted and verified station/EVSE/bay mapping is a condition of sale. The GoingElectric directory is discovery, not inventory or permission to reserve.

**Segment boundaries:** immediate DC arrival is the first economic experiment. Destination AC can work as a host-sponsored benefit, but lower delivered power changes the business case. Future hotel appointments, overnight parking and fleet shift slots require scheduled inventory and departure rules; they are separate products. An occupied charger is never sold on a prediction of when its current session will finish.

## 3. Recommended prices and who pays

Launch one simple operator-funded offer; test a genuinely paid reservation only at eligible sites where customers value it. Keep the operator's existing electricity and parking tariffs visible and separate.

| Item | Proposed price | Conditions and recipient |
| --- | --- | --- |
| Normal reservation, launch offer | **€0 extra on successful charging** | If a €1 reservation line is used, apply a full €1 charging credit on the same settlement. These cancel; this is not €1 of new revenue. A directly sponsored €0 line is simpler. |
| Optional paid reservation experiment | **€1.99 per successful reservation**, without a charging credit | Replaces the credited offer for the disclosed test. Refund on operator failure; no capture on cancellation or uncertain service. After VAT and processing, 80% to CPO, 20% to BayReady. SaaS remains payable in this scenario. |
| Cancellation before the deadline | **€0** | Immediately free the commercial booking and release the payment authorization; physical recovery follows confirmed safety conditions. |
| Verified no-show | **Up to €3 total** | Replaces the reservation fee; never €3 plus €1 or €1.99. First verified incident in a rolling 90-day window waived. Charge only under a justified, enforceable contract and reliable evidence. CPO receives recovery after tax/processing; BayReady takes no percentage. |
| Operator failure or blocked reserved bay | **€0 reservation/no-show charge** | Release authorization or refund captured reservation amounts. Budget an additional **€2 goodwill credit**, fully costed at face value, for an accepted reservation that cannot be supplied. |
| Software to CPO/host | **€29 per equipped bay per month**, net | Booking, notifications, operator workflow and basic reporting. Minimum initial commercial site: four equipped bays, €116/month. This price is a hypothesis, not a quote or proven willingness to pay. |
| Site onboarding | **€199/site**, net, plus exceptional integration quoted separately | Assume €199 delivery cost and no margin. Waive only within an explicitly funded pilot budget. |
| Hardware and installation | Quoted separately, initially at cost | Placeholder **€1,200 installed per equipped bay** is used only for sensitivity. Obtain supplier, civil works, connectivity, maintenance and replacement terms before selling. No hardware is promised at this price. |

**Recommended money flow:** CPO/charging partner remains the charging merchant and energy seller; BayReady invoices software B2B. Prefer existing charging checkout, with a reservation authorization and eventual single settlement, rather than another standalone microcharge. If the partners cannot apply the €1 charging credit reliably, use the sponsored €0 offer instead. A card authorization is neither revenue nor a completed payment.

In a retail-sponsored arrangement the retailer can pay the €29 directly. That saves the CPO that cost but does not eliminate it for the combined business. At an assumed €4 incremental retail contribution per extra visit, €29 requires at least eight genuinely additional visits per bay/month to cover software alone. Existing shoppers and existing charging revenue cannot be counted again.

**Illustrative customer bill:** 20 kWh at an assumed €0.59/kWh is €11.80. The credited offer is €11.80 + €1 − €1 = **€11.80**; paid mode is **€13.79**. A verified no-show costs at most **€3 total**, with no electricity charge. A blocked-bay failure costs **€0 for the reservation**. The energy price is an example, not a recommended tariff or prediction.

## 4. Normal reservation rules

1. Offer an immediate hold only for a correctly mapped, compatible, authoritatively available bay with fresh occupancy/hardware status. Show connector, power information, exact deadline, energy/parking prices, reservation charges, refund policy and operator contact.
2. Allow one active booking per account. Obtain any required payment authorization, then confirm availability and the hardware outcome. Display “confirmed” only when the documented physical reservation state is confirmed; otherwise show pending/failed and release the authorization on failure.
3. The hold lasts **10 minutes total from confirmed reservation**, with reminders at minutes 5 and 8. The final two minutes are the included grace period. It is **not 10 minutes plus extra grace**. No automatic extensions or speculative future reservations at launch.
4. Accept reliable arrival evidence timestamped at or before the deadline. A timely app check-in or arrival claim freezes automatic penalty billing while evidence is reconciled. Corrected plate/manual verification must be possible; GPS is optional assistance, not proof of identity or absence.
5. Confirm usable access, then obtain the agreed charging evidence. Arrival without charging is not a no-show. In the initial commercial experiment, charge no reservation fee if no successful charging service is established; address repeated deliberate abuse through booking eligibility review.
6. On completion, end the booking and confirm departure/empty state before any physical reset required by the documented interlocks. Charging does not end merely because a reservation timer expires.

At a four-bay site, begin with at most **one outstanding empty hold at a time**. Already charging vehicles do not consume this empty-hold quota; their bays remain occupied and unavailable. All four equipped bays may serve walk-ins through an operator-approved access route. Track that access and its cost; reservation membership must not be the only way to use remaining public capacity. For one-bay or two-bay sites, pilot separately rather than rounding a 25% policy into a blanket reservation of scarce capacity.

Hardware enforcement, reminders, payment authorization, capacity quotas and credits in this section are production proposals. The starter's ten-minute simulator default is not evidence that these policies are commercially right or live.

## 5. No-shows: fair release and limited loss recovery

A booking expiring and a billable no-show are different decisions. At ten minutes, end the commercial hold if no timely arrival was accepted. A timer does not prove an empty bay, a safe barrier position or driver fault.

Bill only when all relevant facts are reliable: the reservation was confirmed, the promised bay/charger remained usable, no timely arrival or unresolved claim exists, delayed trusted events have been reconciled, the driver accepted the terms, and no system/recognition failure explains the outcome. Review unclear cases within a proposed 24 hours; waive the fee if uncertainty remains. Never bill from a missing camera event alone.

| Outcome | Customer treatment | Commercial control |
| --- | --- | --- |
| Driver cancels before expiry | €0; release authorization | Count any empty hold minutes before cancellation in the economics |
| First verified no-show in a rolling 90-day window | Waive; explain why timely cancellation helps | Record an account-level incident without retaining unnecessary plate data; the lookback is a policy hypothesis requiring a justified retention design |
| Subsequent verified no-show in that window | Up to €3 total under justified terms | One capture only; allow dispute and proof of lower/no loss where applicable |
| Repeated holds intended to monopolize capacity | Eligibility review; proposed 20-minute cooldown after two consecutive reliably verified driver-caused no-shows or abusive holds | Exclude operator failures, timely arrival claims and unresolved evidence. Explain the rule and provide review for recognition/accessibility errors; do not escalate fees automatically |
| Timely arrival, different car, low confidence or disputed event | Freeze billing and verify | No automatic rejection/no-show charge |
| Operator cannot prove availability throughout the promise | €0 | Record operator failure or uncertain service, not driver fault |

**€3 is a proposed ceiling, not proof of a recoverable €3 loss.** Under the base assumptions, ten lost charging minutes have an opportunity contribution of only `10 × 65% × 45/60 × €0.12 = €0.585`. Add only support/processing losses that actually qualify; do not invent administration costs to justify a penalty. AC could justify less. German standard-term rules restrict certain penalties and excessive liquidated damages and require an express opportunity to establish lower/no loss in relevant damage clauses. Fee classification and terms need review against [BGB §309, especially items 5–6](https://www.gesetze-im-internet.de/bgb/__309.html).

The calculator excludes all no-show recovery from core ROI. Its optional overlay assumes only half the six monthly no-shows are billable after waivers, and a provisional VAT treatment. Actual tax treatment may differ by contractual classification; deposits, damages and service payments are not interchangeable.

## 6. Blocked bays, responsibility and overstay

Prevent promises that cannot be delivered: occupied, charging, stale or unknown bays are unavailable for immediate reservation. Plate recognition identifies a vehicle observation; it does not establish wrongdoing, payment authority or permission to move hardware.

| Situation | Customer promise | Site/operator action |
| --- | --- | --- |
| Vehicle already charging before a booking | Do not sell the immediate hold | Protect the incumbent session; wait for observed departure |
| Vehicle present but charging status unclear | Unavailable, with an honest status | Verify occupancy and charger state; do not label it an offender automatically |
| Unrelated vehicle blocks an accepted hold | Notify driver immediately; €0 reservation fee | Named host contact verifies and manages lawful site enforcement |
| Earlier legitimate session overruns | Treat as inventory/service failure for the incoming driver | Preserve incumbent charging and recover the incoming booking |
| Expected plate is uncertain/mismatched | Preserve timely arrival claim | Authenticated plate correction or manual verification, with safe access procedure |
| Telemetry, charger or hardware fails | Stop new bookings; freeze penalty decisions | Reconcile authoritative state; use documented interlocks |
| Bay clears after failure | Offer a newly verified booking if useful | Confirm empty/usable state; do not assume that an accepted command cleared it |

Proposed service targets: operator acknowledgment within **60 seconds**, then a verified alternative or clear recovery decision within **five minutes**. These are pilot targets, not guaranteed response times. Offer another bay only when it has a current verified reservable mapping; a GoingElectric listing is not a replacement guarantee. If no alternative can be supplied, release/refund all reservation charges and offer the €2 goodwill credit. Do not substitute a future credit for a refund owed in cash. Define any exceptional expense reimbursement in the contract; do not promise unlimited travel reimbursement.

The CPO/host owns bay inventory, parking rights, signage and the site response. BayReady owns booking state, notices, evidence correlation and the billing/refund workflow. Hardware/API providers own documented equipment capabilities under their contract. Payment partners own collection and settlement under theirs. The buyer needs one support contact and a written responsibility matrix even if suppliers later allocate the cost between themselves.

**Overstay is separate from an incoming driver's no-show.** Prefer the site's existing disclosed charging/parking policy. If a new idle policy is needed, test €0.10/min only after reliable charging completion plus ten minutes to return, capped at €12/event, with advance warning and appropriate operating-hour/accessibility exceptions. Do not apply a fast-DC policy unchanged to overnight destination AC. Do not duplicate an existing CPO idle charge, charge the waiting driver for the blocker, interrupt charging automatically, or try to debit an unidentified third party from its plate. Idle/enforcement proceeds are excluded from ROI.

## 7. Current primary-source benchmarks

Official pages consulted during this work on 24 October 2026; recheck market-specific terms before deployment. These examples establish actual practices, not German willingness to pay for BayReady.

| Source | Relevant practice | Implication and boundary |
| --- | --- | --- |
| [incharge Greece drivers' club](https://www.incharge.gr/en/drivers-club/) | Selected DC sites with at least four points; Premium reservation access; €3 no-show off-highway and €6 on highways; limits on reservable capacity | Direct European reservation precedent; different country, membership and sites |
| [Enel vehicle charging FAQ](https://www.enel.it/en-us/assistenza/mobilita-elettrica/ricarica-veicoli) | Eligible bookings last 15 minutes, with automatic expiry and a single concurrent booking | Supports a short hold and anti-monopolisation experiment; does not demonstrate protected physical space |
| [EnBW blocking-fee FAQ](https://www.enbw.com/service/faq/e-mobilitaet/blockiergebuehr/) | €0.10/min after four connected hours, capped at €12/session, including AC/DC | A German cap/disclosure comparison; its timing is different from a post-charge idle fee |
| [Tesla Germany fees](https://www.tesla.com/de_de/support/charging/supercharger/fees) | Conditional congestion charging at busy Supercharger sites; five-minute grace | Fast-charging congestion is distinct from no-shows and destination AC |
| [Stripe Germany pricing](https://stripe.com/de/pricing) | Standard EEA online cards: 1.5% + €0.25/successful payment; original processing fees are not returned on refunds | Separate microcharges are costly; this tariff does not quote authorization/Connect/settlement costs for our design |

Reservations can hurt throughput. [Electra's February 2026 article](https://www.go-electra.com/en/newsroom/ev-charging-avoid-waiting-at-stations/) describes removing reservations because empty reserved chargers freeze capacity; a [May 2026 Dutch help article](https://intercom.help/go-electra/nl/articles/8385337-een-reservering-annuleren) still describes reservations in several markets. Those sources conflict on current availability. The useful lesson is to test net capacity effects, not infer that reservations always improve utilisation.

Keep the optional reservation service distinct from ad hoc electricity pricing. The [European Commission AFIR Q&A, especially 5.16–5.22](https://transport.ec.europa.eu/transport-themes/clean-transport/alternative-fuels-sustainable-mobility-europe/alternative-fuels-infrastructure/questions-and-answers-regulation-deployment-alternative-fuels-infrastructure-eu-20231804_en) distinguishes charging-price requirements, occupancy fees and reservation services; it is guidance, not an approval of this product. Confirm the actual site's payment/display obligations and preserve required ad hoc access. No OCPI/OCPP or GDPR compliance is claimed here.

## 8. CPO unit economics: count charging contribution, not bookings

The reproducible model is [assumptions.json](business-model/assumptions.json), [scenario CSV](business-model/scenarios.csv) and [calculator](../scripts/business-model.mjs). All cases use one 30-day month and four equipped bays per site. The table below is **per bay**; outcomes are mutually exclusive and include cancellations.

| Base-case input | Illustrative value |
| --- | ---: |
| Reservations | 4/day, 120/month |
| Successful / no-show / operator failure / cancellation | 85% / 5% / 5% / 5% = 102 / 6 / 6 / 6 |
| Average empty hold for those outcomes | 6 / 10 / 3 / 3 minutes |
| Total deliberately held empty time | **708 minutes/month** |
| Gross restored usable bay availability | 60 minutes/day, **1,800/month** |
| Demand during restored and held time | 65% each |
| Average delivered power during incremental charging | 45 kW; not the charger nameplate |
| Contribution per extra kWh | €0.12 after electricity, grid/roaming and normal charging-payment variable costs |
| SaaS / installed hardware allocation / local operations | €29 / €1,200 ÷ 48 = €25 / €6 per month |
| Reservation authorization/reconciliation cost | Assumed €0.03 × 120 = €3.60/month; not a supplier quote |
| Goodwill cost | €2 × 6 operator failures = €12/month; full face value conservatively costed |

Gross restored availability means time that would otherwise be unusable due to preventable blocking or operational delay. It is not already measured charging uplift. Do not count a generic reduction in no-shows against a walk-in baseline that had no reservations. For an existing reservation system, count only its measured improvement and use its holds as the appropriate counterfactual.

Use separate demand factors when recovered time and withheld time occur in different conditions:

```text
R = previously unusable bay-minutes restored by the service
H = empty bay-minutes deliberately withheld for reservations
qr = probability recovered time could serve charging demand
qh = probability held time would otherwise have served charging demand
P = average delivered charging power, kW
m = contribution per incremental kWh, net

incremental charging minutes = qr × R − qh × H
incremental kWh = incremental charging minutes × P / 60
incremental energy contribution = incremental kWh × m
core CPO result = energy contribution − SaaS − hardware allocation
                  − local operations − reservation payment costs − goodwill
```

Preserve negative results. A hold that displaces charging is a cost even if its customer eventually charges. Reconcile simultaneous and causally overlapping minutes so that restored availability and hold loss are not double counted. Energy moved from another bay at the same site is not new site energy; measure substitution across the whole site and, where relevant, the operator network.

**Base calculation:** `(1,800 − 708) × 65% = 709.8` incremental charging minutes, giving **532.35 kWh** and **€63.88 charging contribution**. Costs total **€75.60**. The result is **−€11.72/bay/month**, or **−€46.87 for four bays**, before financing, corporate tax and any omitted costs. This base case does **not** support a general rollout of the credited offer.

| Scenario | Restored min/day | Demand restored / held | Delivered kW | Margin/kWh | Core result/bay/month | Four-bay site/month |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Downside | 15 | 35% / 35% | 20 | €0.08 | **−€78.01** | **−€312.03** |
| Base | 60 | 65% / 65% | 45 | €0.12 | **−€11.72** | **−€46.87** |
| Upside | 120 | 85% / 85% | 60 | €0.18 | **€366.88** | **€1,467.50** |
| Peak-hold stress | 60 | 65% / 90% | 45 | €0.12 | **−€27.65** | **−€110.59** |

These are scenarios, not likelihood-weighted forecasts. For AC, replacing 45 kW with an assumed 7 kW at otherwise base inputs gives only **€9.94 energy contribution** and about **−€65.66/bay/month**. That calls for a host benefit, much cheaper equipment, different usage or a paid offer; do not sell AC on the DC numbers.

At the other base inputs, break-even without penalties requires approximately **66.68 restored usable minutes/day**, or contribution of **€0.142/kWh**, or SaaS no higher than **€17.28/month**, or installed hardware no higher than **€637.54 over 48 months**. Each changes one input at a time; none is a supplier promise. Require a margin of safety above bare break-even.

The base cash contribution before hardware allocation is **€13.28/month**. Paying €1,200 upfront would take **90.35 months** to recover at that rate, longer than the assumed 48-month life. A monthly allocation is not cash flow or a financing quote. Installation, civil works, connectivity, maintenance, replacements, insurance, support, integration and field call-outs must fit inside the placeholder budgets or be added. Six monthly failures alone could exhaust the €6 operations allowance.

### Payment and fee overlays

At the cited card tariff, a standalone €1 capture costs €0.265. Capturing and later refunding it for every booking wastes processing cost. The €0.03 authorization assumption is a distinct, unquoted placeholder, not a discounted Stripe capture price. Confirm authentication, authorization, Connect, refunds, disputes and partner settlement costs before relying on it.

For the paid experiment, assume 19% VAT for modelling only and separate fee processing:

```text
€1.99 / 1.19 − (€0.25 + 1.5% × €1.99) = €1.39242 pool/success
102 successes × pool × 80% = €113.62/month to CPO
102 successes × pool × 20% = €28.41/month to BayReady
```

That would change base CPO contribution to **€101.90/month**, excluding no-shows, **if the same 102 drivers still buy**. It is not a forecast: charging uptake and bookings can fall at this price. Test conversion and total site contribution. Do not apply the paid fee and the credited offer to the same booking, and do not confuse gross €1.99 sales with the platform's share.

Paid fees can make the financial result positive even when charging energy falls, as in the downside scenario. That is fee income, not evidence that reservations improve utilisation. Report both outcomes.

The optional no-show overlay bills half of six incidents after waivers. At a provisional 19% VAT treatment and a €0.295 capture cost, recovery is approximately **€6.68/bay/month**; core remains negative at **−€5.04** even with that recovery. If every incident were billed it would add €13.36, barely making base positive. This is why deployment cannot depend on penalty income. Treat any actual tax classification or lower justified charge as a change to the model, not guaranteed revenue.

## 9. BayReady revenue, costs and scale

Recurring SaaS is the primary revenue. Optional paid reservations are incremental, validated only after a price test. Hardware is initially pass-through, no-show receipts belong to the operator, and charging receipts belong to the charging merchant. Avoid a percentage of an electricity bill when the product has not proved incremental value.

| Platform input or result | Illustrative value |
| --- | ---: |
| SaaS revenue per equipped bay/month | €29 |
| Variable delivery cost/bay/month | €8, placeholder for hosting, event processing and platform support; excludes CPO-paid site/payment costs |
| SaaS contribution/bay/month | **€21**, or 72.4% before fixed costs |
| Lean team, administration and product fixed cost/month | €18,000 assumed |
| Operating break-even | **858 active paid bays**, about 215 four-bay sites |
| Acquisition cost per bay | €120, or €480/four-bay site, assumed fully loaded |
| Acquisition payback | **5.71 months** at €21 monthly contribution |
| Assumed customer life / contribution LTV | 36 months / €756 |
| LTV/CAC | **6.3**, before discounting; no measured retention or sales performance |

SaaS break-even excludes onboarding investment, working capital, hardware inventory/financing, taxes and additional growth acquisition spending. A 215-site installed base is not a sales forecast. If variable support is €15 rather than €8, contribution falls to €14 and the same fixed budget requires 1,286 bays. Fund a limited pilot and staged deployments; avoid financing hardware inventory before acceptance and a viable buyer contract.

Use a bottom-up addressable market: count contracted/approachable CPOs, eligible sites, bays, hardware rights and plausible annual wins. For illustration, 50 sites × 4 bays × €29 is only **€5,800 MRR / €69,600 annual recurring revenue**, not the size of the European market. Obtain that pipeline from real sales conversations before presenting a market-size claim.

Initial acquisition channels: a joint hardware/CPO pilot, direct site-owner outreach, then the operator's existing app and retailer loyalty channels. Avoid paid consumer acquisition until there is useful local inventory. Later app partners need common booking ownership, settlement, authenticated events and a tested provider adapter. Quote partner access/commissions after integration costs are understood rather than inventing an additional royalty for the pitch.

The defensible asset would be reliable contracted inventory, measured recovery operations and reusable integrations. A map, countdown or public directory listing alone is easy to reproduce. Publish enough of the interface to integrate fairly; distinguish protocol compatibility ambitions from validated implementations.

## 10. Validation plan and go/no-go rules

**At the hackathon:** demonstrate the actual reserve → reliable vehicle check-in → agreed charging evidence → safe release cycle, then no-show and blocked-bay recovery. Explain proposed fee outcomes with fictional receipts; do not take real payments. Record actual hardware/API evidence in [BUILD-LOG.md](BUILD-LOG.md). Current reservation/charging controls are simulated, payments do not exist, real Ecurious diagnostics are read-only, and the native map retrieves GoingElectric directory data directly.

**First 30 days after a willing partner agrees:** confirm supplier/installed cost, legal parking authority, merchant/credit settlement, charger/occupancy events, support costs and customer terms. Interview at least ten drivers and three buyer/site contacts as a discovery target, not evidence of traction. Instrument actual delivered energy, blocking time and staff workload. Use at least two comparable sites or matched/randomized site-days where practical.

**Next 30–60 days:** compare ordinary operation, hardware protection with walk-in access, and protection plus ten-minute reservations. The hardware-only comparison separates hardware value from reservation value. Run a disclosed credited/sponsored versus €1.99 experiment only after reliable service exists, with capacity allocation and day/time kept comparable. Continue until outcome uncertainty is useful for a decision; do not claim statistical significance from a handful of incidents.

| KPI | Definition and decision use |
| --- | --- |
| Net charging contribution/site/day | Actual energy contribution minus all incremental service costs versus a matched counterfactual; primary economic outcome, excluding penalties |
| Charging utilisation | Charging minutes / serviceable bay-minutes; also publish availability vs scheduled calendar capacity so downtime cannot improve the ratio artificially |
| Net incremental kWh | Actual site kWh difference against comparable control; do not label all reserved-session kWh as incremental |
| Empty reservation cost | Actual empty held minutes, including cancellations and failed reservations, and estimated displaced walk-in contribution |
| No-show rate | Verified driver no-shows / confirmed reservations; report waivers, cancellations, failures and unresolved cases separately |
| Promise failure rate | Accepted bookings that cannot supply usable access/charging / confirmed bookings; separate blocking, hardware and charger causes |
| Arrival success rate | Arriving booked drivers receiving usable service / arriving booked drivers, with uncertainty shown |
| Recovery and fairness | Acknowledgment/recovery times, refunds, support minutes, disputes, low-confidence plate/manual cases and erroneous charges |
| Paid conversion | Completed paid services / eligible offers, and total contribution compared with sponsored offers |

Proposed go/no-go conditions: an evidenced safe full cycle; no unresolved erroneous automatic no-show charges; at least **98% usable service for accepted bookings** as an initial reliability target; and positive contribution excluding penalties with enough headroom for measured support and hardware costs. The numerical base case's assumed failure rate does not meet that target. If uptake or delivered contribution is weak, shorten/cap holds, select better sites, lower cost, find a measured host benefit or stop charging for the service. Do not solve a weak charging business by increasing penalties.

Plate/location data minimisation, roles, notices, retention, access and hardware-side processing require explicit agreements. A proposed 24-hour billing review does not authorize a 24-hour camera-image archive. Use fictional plates in demonstrations; retain only necessary disputed-event evidence under the agreed policy. Masking or hashing does not by itself prove anonymity or legal compliance.

## 11. Pitch and commercial decision

> BayReady helps drivers arrive at a usable charging bay and gives operators a measured way to recover lost charging opportunities. We propose a ten-minute hold, no extra fee when a sponsored reservation succeeds, and at most €3 for a reliably established no-show under fair terms. If the operator cannot supply the bay, the driver pays no reservation charge and receives recovery help. Operators pay €29 per equipped bay monthly; a €1.99 paid offer is a separate experiment. We measure added charging contribution after subtracting empty hold time. Our conservative case is slightly negative, so we would deploy only where a pilot proves the value or a host funds a measured benefit.

The commercial decision is **pilot first, select sites on evidence, then price the delivered value**. The strongest jury argument is the explicit trade-off and a testable model, alongside the required real hardware cycle. Neither no-show penalties nor assumed utilisation uplift should carry the business case.

## Recalculate

From the repository root:

```sh
node scripts/business-model.mjs
node scripts/business-model.mjs --csv > docs/business-model/scenarios.csv
```

Edit [assumptions.json](business-model/assumptions.json) or supply `--assumptions /path/to/alternative.json`. Outcome rates must total one. Results remain incremental monthly scenarios; deposits/authorizations are not revenue, negative energy effects are retained, the credited €1 contributes zero new fee revenue, and penalties are outside core results.
