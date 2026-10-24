-- Rollback-only integration assertions for a Supabase PostgreSQL database.
-- Run as an administrator after both migrations:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/hierarchy_contract.sql
-- No real users, plates, hardware commands, or directory records are used.
-- Parallel-client lock contention needs a separate connection-level check.
-- The harness first loads pre_hierarchy_fixture.sql before the second migration
-- so this suite also proves that existing bookings survive the schema upgrade.

begin;

create function pg_temp.assert_true(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_condition is distinct from true then
    raise exception 'Assertion failed: %', p_message;
  end if;
end;
$$;

create function pg_temp.expect_error(p_sql text, p_expected text)
returns void language plpgsql as $$
declare
  v_message text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_message = message_text;
    if v_message = p_expected then
      return;
    end if;
    raise exception 'Expected error %, received %', p_expected, v_message;
  end;
  raise exception 'Expected error %, but the statement succeeded', p_expected;
end;
$$;

select pg_temp.assert_true(
  not pg_catalog.has_function_privilege('anon', 'public.list_bay_availability()', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'public.reserve_bay(uuid,integer,uuid,uuid)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'public.cancel_reservation(uuid)', 'EXECUTE'),
  'Unauthenticated callers cannot execute booking RPCs'
);
select pg_temp.assert_true(
  pg_catalog.has_function_privilege('authenticated', 'public.list_bay_availability()', 'EXECUTE')
  and pg_catalog.has_function_privilege('authenticated', 'public.reserve_bay(uuid,integer,uuid,uuid)', 'EXECUTE')
  and pg_catalog.has_function_privilege('authenticated', 'public.cancel_reservation(uuid)', 'EXECUTE'),
  'Anonymous Auth sessions can execute booking RPCs using the authenticated role'
);
select pg_temp.assert_true(
  not pg_catalog.has_table_privilege('authenticated', 'public.booking_reservations', 'SELECT')
  and not pg_catalog.has_table_privilege('authenticated', 'public.booking_reservations', 'INSERT')
  and not pg_catalog.has_table_privilege('authenticated', 'public.booking_reservations', 'UPDATE')
  and not pg_catalog.has_table_privilege('authenticated', 'public.booking_reservations', 'DELETE')
  and not pg_catalog.has_table_privilege('authenticated', 'public.bookable_bays', 'SELECT')
  and not pg_catalog.has_table_privilege('authenticated', 'public.charging_locations', 'SELECT')
  and not pg_catalog.has_table_privilege('authenticated', 'public.charging_locations', 'INSERT')
  and not pg_catalog.has_table_privilege('authenticated', 'public.bay_connectors', 'SELECT')
  and not pg_catalog.has_table_privilege('authenticated', 'public.bay_connectors', 'UPDATE')
  and not pg_catalog.has_table_privilege('anon', 'public.booking_reservations', 'SELECT'),
  'Phones cannot access raw booking rows or inventory tables'
);
select pg_temp.assert_true(
  (select pg_catalog.bool_and(c.relrowsecurity) from pg_catalog.pg_class c
   where c.oid in ('public.bookable_bays'::regclass, 'public.booking_reservations'::regclass, 'public.charging_locations'::regclass, 'public.bay_connectors'::regclass)),
  'RLS is enabled on all inventory and reservation tables'
);
select pg_temp.assert_true(
  pg_catalog.to_regprocedure('public.reserve_bay(uuid,integer,uuid)') is null,
  'Old reserve overload is removed to keep PostgREST RPC resolution unambiguous'
);
select pg_temp.assert_true(
  (select pg_catalog.count(*) = 3 from public.bookable_bays
   where location_id = '00000000-0000-4000-8000-000000000100')
  and (select pg_catalog.count(*) = 4 from public.bay_connectors c
       join public.bookable_bays b on b.id = c.bay_id
       where b.location_id = '00000000-0000-4000-8000-000000000100' and c.enabled),
  'Demo location has three physical bays and four enabled plugs, not four bays'
);
select pg_temp.assert_true(
  (select pg_catalog.count(*) = 1
   from public.booking_reservations r
   join public._bayready_upgrade_expected e on e.id = r.id
   join public.bookable_bays b on b.id = r.bay_id
   join public.charging_locations l on l.id = b.location_id
   join public.bay_connectors c on c.id = r.connector_id and c.bay_id = r.bay_id
   where (r.id, r.bay_id, r.owner_id, r.starts_at, r.expires_at, r.status, r.idempotency_key, r.created_at)
     is not distinct from
     (e.id, e.bay_id, e.owner_id, e.starts_at, e.expires_at, e.status, e.idempotency_key, e.created_at)
     and l.goingelectric_id = e.expected_directory_id
     and l.latitude = e.expected_latitude and l.longitude = e.expected_longitude
     and b.label = e.expected_bay_label
     and c.connector_type = 'UNKNOWN' and c.power_kw = 0 and not c.enabled),
  'Upgrade preserves existing hold identity, timestamps, owner, metadata, and unknown historical connector selection'
);

select pg_catalog.set_config('request.jwt.claim.sub', '', true);
select pg_catalog.set_config('request.jwt.claims', '{}', true);
select pg_temp.expect_error('select public.list_bay_availability()', 'AUTH_REQUIRED');
select pg_temp.expect_error(
  $$select public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1')$$,
  'AUTH_REQUIRED'
);
select pg_temp.expect_error(
  $$select public.cancel_reservation('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')$$,
  'AUTH_REQUIRED'
);

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
insert into public.charging_locations (id, label, latitude, longitude) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa00', 'Fictional contract-test location', 52.52, 13.405);
insert into public.bookable_bays (id, location_id, label, integration_mode, ecurious_lock_id, enabled) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa00', 'Fictional contract-test demo bay A', 'demo', null, true),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa00', 'Fictional contract-test demo bay B', 'demo', null, true),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa00', 'Fictional hardware mapping; commands prohibited', 'ecurious', 'fictional-contract-test-lock', true),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa00', 'Fictional disabled inventory', 'demo', null, false);
insert into public.bay_connectors (id, bay_id, label, connector_type, power_kw, enabled) values
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'A CCS', 'CCS', 150, true),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'B CCS', 'CCS', 150, true),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc3', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'Hardware CCS', 'CCS', 150, true),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc4', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'Disabled bay Type 2', 'Typ2', 22, true),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc5', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'A Type 2', 'Typ2', 22, true),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc6', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'A unavailable connector', 'CHAdeMO', 50, false);

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

do $$
declare
  v_result jsonb;
  v_bay jsonb;
  v_first jsonb;
begin
  v_result := public.list_bay_availability();
  perform pg_temp.assert_true(v_result->>'serverNow' is not null, 'Availability includes database observation time');
  select x.value into v_bay from pg_catalog.jsonb_array_elements(v_result->'bays') x
    where x.value->>'id' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  perform pg_temp.assert_true(
    v_bay->>'availability' = 'unreserved' and (v_bay->'myReservationId') = 'null'::jsonb,
    'New demo bay starts unreserved without a reservation ID'
  );
  perform pg_temp.assert_true(
    v_bay->>'locationId' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa00'
      and v_bay->>'locationLabel' = 'Fictional contract-test location'
      and (v_bay->>'latitude')::numeric = 52.52
      and (v_bay->>'longitude')::numeric = 13.405
      and pg_catalog.jsonb_array_length(v_bay->'connectors') = 3,
    'Bay projection includes authoritative location and every registered plug'
  );
  perform pg_temp.assert_true(
    exists (select 1 from pg_catalog.jsonb_array_elements(v_bay->'connectors') c
      where c.value->>'id' = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc6'
        and not (c.value->>'enabled')::boolean),
    'Disabled connector is visible as unavailable rather than silently bookable'
  );
  perform pg_temp.assert_true(
    not exists (select 1 from pg_catalog.jsonb_array_elements(v_result->'bays') x
      where x.value->>'id' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'),
    'Disabled inventory is omitted'
  );

  v_first := public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1');
  perform pg_temp.assert_true(
    v_first->>'status' = 'held'
      and v_first->>'connectorId' = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
      and (v_first->>'expiresAt')::timestamptz - (v_first->>'startsAt')::timestamptz = interval '10 minutes',
    'Reservation uses the selected hold duration and database timestamps'
  );
  perform pg_catalog.set_config('bayready.test.first', v_first::text, true);
  perform pg_temp.assert_true(
    public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1') = v_first,
    'Identical request returns the same hold without extending expiry'
  );

  v_result := public.list_bay_availability();
  select x.value into v_bay from pg_catalog.jsonb_array_elements(v_result->'bays') x
    where x.value->>'id' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  perform pg_temp.assert_true(
    v_bay->>'availability' = 'reserved'
      and (v_bay->>'isMine')::boolean
      and v_bay->>'myReservationId' = v_first->>'id'
      and v_bay->>'myConnectorId' = v_first->>'connectorId'
      and (v_bay->>'reservedUntil')::timestamptz = (v_first->>'expiresAt')::timestamptz,
    'Owner can recover their booking ID and deadline after app restart'
  );
  perform pg_temp.assert_true(
    not (v_bay ? 'ownerId') and not (v_bay ? 'owner_id'),
    'Availability never exposes an owner ID'
  );
end;
$$;

select pg_temp.expect_error(
  $$select public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 5, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1')$$,
  'IDEMPOTENCY_CONFLICT'
);
select pg_temp.expect_error(
  $$select public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2')$$,
  'IDEMPOTENCY_CONFLICT'
);
select pg_temp.expect_error(
  $$select public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc5')$$,
  'IDEMPOTENCY_CONFLICT'
);
select pg_temp.expect_error(
  $$select public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2')$$,
  'CONNECTOR_REQUIRED'
);
select pg_temp.expect_error(
  $$select public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1')$$,
  'CONNECTOR_NOT_AVAILABLE'
);
select pg_temp.expect_error(
  $$select public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc6')$$,
  'CONNECTOR_NOT_AVAILABLE'
);
select pg_temp.expect_error(
  $$select public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc5')$$,
  'BAY_RESERVED'
);
select pg_temp.expect_error(
  $$select public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 0, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2')$$,
  'INVALID_HOLD'
);
select pg_temp.expect_error(
  $$select public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 31, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2')$$,
  'INVALID_HOLD'
);
select pg_temp.expect_error(
  $$select public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 10)$$,
  'REQUEST_ID_REQUIRED'
);
select pg_temp.expect_error(
  $$select public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3')$$,
  'BAY_NOT_BOOKABLE'
);
select pg_temp.expect_error(
  $$select public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4')$$,
  'BAY_DISABLED'
);
select pg_temp.expect_error(
  $$select public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1')$$,
  'BAY_NOT_FOUND'
);

select pg_catalog.set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
do $$
declare
  v_bay jsonb;
  v_first jsonb := pg_catalog.current_setting('bayready.test.first')::jsonb;
begin
  select x.value into v_bay from pg_catalog.jsonb_array_elements(public.list_bay_availability()->'bays') x
    where x.value->>'id' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  perform pg_temp.assert_true(
    v_bay->>'availability' = 'reserved'
      and not (v_bay->>'isMine')::boolean
      and v_bay->'myReservationId' = 'null'::jsonb
      and v_bay->'myConnectorId' = 'null'::jsonb
      and v_bay->>'reservedUntil' is not null,
    'Another user sees the deadline but not the owner or reservation ID'
  );
  perform pg_temp.expect_error(
    pg_catalog.format('select public.cancel_reservation(%L)', v_first->>'id'),
    'RESERVATION_NOT_FOUND'
  );
end;
$$;
select pg_temp.expect_error(
  $$select public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1')$$,
  'BAY_RESERVED'
);

select pg_catalog.set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
do $$
declare
  v_first jsonb := pg_catalog.current_setting('bayready.test.first')::jsonb;
  v_cancelled jsonb;
  v_next jsonb;
begin
  v_cancelled := public.cancel_reservation((v_first->>'id')::uuid);
  perform pg_temp.assert_true(v_cancelled->>'status' = 'cancelled', 'Owner can cancel an active hold');
  perform pg_temp.assert_true(
    public.cancel_reservation((v_first->>'id')::uuid) = v_cancelled,
    'Cancellation can be repeated safely'
  );
  perform pg_temp.assert_true(
    public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1') = v_cancelled,
    'Retrying a cancelled request never creates a new hold'
  );
  v_next := public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1');
  perform pg_temp.assert_true(v_next->>'id' <> v_first->>'id', 'A new request can reserve after cancellation');
  perform pg_catalog.set_config('bayready.test.expiring', v_next::text, true);
end;
$$;

reset role;
-- Advance this fictional test hold into the past without waiting ten minutes.
with t as (select pg_catalog.clock_timestamp() as observed_at)
update public.booking_reservations r
set starts_at = t.observed_at - interval '11 minutes',
    expires_at = t.observed_at - interval '1 minute'
from t
where r.id = (pg_catalog.current_setting('bayready.test.expiring')::jsonb->>'id')::uuid;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
do $$
declare
  v_bay jsonb;
  v_next jsonb;
begin
  select x.value into v_bay from pg_catalog.jsonb_array_elements(public.list_bay_availability()->'bays') x
    where x.value->>'id' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  perform pg_temp.assert_true(
    v_bay->>'availability' = 'unreserved' and v_bay->'reservedUntil' = 'null'::jsonb,
    'Read-time availability excludes elapsed holds without relying on a cron job'
  );
  v_next := public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1');
  perform pg_temp.assert_true(v_next->>'status' = 'held', 'Next user can reserve after database-clock expiry');
end;
$$;

select pg_catalog.set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
do $$
declare
  v_expired jsonb;
begin
  v_expired := public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1');
  perform pg_temp.assert_true(v_expired->>'status' = 'expired', 'Retrying an expired request preserves its history');
  perform pg_temp.assert_true(
    public.cancel_reservation((v_expired->>'id')::uuid)->>'status' = 'expired',
    'Cancelling an expired hold does not turn it into a new reservation'
  );
end;
$$;

reset role;
do $$
declare
  v_power numeric;
begin
  foreach v_power in array array['-1', '2001', 'NaN', 'Infinity']::numeric[] loop
    begin
      insert into public.bay_connectors (bay_id, label, connector_type, power_kw, enabled)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'Invalid test power', 'CCS', v_power, false);
    exception when check_violation then
      continue;
    end;
    raise exception 'Connector power range accepted invalid value %', v_power;
  end loop;
end;
$$;
do $$
begin
  begin
    insert into public.booking_reservations
      (bay_id, connector_id, owner_id, starts_at, expires_at, status, idempotency_key)
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
      '11111111-1111-4111-8111-111111111111',
      '2020-01-01T00:00:00Z', '2020-01-01T00:10:00Z', 'cancelled',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9'
    );
  exception when foreign_key_violation then
    return;
  end;
  raise exception 'Composite foreign key accepted a connector belonging to another physical bay';
end;
$$;
select pg_temp.assert_true(
  (select pg_catalog.count(*) = 1 from public.booking_reservations
   where bay_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' and status = 'held'),
  'Only one held row remains after cancellation, expiry, and replacement'
);

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000002', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"90000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
declare
  v_cancelled jsonb;
begin
  v_cancelled := public.cancel_reservation('90000000-0000-4000-8000-000000000003');
  perform pg_temp.assert_true(
    v_cancelled->>'status' = 'cancelled' and v_cancelled->>'connectorId' is not null,
    'Owner can cancel an upgraded hold even though its unrecorded legacy plug is disabled'
  );
  perform pg_temp.assert_true(
    public.reserve_bay(
      '90000000-0000-4000-8000-000000000001', 10,
      '90000000-0000-4000-8000-000000000004', (v_cancelled->>'connectorId')::uuid
    ) = v_cancelled,
    'A retry on upgraded history preserves its disabled legacy plug and cancellation'
  );
end;
$$;
reset role;

rollback;
select 'BayReady location/bay/connector contract assertions passed; fixture changes rolled back.' as result;
