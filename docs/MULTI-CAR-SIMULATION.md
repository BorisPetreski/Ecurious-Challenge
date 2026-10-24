# Multi-car Scenario lab

Open **Profile → Multi-car Scenario lab**, **Activity → Open multi-car Scenario lab**, or the link on the disconnected Hardware screen. The route is `/simulation`. Run a preset, then expand **Try it yourself** to switch the acting car and issue individual events. This is one shared local fictional world; selecting a car does not switch a real Supabase identity.

The lab has three fictional cars, two physical bays at a fictional Central Hub and one nearby bay. Bay 1 has multiple connectors; a booking owns the whole one-car bay. Driver identity, reservation owner, physical occupant, acknowledged command and observed barrier position are separate fields.

## Presets and expected behavior

| Scenario | What it demonstrates |
| --- | --- |
| Two drivers, one bay (`race`) | A's hold survives B's competing request, including when a bay has more than one connector. |
| Wrong car / uncertain scan (`plate-check`) | Wrong car and low confidence do not request entry. A timely match stops expiry but does not invent parked arrival. |
| No-show and safe release (`no-show`) | The unused deadline requests lowering; vacant/lowered observation is required to reopen. |
| Add ten minutes (`extension`) | One €1 mock addition moves the deadline ten minutes; the original deadline no longer expires the hold. |
| 15:00 arrival (`scheduled-window`) | Before 14:50, a non-overlapping earlier booking is possible. Protection begins at 14:50; unused cleanup starts at 15:10. |
| Blocked bay → another bay (`blocked-fallback`) | At activation, choose another compatible physical bay at the same location, not a connector in the occupied car space. |
| Full hub → refund and nearby hub (`full-refund`) | No free bay at the location means a mock refund and an advisory nearest fictional alternative. |

Presets reset the world before running. Result checks belong to that rehearsal; manual changes create a new state. **Event timeline** explains the intermediate actions. Virtual time starts at 14:40 Berlin on 24 October 2026 and advances only through controls. It is separate from real reservations and the original single-bay simulator.

## Manual walkthrough

1. Reset. Choose Car A and Bay 1, then **Reserve now**. The raise command is acknowledged while observed position remains lowered.
2. **Observe barrier raised** confirms the simulated target. Switch to Car B and scan it: A retains the booking, and the barrier stays raised. Try A with 40% confidence, then 99%.
3. A's matching scan authorizes entry and acknowledges lowering. **Observe barrier lowered**, then **Park selected car**. Advance time past the original deadline: A's accepted entry is not a no-show.
4. **Selected car leaves** reports vacant departure. Observe cleanup to reopen. Car B can then book the bay.

Use **Simulate an unreserved car occupying bay** for a blocker, and **Observe blocker gone** for its separate vacancy observation. An occupied bay cannot confirm barrier motion or release solely because a timer elapsed. Refresh after a refused or unknown action before continuing. **Reset fictional world** affects the lab only.

## Evidence and limits

[`lib/multi-car-lab.mjs`](../lib/multi-car-lab.mjs) is a bounded in-memory rehearsal that imports production reservation prices/timing. It does not execute production PostgreSQL functions, call Supabase/Ecurious, run the plate model, authenticate three real users, move hardware or deliver electricity. Seven passing presets illustrate expected behavior; they are not a concurrency or physical-safety proof.

Separately, run `npm run test:database -- --multi-car-only`. It applies the actual migrations in a disposable network-isolated PostgreSQL instance and runs two concurrent clients with different owner IDs and synthetic plate fingerprints. The focused contract checks one winner, owner isolation, redacted calendar, wrong/correct/duplicate matching, occupied→vacant evidence, retained allocation until cleanup, separate-bay fallback, mock refund and nearest eligible registered alternative. No hosted account, production reservation or provider command is needed.

See [the guiding-question implementation plan](CHALLENGE-WORKFLOW.md), [model handoff](MODEL-INTEGRATION.md), [scheduled workflow](SCHEDULED-SESSIONS.md) and [privacy controls/remaining decisions](PRIVACY.md).
