# Designated bay lifecycle

The `/hardware` mobile screen is separate from directory app-slot holds, fictional registered inventory and the `/reserve` simulator. It uses the authenticated Node workflow routes and the backend's designated lock allowlist. Hardware credentials and the private database worker key remain on the backend.

The mobile client and the guarded workflow implementation are prepared locally. Hosted schema activation, operator enrollment/interlock confirmation and a recorded physical cycle remain deployment/verification work. A command acknowledgement does not establish completed movement, recognized arrival or charging. See [ECURIOUS-API.md](ECURIOUS-API.md), [SYSTEM-DESIGN.md](SYSTEM-DESIGN.md) and [DATABASE.md](DATABASE.md).

## Implemented mobile behavior

Activity's read-only hardware panel links to the designated-bay screen. That screen shows three independent facts:

- The application reservation owner and server deadline; another holder's reservation ID is not exposed.
- Barrier/occupancy observations and their provider timestamp. Old or missing observations display unknown.
- The backend workflow phase and command status. An acknowledged command stays awaiting hardware observation; an uncertain outcome stays unknown.

The preferred profile connector filters enabled choices. A new hold requires a complete local profile, selected connector and a deliberate confirmation. The default hold is ten minutes; five and fifteen are also available. The SQL reservation clock starts when the backend records the reservation, including any time spent awaiting protection. Confirmation displays a masked plate and mock payment preference; no contact details, plate, payment data or hardware credential is sent with the request.

The client sends only a registered bay/connector, duration and request UUID for reservation, or the owning reservation ID and entry/release intent for actions. The backend's authenticated ownership and capability checks remain authoritative. Entry is manual owner-requested opening: this UI does not identify a vehicle or establish a plate match.

| Backend phase | Mobile interpretation |
| --- | --- |
| `idle` | No active hardware reservation reported; reservation is offered only when allowed by backend capabilities |
| `protect_pending`, `protecting` | Protection requested; no physical protection success is claimed |
| `protected` | Backend reports confirmed protection, separately from the current sensor snapshot |
| `entry_pending`, `entering` | Entry opening requested; waiting for observation |
| `entry_open` | Backend reports confirmed entry opening; arrival identity and charging remain unverified |
| `release_pending`, `releasing` | Cancellation/release intent is pending; the bay is not declared reusable |
| `blocked` | Occupancy, fault, access policy or changed state requires recovery; keep reservation context visible |
| `uncertain` | Outcome is unresolved; reconcile state before any further movement |

Workflow reads poll every five seconds while the app is in the foreground. Actions pause after fifteen seconds without a successful workflow read. This is a client connection policy, separate from the worker's stricter telemetry/interlock policy. Mutations serialize locally, are never automatically retried and are followed by a read even after an unknown outcome. Database allocation and worker claims handle cross-phone/process races; disabling a button alone does not provide exclusivity.

The owner can request entry or cancellation/release only when the backend permits it. A pending cancellation is an intent, not proof that physical cleanup has completed. The UI never substitutes a local state transition for backend confirmation.

## Blocked bays

The prepared backend preflight checks occupancy, fresh telemetry, faults and the protection access policy. A fresh occupied report, hardware fault or unsafe access policy blocks movement. Unknown observations preserve recovery state. The mobile screen displays the reason and asks for operator inspection; it does not infer an empty bay from missing plate events.

The reservation owner and original context stay visible during recovery. Release requests still depend on backend capabilities and reconciliation. A blocked bay must not become available merely because the owner cancelled, the phone disconnected or its countdown elapsed.

Operator escalation, alternate verified bay suggestions and any compensation policy remain product proposals. There is no implemented support dispatch, automatic rerouting or automatic blocked-bay fee.

## No-shows and deadlines

The UI counts down using backend time. At zero it displays **Deadline reached · checking the bay**. It does not mark the bay free, move the barrier or decide that the driver failed to arrive.

The prepared server/worker owns deadline reconciliation. Safe cancellation/no-show handling requires a consistent reservation phase, fresh occupancy and confirmed physical cleanup. Occupied, stale or uncertain physical state retains a recovery guard instead of creating another bookable allocation. A missing recognition event is never sufficient evidence of no-show or vacancy.

The ten-minute default is an application policy for the team to confirm. A future arrival workflow should stop the no-show clock only after trusted, booking-correlated arrival evidence. Camera-event verification, plate-rule lifecycle, charging evidence, reminders and an agreed operator recovery path are still required for a full physical journey. This screen does not claim those features are complete.

No automatic no-show fee or real payment is implemented. A lowered barrier, occupied sensor or elapsed app deadline cannot establish charging, departure, vacancy or compliance.

## Verification boundary

Mobile TypeScript checks cover the screen/client contract at build time. Backend and database tests must establish allocation races, ownership, claim fencing and uncertain command recovery. Neither those tests nor a production Android bundle proves safe hardware movement. Record the first supervised reserve → observed protection → arrival/entry → agreed charging evidence → observed release cycle, including a blocked-bay and expired-hold recovery, in [BUILD-LOG.md](BUILD-LOG.md).
