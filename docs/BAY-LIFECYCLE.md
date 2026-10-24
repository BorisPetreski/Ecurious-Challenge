# Designated bay lifecycle

The `/hardware` mobile screen is separate from directory app-slot holds, fictional registered inventory and the `/reserve` simulator. It uses the authenticated Node workflow routes and the backend's designated lock allowlist. Hardware credentials and the private database worker key remain on the backend.

The mobile client and the guarded workflow implementation are prepared, and hosted schema/Auth are configured. Barrier-only `lock-0002` is enrolled; the user relayed operator interlock/OCR confirmations and exclusive team use. Direct API raise/lower and worker cleanup have newer matching device reports. A genuinely fresh vacant/lowered report restored activation at **14:22:21.966 UTC** after a telemetry pause. The complete customer plate/occupancy/departure cycle remains unverified. A booking intent or command acknowledgement alone does not establish completed movement, recognized arrival or charging. See [the app walkthrough](LOCK-0002-WALKTHROUGH.md), [ECURIOUS-API.md](ECURIOUS-API.md), [SYSTEM-DESIGN.md](SYSTEM-DESIGN.md) and [DATABASE.md](DATABASE.md).

## Implemented mobile behavior

Activity's read-only hardware panel links to the designated-bay screen. That screen shows three independent facts:

- The application reservation owner and server deadline; another holder's reservation ID is not exposed.
- Barrier/occupancy observations and their provider timestamp. Old or missing observations display unknown.
- The backend workflow phase and command status. An acknowledged command stays awaiting hardware observation; an uncertain outcome stays unknown.

The preferred profile connector filters enabled choices. A new time slot requires a complete local profile, selected connector, arrival time and a matching server mock quote before confirmation. Initial arrival windows last ten minutes and start within seven days; paid ten-minute additions extend an unused hold. The form uses Berlin times with explicit daylight-saving offsets. See [scheduled sessions and account flow](SCHEDULED-SESSIONS.md).

The final hardware booking sends its resource/window/request ID and plate to the backend. Only a keyed fingerprint and masked suffix reach SQL; contacts and mock payment stay on the phone. Once protection is confirmed, a fresh matching recognition can queue guarded entry. A later fresh occupied sample after authorized entry records arrival; a newer vacant sample records departure and requests cleanup. The old immediate/manual path remains a compatibility prototype and cannot open a plate-bound scheduled booking manually.

| Backend phase | Mobile interpretation |
| --- | --- |
| `idle` | No active hardware reservation reported; reservation is offered only when allowed by backend capabilities |
| `protect_pending`, `protecting` | Protection requested; no physical protection success is claimed |
| `protected` | Backend reports confirmed protection, separately from the current sensor snapshot |
| `entry_pending`, `entering` | Entry opening requested; waiting for observation |
| `entry_open` | Entry opening confirmed; scheduled arrival additionally requires matched recognition and newer occupied evidence; charging remains unverified |
| `release_pending`, `releasing` | Cancellation/release intent is pending; the bay is not declared reusable |
| `blocked` | Occupancy, fault, access policy or changed state requires recovery; keep reservation context visible |
| `uncertain` | Outcome is unresolved; reconcile state before any further movement |

Workflow reads poll every five seconds while the app is in the foreground. Actions pause after fifteen seconds without a successful workflow read. This is a client connection policy, separate from the worker's stricter telemetry/interlock policy. The default control observation age is **five seconds**; an explicitly configured value is capped at fifteen seconds. This does not establish a hardware safety guarantee. Mutations serialize locally, are never automatically retried and are followed by a read even after an unknown outcome. Database allocation and worker claims handle cross-phone/process races; disabling a button alone does not provide exclusivity.

Scheduled entry is camera-authorized; the owner can request cancellation/release when the backend permits it. A pending cancellation is an intent, not proof that physical cleanup has completed. The UI never substitutes a local state transition for backend confirmation.

## Acknowledgements, late dispatch and quarantine

The worker persists command acknowledgement separately from its dispatch permit. A normally acknowledged movement requires a fresh target observation with a provider timestamp **strictly newer** than dispatch before it can be confirmed. A target already observed before dispatch is not evidence that a later movement completed.

A persisted dispatch permit without an acknowledgement is more difficult: a process might have paused after receiving the permit and could still send the command later. Even a newer GET showing the target cannot prove that no delayed sender remains. Therefore `dispatching`/`uncertain` delivery without a persisted acknowledgement remains quarantined indefinitely. Ordinary polling must not convert it to confirmed, free the allocation or permit another movement.

An operator must stop the dispatchers and account for any outstanding sender before inspecting the device and performing explicit recovery. The mobile screen has no quarantine-override control. It displays `COMMAND_DELIVERY_UNRESOLVED`, `OPERATOR_RECOVERY_REQUIRED`, `OBSERVATION_CONFLICT` or `DISPATCHER_STOPPED` as an operator-review state, without suggesting that a refresh alone resolves the race. This distinction also applies to cancellation and no-show cleanup: an elapsed deadline is not permission to bypass an unresolved dispatch.

## Blocked bays

The prepared backend preflight checks occupancy, fresh telemetry, faults and the protection access policy. A fresh occupied report, hardware fault or unsafe access policy blocks movement. Unknown observations preserve recovery state. The mobile screen displays the reason and asks for operator inspection; it does not infer an empty bay from missing plate events.

The reservation owner and original context stay visible during recovery. Release requests still depend on backend capabilities and reconciliation. A blocked bay must not become available merely because the owner cancelled, the phone disconnected or its countdown elapsed.

Idle enrolled bays are monitored too: occupied means blocked, and a newer vacant observation can restore an open idle bay or queue checked lowering. Scheduled activation tries another compatible confirmed-vacant bay at the location before cancelling/refunding mock fees and suggesting registered alternatives. Operator escalation and real compensation remain product proposals.

## No-shows and deadlines

The UI counts down using backend time. At zero it displays **Deadline reached · checking the bay**. It does not mark the bay free, move the barrier or decide that the driver failed to arrive.

The prepared server/worker owns deadline reconciliation. Safe cancellation/no-show handling requires a consistent reservation phase, fresh occupancy and confirmed physical cleanup. Occupied, stale or uncertain physical state retains a recovery guard instead of creating another bookable allocation. A missing recognition event is never sufficient evidence of no-show or vacancy.

Unused Now bookings expire ten minutes from creation; scheduled protection runs from ten minutes before arrival until ten minutes after it. Accepted €1 mock extensions add ten minutes to either mode. Thus a 15:00 booking starts protection at 14:50 and requests unused-hold cleanup at 15:10. Before 14:50 it remains available for earlier non-overlapping bookings. A timely matching plate sets `entryAuthorizedAt` and exits both unused-hold timers; an occupied sensor sample still records arrival separately. Occupied or uncertain physical state retains its guard. Before physical activation, an occupied requested bay can be replaced atomically by a compatible bay at the same location; a full location cancels/refunds the mock fee and offers nearby verified alternatives. See [SCHEDULED-SESSIONS.md](SCHEDULED-SESSIONS.md) for both booking options and the connector/bay distinction.

No real payment is implemented. A lowered barrier or occupied sensor alone cannot establish charging or authorized arrival, and a missed camera event never establishes departure or vacancy. Actual charging evidence, reminders and a supervised full physical cycle remain outstanding.

## Verification boundary

Mobile TypeScript checks cover the screen/client contract at build time. [Controlled mobile checks](../test/hardware-mobile.test.mjs) exercise the actual hook and client with mocked React/native/network dependencies: failed-read staleness, duplicate taps, read-only reconciliation after unknown writes, foreground/read-age guards, identity validation and unauthenticated disabled discovery. They load no credentials or live service. Backend and database tests must establish allocation races, ownership, claim fencing and uncertain command recovery. Neither those tests nor a production Android bundle proves safe hardware movement. Record the first supervised reserve → observed protection → arrival/entry → agreed charging evidence → observed release cycle, including a blocked-bay and expired-hold recovery, in [BUILD-LOG.md](BUILD-LOG.md).
