# Activate the designated Ecurious bay

The repository now contains a durable hardware workflow, but the hosted schema/auth setup and private Supabase backend credential are still pending. No real lock is enrolled by a migration, and no physical command was sent while implementing or testing this workflow. The existing directory holds and local simulator remain separate.

Use [Supabase setup](SUPABASE.md) for the shared project and [the observed Ecurious contract](ECURIOUS-API.md) for hardware prerequisites. Apply all six migrations in order, ending with [the plate arrival deadline guard](../supabase/migrations/20261024170000_plate_arrival_deadline.sql). Never load files from `supabase/tests/` into a live project.

## Confirm the real mapping and interlocks

The operator/mentor must identify the exact assigned lock, its physical bay, the actual connector(s) serving that bay, and any approved directory mapping. Do not assign a GoingElectric station merely because it is nearby. Leave location coordinates and the directory ID null until an operator supplies them.

Before activating movement, establish the sensor's update behavior, vacancy detection, safe raising/lowering interlocks, auto-relift behavior and recovery from a motor fault. A recent `lastSeenAt` is necessary for this implementation but is not a provider guarantee of safe motion. The default workflow age limit is five seconds; it is distinct from the read-only panel's 60-second display rule. The database permits an explicitly configured limit of 1–15 seconds; do not loosen it to hide a stale or offline device.

Protection also requires the observed camera access policy to be `disabled`. Wildcard access can lower the barrier for any recognized plate, so a raised arm with wildcard access is not exclusive protection. This version does not write or restore camera whitelists. An authorized operator must configure the agreed policy outside this app before protection can pass preflight.

Scheduled entry uses private backend comparison of a recognized plate with the booking's HMAC fingerprint. Automatic provider camera access stays disabled; the backend requests lowering through the durable ledger after a fresh matching recognition. The older immediate prototype keeps manual owner entry, while scheduled bookings reject that bypass. Agree the actual plate-event delivery and sensor behavior with mentors before claiming a verified full physical cycle. Occupied arrival is not charging evidence.

## Register confirmed inventory

Run the following only through a privileged project SQL session after filling in the confirmed values. It intentionally refuses to run with the missing lock/type/power placeholders. It creates no GoingElectric mapping and leaves movement disabled.

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

The root `.env` accepts these settings; keep actual values out of tracked files and command output:

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

After recording the checks and confirmed bay ID, the administrator can activate its database gate:

```sql
update public.hardware_controls
set enabled=true, interlocks_confirmed=true, updated_at=pg_catalog.clock_timestamp()
where bay_id='REPLACE_WITH_CONFIRMED_BAY_UUID'::uuid;
```

Then set the backend command flag to true and restart it. These statements activate the ability to move real hardware; do not enable unrelated lock IDs. A software intent can be stored before movement is confirmed, so use the dedicated workflow state to distinguish pending, protected, blocked and uncertain outcomes.

`ECURIOUS_MODE=mock` still describes the independent simulator. It does not disable the separate hardware workflow once its explicit command gates are enabled. Use the app's dedicated hardware screen for this path. Keep the local rehearsal network trusted; a hosted backend needs HTTPS for the forwarded guest session tokens.

## Who can do what

The migration grants authenticated sessions only these workflow RPCs:

- `list_hardware_workflows()` and `get_hardware_workflow(p_bay_id)`.
- `request_hardware_reservation(p_bay_id,p_connector_id,p_hold_minutes,p_request_id)`.
- `request_hardware_entry(p_reservation_id)` and `request_hardware_release(p_reservation_id)`.
- `list_hardware_slots(p_bay_id,p_from,p_until)`, `list_my_hardware_slots()` and `get_hardware_slot(p_slot_id)`.
- `request_hardware_slot(p_bay_id,p_connector_id,p_starts_at,p_ends_at,p_request_id,p_plate_hash,p_masked_plate)` and `cancel_hardware_slot(p_slot_id)`.

Guest requests retain the caller's Supabase JWT and ownership. They never supply the actual lock ID to execute. The backend verifies its allowlist against the registered mapping and the provider's current assignment.

Only `service_role` can execute the operation worker functions and `reconcile_hardware_slots`, `list_hardware_slot_work`, `record_hardware_bay_observation` and `authorize_hardware_plate_entry`. Controls, operations and scheduled booking tables have RLS and no direct phone grants. Internal helpers and the older unguarded implementations have no client execution grant. A public hash argument is an unverified booking claim; it does not grant access to the private recognition authorization function.

The database defaults require no manual broad `GRANT` statement. Do not grant service RPC execution to `anon` or `authenticated` to work around a key/configuration error.

## How the physical guard behaves

The idle target is a lowered, vacant bay. Occupied idle telemetry blocks it. Idle raised/vacant telemetry queues a checked lower operation with no customer reservation. Unknown delivery quarantine is retained even for this idle lowering.

A future booking creates only a schedule row, reserving its whole bay across plugs through PostgreSQL exclusion constraints. It creates no early hardware operation. At the requested start, fresh safely idle telemetry permits the scheduler to atomically bind a held booking and queue protection. Unsafe, occupied or unresolved bays remain blocked, including when an earlier booking overruns an adjacent calendar window. The older immediate reservation path uses the same schedule exclusion guard.

The worker checks fresh, known, vacant, fault-free telemetry; protection also requires disabled automatic plate access. An already-correct target can be confirmed without moving hardware. The slot's pending state does not report a protected arm.

A worker can replace a 30-second claim only before a dispatch permit exists. That replacement rotates its token. The permit is recorded before the HTTP POST, can be obtained only once, and is not renewed after timeout. A successful command acknowledgement remains separate from confirmation: the provider observation must be strictly newer than the dispatch timestamp and show the expected stable target. An equal timestamp is insufficient.

Scheduled windows last 5–120 minutes and start within seven days. A no-show grace policy currently requests cleanup after 15 minutes of actual protection without occupied arrival, or the window end if sooner. This grace is a product assumption. Cancellation and expiry request safe cleanup; they do not free an active held row. Occupied, unknown, faulty or conflicting observations retain the reservation and block another user. A no-show release becomes expired only after confirmed vacant cleanup. Missing plate events never prove vacancy.

A private matching recognition must be no more than 15 seconds old and strictly after protection confirmation, while the bay is still safely protected and vacant. Both the recognition and current database time must precede the earlier of the window end and the 15-minute grace cutoff; a late worker cannot authorize entry between cleanup ticks. It queues entry and records authorization. Only a later occupied sensor sample records arrival; a newer lowered/vacant sample after arrival records departure and queues cleanup. Completion requires the same confirmed safe physical cleanup as cancellation. No charging measurement is implied.

Protection pricing is explicitly mocked: ten free minutes, ten cents per later minute and a three-euro cap, with a persistent stop at matched recognition, cancellation or the no-show/window deadline. Blocked/faulty/uncertain sessions waive that mock amount. No money is collected. See [scheduled sessions](SCHEDULED-SESSIONS.md) and [database contracts](DATABASE.md) for the exact lifecycle.

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

Independent SQL clients also verify that different plugs on one physical bay yield one booking, competing workers yield one claim, and two requests for a dispatch permit yield one permit. No provider command is sent by those tests. Hosted service-role/PostgREST behavior, actual physical interlocks, movement and a full real charging cycle still require on-site verification.

The fifth-migration suite additionally covers future scheduling without early commands, whole-bay calendar overlap/adjacency, immediate-route conflict rollback, matching-event authorization, sensor arrival/departure, cancellation retention, the no-show grace period and idle lowering without an allocation. Independent clients verify competing future slots and identical retries across separate PostgreSQL sessions.
