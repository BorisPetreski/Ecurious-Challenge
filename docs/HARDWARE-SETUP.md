# Activate the designated Ecurious bay

All eleven hosted migrations were checksum-verified at `2026-10-24T13:50:46.533Z`, with no pending versions and eleven application tables. Guest Auth/read/private-denial smoke passed at version eight; later deltas verified deadline/privacy metadata and the explicit zero-power test constraint. Private backend credentials are configured. Directory holds, privacy intake and the local simulators remain separate from physical commands.

The user-selected real `lock-0002` is registered as **BARRIER_TEST · 0 kW · no charger**. The user relayed mentor confirmations and later confirmed exclusive team ownership. Direct API bench movement, whitelist readbacks and one guarded idle-worker release have been observed. A complete customer booking/plate/occupied-arrival/departure cycle and real charging remain unverified.

**Current control state:** database `enabled=true`, `interlocks_confirmed=true`; root `.env` and the running backend on port 3001 have the command flag true. Automatic approval review rejected an earlier activation while telemetry remained unknown. A genuine fresh lowered/vacant, fault-free report with disabled auto-access at **2026-10-24T14:22:21.966Z** then reconciled the bay to idle, and a guarded update restored activation. Reports were about three minutes apart; subsequent old telemetry still produces `blocked / TELEMETRY_UNKNOWN`. The five-second movement freshness and other guards have not been removed. A queued booking is not confirmed physical protection.

Directory software holds and local rehearsals remain separate usable flows while hardware is blocked. Stale diagnostics do not establish present position or vacancy, and disabled hardware capability must not be presented as an active physical reservation.

The applied [arrival-grace migration](../supabase/migrations/20261024200000_arrival_grace.sql) passed its focused local SQL contract before the guarded hosted delta. It preserves prior checksums and adds no table or public RPC signature.

Use [Supabase setup](SUPABASE.md) for deployment evidence and [the observed Ecurious contract](ECURIOUS-API.md) for hardware prerequisites. Apply every reviewed migration in order, including [booking options](../supabase/migrations/20261024180000_booking_options.sql); the setup script verifies immutable prior checksums. Never load files from `supabase/tests/` into a live project.

[Directory booking options](../supabase/migrations/20261024190000_directory_booking_options.sql) use their own private extension ledger. They provide the same free/€1 mock choices on virtual directory slots, with no physical Ecurious action. The later privacy queue brings the total to eleven application tables. See [scheduled sessions](SCHEDULED-SESSIONS.md) for the product flow.

## Selected barrier: configuration and observed evidence

The guarded [enrollment script](../scripts/enroll-hardware-test.mjs) created an explicitly labelled location/bay/interface for `lock-0002`, with no GoingElectric mapping or coordinates. It initially set both control gates false; the later user-confirmed activation changed them separately. The real interface is `BARRIER_TEST` at exactly zero kW. It is a reservation-barrier test resource, without an invented charging connector or power rating.

| Fact | Source and result |
| --- | --- |
| Safety/interlock confirmation | Mentor confirmations relayed by the user; recorded in `interlocks_confirmed=true`; exclusive team ownership later confirmed by the user |
| Current selected configuration | Database `enabled=true`, `interlocks_confirmed=true`; root environment and backend 3001 command flag true; old telemetry still produces `TELEMETRY_UNKNOWN` and cannot authorize movement |
| Raised bench observation | Approved direct API call, followed by newer raised/vacant telemetry at `2026-10-24T13:54:55.309Z`, with no reported errors |
| Lowered/restored bench observation | Approved direct API call, followed by newer lowered/vacant telemetry at `2026-10-24T13:54:59.709Z`, with no reported errors |
| Automatic-access changes | Initial clear verified at `2026-10-24T13:55:56.915Z`; other users then restored rules. After exclusive ownership was confirmed, a second clear was followed by four disabled-mode readbacks over fifteen seconds |
| Guarded idle release | Worker dispatched at `2026-10-24T14:01:41Z`; ledger confirmation recorded at `14:01:45.502842Z` |
| Latest successful reactivation | Genuine vacant/lowered, fault-free, auto-access-disabled report `2026-10-24T14:22:21.966Z`; observation reconciled to idle before a separately guarded activation |
| App-originated complete cycle | Not yet verified: owner booking, durable worker movement, fresh matching native OCR, occupied arrival, departure and confirmed cleanup |

The direct bench observations establish their dated position/access results; the idle release separately exercises the durable worker. Neither demonstrates a customer's occupied-vehicle interlock, fresh matching plate, arrival and departure. Mentor confirmations remain separate from observed evidence. The latest stale telemetry cannot establish current barrier position or vacancy. This fixture provides no charging, delivered-energy or charger-compatibility evidence.

## Confirm the real mapping and interlocks

The operator/mentor must identify the exact assigned lock, its physical bay, the actual connector(s) serving that bay, and any approved directory mapping. Do not assign a GoingElectric station merely because it is nearby. Leave location coordinates and the directory ID null until an operator supplies them.

For an additional deployment, establish the sensor's update behavior, vacancy detection, safe raising/lowering interlocks, auto-relift behavior and recovery from a motor fault. The selected barrier's mentor confirmations are recorded above. A recent `lastSeenAt` is necessary for this implementation but is not a provider guarantee of safe motion. The workflow age limit defaults to five seconds, distinct from the diagnostics panel's 60-second display rule. Its permitted configuration range is 1–15 seconds.

Protection requires observed camera access policy `disabled`. Wildcard access can lower the barrier for any recognized plate, so a raised arm with wildcard access does not establish exclusive protection. The reservation workflow does not install per-driver whitelists. Observed rule changes after the first clear showed why the policy must be checked before movement; a later clear stayed disabled across four reads after the user confirmed exclusive use. Fresh native OCR delivery in that mode still needs the complete cycle.

Scheduled entry uses private backend comparison of a recognized plate with the booking's HMAC fingerprint. Automatic provider camera access stays disabled; the backend requests lowering through the durable ledger after a fresh matching recognition. The older immediate prototype keeps manual owner entry, while scheduled bookings reject that bypass. Agree the actual plate-event delivery and sensor behavior with mentors before claiming a verified full physical cycle. Occupied arrival is not charging evidence.

## Register confirmed inventory

The selected `lock-0002` is already enrolled; use its existing registered interface. The template below is for additional operator-confirmed charging inventory through a privileged SQL session. It requires an actual positive charging rating, creates no GoingElectric mapping and leaves movement disabled. For a barrier-only test, use the explicit `BARRIER_TEST` enrollment path with zero power.

```sql
do $$
declare
  v_lock_id text := null;       -- Fill with the mentor-confirmed assigned lock.
  v_connector_type text := null; -- Actual type, for example CCS or Typ2.
  v_power_kw numeric := null;   -- Actual confirmed connector power.
  v_location_id uuid := pg_catalog.gen_random_uuid();
  v_bay_id uuid := pg_catalog.gen_random_uuid();
  v_connector_id uuid := pg_catalog.gen_random_uuid();
begin
  if v_lock_id is null or v_lock_id !~ '^[A-Za-z0-9_-]{1,100}$'
    or v_connector_type is null or pg_catalog.btrim(v_connector_type) = ''
    or v_power_kw is null or v_power_kw <= 0 or v_power_kw > 2000
  then
    raise exception 'Fill the confirmed lock ID, connector type and power first';
  end if;
  insert into public.charging_locations(id,label,goingelectric_id,latitude,longitude)
    values(v_location_id,'Operator-confirmed hackathon location',null,null,null);
  insert into public.bookable_bays(id,location_id,label,integration_mode,ecurious_lock_id,enabled)
    values(v_bay_id,v_location_id,'Designated Ecurious test bay','ecurious',v_lock_id,true);
  insert into public.bay_connectors(id,bay_id,label,connector_type,power_kw,enabled)
    values(v_connector_id,v_bay_id,'Operator-confirmed connector',v_connector_type,v_power_kw,true);
  insert into public.hardware_controls(bay_id,enabled,interlocks_confirmed,telemetry_max_age_ms)
    values(v_bay_id,false,false,5000);
  raise notice 'Created disabled hardware workflow: bay %, connector %',v_bay_id,v_connector_id;
end;
$$;
```

For multiple real plugs on the same one-vehicle bay, add explicit `bay_connectors` rows referencing the same bay. Do not infer bays from a public directory count. If existing inventory already describes this bay, use those confirmed rows rather than registering a duplicate. A unique hardware lock ID and the workflow's whole-bay guard prevent independent bookings through alternate plugs.

## Configure the private backend

The root `.env` accepts these settings; the sample shows fresh-setup defaults and the current false environment command flag. Environment edits do not update an already running process; the separate backend on port 3001 currently retains true until restarted. Keep credentials out of tracked files and command output:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_CLIENT_KEY
SUPABASE_SECRET_KEY=YOUR_BACKEND_ONLY_SECRET_KEY
# Legacy server-key alternative: SUPABASE_SERVICE_ROLE_KEY=...
ECURIOUS_API_KEY=YOUR_ASSIGNED_TEAM_KEY
ECURIOUS_COMMANDS_ENABLED=false
ECURIOUS_LOCK_IDS=YOUR_CONFIRMED_ASSIGNED_LOCK_ID
BAYREADY_PLATE_HASH_KEY=YOUR_STABLE_BASE64_32_BYTE_SERVER_SECRET
```

The existing `SUPABASE_API_KEY` public client setting is also supported. An anon/publishable key cannot act as the worker. The private key must authorize the Supabase `service_role`; a secret key or legacy service-role key belongs only on the Node backend. Never put either hardware or Supabase server credentials in an `EXPO_PUBLIC_` variable. The launchers remove those values from the Expo child environment.

Scheduled bookings additionally require a stable cryptographically random 32-byte key, encoded as base64, for `BAYREADY_PLATE_HASH_KEY`. Generate/store it through the backend's secret management path, never tracked files or command output. All worker instances must use the same key; changing it breaks matching for existing booked fingerprints. Plate key rotation, deletion/retention and an operator access policy remain deployment work. Raw plates stay only in request/OCR comparison memory; SQL retains the keyed hash and a masked two-character suffix.

There are three separate activation gates:

1. Backend `ECURIOUS_COMMANDS_ENABLED=true` and a nonempty explicit `ECURIOUS_LOCK_IDS` allowlist.
2. The lock remains assigned to the backend's Ecurious team credential.
3. Its private database control row has `enabled=true` and `interlocks_confirmed=true` after the on-site checks above.

For an activation with current trusted telemetry and recorded checks, the administrator can enable the confirmed bay through the guarded process. The latest successful activation followed the fresh report above; this generic statement illustrates configuration and does not replace those checks:

```sql
update public.hardware_controls
set enabled=true, interlocks_confirmed=true, updated_at=pg_catalog.clock_timestamp()
where bay_id='REPLACE_WITH_CONFIRMED_BAY_UUID'::uuid;
```

Activation also requires loading the intended backend command flag and assigned-lock allowlist. The present false database gate must remain in place while trusted telemetry is unavailable; a prior successful bench call or old disabled-whitelist readback does not replace fresh preflight. Software intents and physical confirmation remain distinct.

`ECURIOUS_MODE=mock` still describes the independent simulator. It does not disable the separate hardware workflow once its explicit command gates are enabled. Use the app's dedicated hardware screen for this path. Keep the local rehearsal network trusted; a hosted backend needs HTTPS for the forwarded guest session tokens.

## Who can do what

The migration grants authenticated sessions only these workflow RPCs:

- `list_hardware_workflows()` and `get_hardware_workflow(p_bay_id)`.
- `request_hardware_reservation(p_bay_id,p_connector_id,p_hold_minutes,p_request_id)`.
- `request_hardware_entry(p_reservation_id)` and `request_hardware_release(p_reservation_id)`.
- `list_hardware_slots(p_bay_id,p_from,p_until)`, `list_my_hardware_slots()` and `get_hardware_slot(p_slot_id)`.
- `request_hardware_slot(p_bay_id,p_connector_id,p_starts_at,p_ends_at,p_request_id,p_plate_hash,p_masked_plate)` and `cancel_hardware_slot(p_slot_id)`.
- The slot request accepts `p_booking_mode` (`now` or `scheduled`), and `request_hardware_slot_extension(p_slot_id,p_request_id)` adds an idempotent ten-minute extension to either eligible option before its unused deadline and before accepted entry.

Guest requests retain the caller's Supabase JWT and ownership. They never supply the actual lock ID to execute. The backend verifies its allowlist against the registered mapping and the provider's current assignment.

Only `service_role` can execute the operation worker functions and `reconcile_hardware_slots`, `list_hardware_slot_work`, `record_hardware_bay_observation` and `authorize_hardware_plate_entry`. Controls, operations and scheduled booking tables have RLS and no direct phone grants. Internal helpers and the older unguarded implementations have no client execution grant. A public hash argument is an unverified booking claim; it does not grant access to the private recognition authorization function.

The database defaults require no manual broad `GRANT` statement. Do not grant service RPC execution to `anon` or `authenticated` to work around a key/configuration error.

## How the physical guard behaves

The idle target is a lowered, vacant bay. Occupied idle telemetry blocks it. Idle raised/vacant telemetry queues a checked lower operation with no customer reservation. Unknown delivery quarantine is retained even for this idle lowering.

A Now booking creates ten free minutes from DB time, with immediate protection intent. A Scheduled booking reserves its whole bay from ten minutes before expected arrival until the booked end, across plugs through a PostgreSQL exclusion constraint. Fresh safely idle telemetry permits the scheduler to bind a held booking and queue protection once that lead-in is due. The older immediate reservation path uses the same exclusion guard.

For an unactivated unavailable target, the scheduler can assign another physical bay at the same operator-registered location with the same connector type and at least the selected power rating. All enabled fallback bays must belong to an assigned, allowlisted running backend worker. Another plug on an occupied bay cannot serve another vehicle. If the location has no safe compatible bay, the unactivated booking is cancelled with `LOCATION_FULL`, and its mock fee is refunded. Nearby suggestions use only registered coordinates and fresh safe compatible inventory; they do not reserve another location. An already activated or uncertain in-flight physical command is never reassigned through this fallback.

The worker checks fresh, known, vacant, fault-free telemetry; protection also requires disabled automatic plate access. An already-correct target can be confirmed without moving hardware. The slot's pending state does not report a protected arm.

A worker can replace a 30-second claim only before a dispatch permit exists. That replacement rotates its token. The permit is recorded before the HTTP POST, can be obtained only once, and is not renewed after timeout. A successful command acknowledgement remains separate from confirmation: the provider observation must be strictly newer than the dispatch timestamp and show the expected stable target. An equal timestamp is insufficient.

The confirmed Scheduled timing is arrival 15:00 → protection 14:50 → unused timeout 15:10. Future bookings leave current availability unchanged until their lead-in. Now starts with ten unused minutes; paid extensions add ten minutes to either option. `protectionDeadlineAt` explicitly separates the unused cutoff from planned arrival and historical ends. Cancellation and unused expiry request safe cleanup; they do not free an active held row. Occupied, unknown, faulty or conflicting observations retain the guard.

A private matching recognition must be no more than 15 seconds old and strictly after protection confirmation, while the bay is safely protected and vacant. Recognition and current DB time must precede the shared authoritative deadline, including purchased minutes. Accepted matching entry queues lowering and exits both automatic expiry workers, even if the car is not yet sensor-occupied. Only a later occupied sensor sample records parked arrival. A newer lowered/vacant sample after arrival records departure and queues cleanup. If that sequence never arrives, explicit owner/operator safe cancellation is required. No charging measurement is implied.

Pricing is explicitly mocked: Now starts free for ten minutes; each ten-minute extension costs €1; Scheduled costs a fixed €1. `payment_status='mock_refunded'` represents the failed-location refund. The older per-minute estimate is superseded. No money is collected. See [scheduled sessions](SCHEDULED-SESSIONS.md) and [database contracts](DATABASE.md).

An HTTP timeout or process crash after the permit may leave an unknown physical command. Without a persisted acknowledgement, even a matching GET cannot automatically free that quarantine: an old paused dispatcher might still send late. An acknowledged operation may resume read-only reconciliation after restart, without resending movement. Failed reads do not erase its acknowledgement.

This is not exactly-once execution at the device. The Ecurious reference does not provide an idempotency key, command ID or external fencing token. The ledger provides durable admission and at-most-one dispatch permit per operation; unknown external delivery still requires operator recovery.

## Operator recovery from an unknown dispatch

There is deliberately no guest reset or automatic lease recovery after dispatch. Stop every dispatcher that could own the old permit, retire outstanding network requests and provider-side pending actions with mentor assistance, inspect the physical bay, and obtain fresh trusted telemetry before making an administrative change. A database token cannot revoke an already permitted external POST.

After that external uncertainty is actually resolved, an administrator can retire the old ledger operation and queue a new, separately checked cleanup. The following template keeps the held reservation in place. It does not fabricate an acknowledgement, mark the bay empty or bypass the normal cleanup worker:

```sql
begin;
select * from public.hardware_controls
where bay_id='REPLACE_WITH_CONFIRMED_BAY_UUID'::uuid for update;

update public.hardware_operations o
set status='cancelled', claim_token=null, claim_expires_at=null,
    reason='OPERATOR_RECONCILED_AFTER_DISPATCHERS_STOPPED'
from public.hardware_controls c
where c.bay_id='REPLACE_WITH_CONFIRMED_BAY_UUID'::uuid
  and o.id=c.current_operation_id
  and o.status in ('dispatching','acknowledged','uncertain');

update public.hardware_controls
set release_requested=true, release_reason=coalesce(release_reason,'cancel'),
    reason='OPERATOR_RECOVERY_CLEANUP'
where bay_id='REPLACE_WITH_CONFIRMED_BAY_UUID'::uuid;

select case when c.reservation_id is null
  then public._queue_idle_hardware_release(c.bay_id)
  else public._queue_hardware_operation(c.bay_id,'release') end
from public.hardware_controls c
where c.bay_id='REPLACE_WITH_CONFIRMED_BAY_UUID'::uuid;
commit;
```

Record the actual observations and operator decision in the private event evidence/build log without plates or captures. Restart only the intended dispatcher after the old one can no longer send. The new cleanup still requires the configured assignment, interlocks, fresh vacancy and confirmed lowered target before releasing the booking. Never clear `reservation_id` or change a physical booking to expired merely to make its marker available.

## What has been tested

`npm run test:database` uses only fictional lock IDs in a network-isolated disposable PostgreSQL container. It covers private grants, owner access, replay-safe admission, stale/conflicting telemetry, claim rotation, cancellation before/after dispatch, no-ACK quarantine, acknowledgement retention, strict post-command observations, occupied entry/cleanup, no-show retention and mapping guards.

Independent SQL clients also verify that different plugs on one physical bay yield one booking, competing workers yield one claim, and two requests for a dispatch permit yield one permit. No provider command is sent by those tests. A complete customer-booking-originated dispatch, matching plate and occupied/departed sensor sequence still needs its integration test.

The separate direct API bench position/access observations did not originate from a booking ledger. One later guarded idle release did dispatch and confirm through the worker. The customer plate/occupied-arrival/departure flow remains unverified, and current stale telemetry blocks further activation. This barrier-only fixture has no demonstrated charging path.

The fifth-migration suite additionally covers future scheduling without early commands, whole-bay calendar overlap/adjacency, immediate-route conflict rollback, matching-event authorization, sensor arrival/departure, cancellation retention, the no-show grace period and idle lowering without an allocation. Independent clients verify competing future slots and identical retries across separate PostgreSQL sessions.

`node scripts/test-database.mjs --barrier-test-only` passed the eleventh-migration contract using fictional inventory: exactly-zero `BARRIER_TEST`, positive real ratings, preserved disabled `UNKNOWN` history, disabled-gate refusal and the existing guarded session/cleanup flow. It makes no provider request or claim about the selected real interlocks.
