# Test lock-0002 from the app

The user identified `lock-0002` as **barrier-only test hardware**, with no actual charging connector. Its application interface is explicitly `BARRIER_TEST`, rated **0 kW**, and labelled **no charger**. It uses the same owner, time-slot, plate authorization and durable movement workflow as enrolled bays; it does not manufacture a public charger or claim delivered energy.

The user subsequently confirmed that Ecurious's occupancy interlocks, automatic re-raising and native OCR behavior had been checked. This is user-provided operator confirmation, not an independently observed physical cycle. Actual API test evidence belongs in [BUILD-LOG.md](BUILD-LOG.md).

## One-time backend preparation

The backend already has the Ecurious key, Supabase worker key and stable plate HMAC key. The selected allowlist is `ECURIOUS_LOCK_IDS=lock-0002`. Migration eleven allows only the explicit barrier-test interface to have zero power; real charging connector ratings remain positive.

`scripts/enroll-hardware-test.mjs --lock-id lock-0002` previews the pinned-project registration. With `--apply`, it creates the labelled test location, bay and interface atomically, with **both hardware gates disabled**. It refuses conflicting inventory, a partial setup, active holds or changed/live control state, and verifies migration checksums. It sends no provider command and creates no GoingElectric mapping. An exact disabled re-run reuses existing rows.

After confirming the device facts and checking current assignment/telemetry, the administrator records the confirmed interlocks and activates only this bay's control. The backend flag `ECURIOUS_COMMANDS_ENABLED=true` starts the worker after restart. Idle cleanup can itself request lowering, so activation is a hardware action capability, not just a way to reveal a form.

The chosen control mode is **native OCR read → private match → backend-controlled lowering**. Device wildcard/specific-plate auto-unlock must be disabled by the operator and verified; whitelist POSTs are persistent access configuration, not fake OCR events. Do not run another dispatcher or direct manual test while app automation is active.

## App walkthrough

1. Open **Profile**, enter the fictional test plate you will present to the camera, and save. No real contact details are required. The barrier test interface works regardless of your saved CCS/Type 2 preference.
2. Open **Profile → Hardware test**. Select the `lock-0002` barrier-only bay. Choose **Now → Reserve free · 10 minutes**. The server records an owner-bound booking; the phone never sends a physical lock ID to execute. Its ten-minute window starts immediately. If device telemetry is old, the booking remains pending and the app explicitly says the bay is not protected yet; hardware protection waits for a fresh acceptable report. Observed reports have been about three minutes apart.
3. Wait for **Protection confirmed** and a fresh raised/vacant report. Command acknowledgement alone does not establish that the arm moved.
4. Present the matching plate to the actual onboard camera **after** protection confirmation. A test plate shown before protection is historical and cannot authorize entry. Native latest OCR must be timely, post-protection and before the unused deadline; the backend compares it privately with the booking fingerprint.
5. Observe **Opening for your vehicle → Entry open**. The barrier should lower. A matching plate stops no-show expiry, but parking is still unconfirmed until the occupancy sensor reports it.
6. Use the operator-approved method to exercise the occupancy sensor on the bench. A newer occupied sample records **Vehicle arrived**. Open **View session** to see elapsed presence time and available device facts. There is no electrical charging or kWh/kW telemetry in this barrier-only test.
7. Remove the occupancy target using that approved method. A newer vacant report records departure and requests cleanup. The next booking is offered only after lowered/vacant cleanup is confirmed.

If the screen shows **Test paused**, backend/DB gates remain off. **Waiting for device update** means the last provider report is too old for physical movement; a queued reservation does not establish vacancy or protection. Keep the pending booking visible and refresh the rig's actual telemetry. Faults, changed camera access or uncertain commands require inspection; repeating Reserve does not resolve them. An uncertain command must not be followed blindly by its opposite.

## Follow-up cases

- **Wrong plate:** create a booking for one fictional plate, present another; the original owner keeps the bay and no entry is authorized.
- **No-show:** reserve Now and present no matching plate; after ten minutes, vacant/lowered cleanup reopens the bay. Missing OCR alone never proves vacancy.
- **Extension:** while protected and unmatched, choose **Add 10 minutes · €1 mock**; expiry moves once. Retry IDs prevent a duplicate charge/time addition.
- **Scheduled:** choose arrival T. Protection starts at T−10; the unused deadline is T+10. Use the [Scenario lab](MULTI-CAR-SIMULATION.md) to accelerate this timeline; the live hardware follows actual time.
- **Occupied idle bay:** exercise the sensor before booking. The bay must be blocked; do not force a raise against occupied/unknown state.

No YOLO model or external recognition token is required. [Native OCR API tests](NATIVE-OCR-TEST.md) cover the software contract with mocked transport; the supervised physical observations above are separate evidence.
