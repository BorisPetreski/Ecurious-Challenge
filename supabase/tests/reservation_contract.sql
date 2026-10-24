-- Rollback-only integration assertions for a Supabase PostgreSQL database.
-- Run as an administrator after the migration:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/reservation_contract.sql
-- No real users, plates, hardware commands, or directory records are used.
-- Parallel-client lock contention needs a separate connection-level check.

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
  and not pg_catalog.has_function_privilege('anon', 'public.reserve_bay(uuid,integer,uuid)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'public.cancel_reservation(uuid)', 'EXECUTE'),
  'Unauthenticated callers cannot execute booking RPCs'
);
select pg_temp.assert_true(
  pg_catalog.has_function_privilege('authenticated', 'public.list_bay_availability()', 'EXECUTE')
  and pg_catalog.has_function_privilege('authenticated', 'public.reserve_bay(uuid,integer,uuid)', 'EXECUTE')
  and pg_catalog.has_function_privilege('authenticated', 'public.cancel_reservation(uuid)', 'EXECUTE'),
  'Anonymous Auth sessions can execute booking RPCs using the authenticated role'
);
select pg_temp.assert_true(
  not pg_catalog.has_table_privilege('authenticated', 'public.booking_reservations', 'SELECT')
  and not pg_catalog.has_table_privilege('authenticated', 'public.booking_reservations', 'INSERT')
  and not pg_catalog.has_table_privilege('authenticated', 'public.booking_reservations', 'UPDATE')
  and not pg_catalog.has_table_privilege('authenticated', 'public.booking_reservations', 'DELETE')
  and not pg_catalog.has_table_privilege('authenticated', 'public.bookable_bays', 'SELECT')
  and not pg_catalog.has_table_privilege('anon', 'public.booking_reservations', 'SELECT'),
  'Phones cannot access raw booking rows or inventory tables'
);
select pg_temp.assert_true(
  (select pg_catalog.bool_and(c.relrowsecurity) from pg_catalog.pg_class c
   where c.oid in ('public.bookable_bays'::regclass, 'public.booking_reservations'::regclass)),
  'RLS is enabled on both tables'
);

select pg_catalog.set_config('request.jwt.claim.sub', '', true);
select pg_catalog.set_config('request.jwt.claims', '{}', true);
select pg_temp.expect_error('select public.list_bay_availability()', 'AUTH_REQUIRED');
select pg_temp.expect_error(
  $$select public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')$$,
  'AUTH_REQUIRED'
);
select pg_temp.expect_error(
  $$select public.cancel_reservation('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')$$,
  'AUTH_REQUIRED'
);

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
insert into public.bookable_bays (id, label, integration_mode, ecurious_lock_id, enabled) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Fictional contract-test demo bay A', 'demo', null, true),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'Fictional contract-test demo bay B', 'demo', null, true),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'Fictional hardware mapping; commands prohibited', 'ecurious', 'fictional-contract-test-lock', true),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'Fictional disabled inventory', 'demo', null, false);

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
    not exists (select 1 from pg_catalog.jsonb_array_elements(v_result->'bays') x
      where x.value->>'id' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'),
    'Disabled inventory is omitted'
  );

  v_first := public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');
  perform pg_temp.assert_true(
    v_first->>'status' = 'held'
      and (v_first->>'expiresAt')::timestamptz - (v_first->>'startsAt')::timestamptz = interval '10 minutes',
    'Reservation uses the selected hold duration and database timestamps'
  );
  perform pg_catalog.set_config('bayready.test.first', v_first::text, true);
  perform pg_temp.assert_true(
    public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1') = v_first,
    'Identical request returns the same hold without extending expiry'
  );

  v_result := public.list_bay_availability();
  select x.value into v_bay from pg_catalog.jsonb_array_elements(v_result->'bays') x
    where x.value->>'id' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  perform pg_temp.assert_true(
    v_bay->>'availability' = 'reserved'
      and (v_bay->>'isMine')::boolean
      and v_bay->>'myReservationId' = v_first->>'id'
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
  $$select public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 5, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')$$,
  'IDEMPOTENCY_CONFLICT'
);
select pg_temp.expect_error(
  $$select public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')$$,
  'IDEMPOTENCY_CONFLICT'
);
select pg_temp.expect_error(
  $$select public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 0, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2')$$,
  'INVALID_HOLD'
);
select pg_temp.expect_error(
  $$select public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 31, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2')$$,
  'INVALID_HOLD'
);
select pg_temp.expect_error(
  $$select public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 10)$$,
  'REQUEST_ID_REQUIRED'
);
select pg_temp.expect_error(
  $$select public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2')$$,
  'BAY_NOT_BOOKABLE'
);
select pg_temp.expect_error(
  $$select public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2')$$,
  'BAY_DISABLED'
);
select pg_temp.expect_error(
  $$select public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2')$$,
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
  $$select public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3')$$,
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
    public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1') = v_cancelled,
    'Retrying a cancelled request never creates a new hold'
  );
  v_next := public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2');
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
  v_next := public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3');
  perform pg_temp.assert_true(v_next->>'status' = 'held', 'Next user can reserve after database-clock expiry');
end;
$$;

select pg_catalog.set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
do $$
declare
  v_expired jsonb;
begin
  v_expired := public.reserve_bay('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 10, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2');
  perform pg_temp.assert_true(v_expired->>'status' = 'expired', 'Retrying an expired request preserves its history');
  perform pg_temp.assert_true(
    public.cancel_reservation((v_expired->>'id')::uuid)->>'status' = 'expired',
    'Cancelling an expired hold does not turn it into a new reservation'
  );
end;
$$;

reset role;
select pg_temp.assert_true(
  (select pg_catalog.count(*) = 1 from public.booking_reservations
   where bay_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' and status = 'held'),
  'Only one held row remains after cancellation, expiry, and replacement'
);

rollback;
select 'BayReady reservation contract assertions passed; fixture changes rolled back.' as result;
