-- Rollback-only assertions for app-only virtual directory holds.
-- Use the isolated test-database.mjs harness; no directory API is queried.
begin;

create function pg_temp.assert_true(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_condition is distinct from true then raise exception 'Assertion failed: %', p_message; end if;
end;
$$;
create function pg_temp.expect_error(p_sql text, p_expected text)
returns void language plpgsql as $$
declare v_message text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_message = message_text;
    if v_message = p_expected then return; end if;
    raise exception 'Expected error %, received %', p_expected, v_message;
  end;
  raise exception 'Expected error %, but the statement succeeded', p_expected;
end;
$$;

select pg_temp.assert_true(
  not pg_catalog.has_table_privilege('authenticated', 'public.directory_plug_reservations', 'SELECT')
  and not pg_catalog.has_table_privilege('authenticated', 'public.directory_plug_reservations', 'INSERT')
  and not pg_catalog.has_table_privilege('authenticated', 'public.directory_plug_reservations', 'UPDATE')
  and not pg_catalog.has_table_privilege('authenticated', 'public.directory_plug_reservations', 'DELETE')
  and not pg_catalog.has_table_privilege('anon', 'public.directory_plug_reservations', 'SELECT')
  and (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.directory_plug_reservations'::regclass),
  'Virtual holds have RLS and no direct client table grants'
);
select pg_temp.assert_true(
  not pg_catalog.has_function_privilege('anon', 'public.list_directory_holds(bigint[])', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'public.reserve_directory_plug(bigint,text,integer,uuid)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'public.cancel_directory_hold(uuid)', 'EXECUTE')
  and pg_catalog.has_function_privilege('authenticated', 'public.list_directory_holds(bigint[])', 'EXECUTE')
  and pg_catalog.has_function_privilege('authenticated', 'public.reserve_directory_plug(bigint,text,integer,uuid)', 'EXECUTE')
  and pg_catalog.has_function_privilege('authenticated', 'public.cancel_directory_hold(uuid)', 'EXECUTE'),
  'Only authenticated guest identities execute directory hold RPCs'
);
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
select pg_temp.expect_error('select public.list_directory_holds(array[]::bigint[])', 'AUTH_REQUIRED');
select pg_temp.expect_error(
  $$select public.reserve_directory_plug(101, repeat('a',64),10,'dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')$$,
  'AUTH_REQUIRED'
);
select pg_temp.expect_error(
  $$select public.cancel_directory_hold('dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')$$, 'AUTH_REQUIRED'
);

insert into auth.users(id) values
  ('d1111111-1111-4111-8111-111111111111'), ('d2222222-2222-4222-8222-222222222222');
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', 'd1111111-1111-4111-8111-111111111111', true);

select pg_temp.expect_error('select public.list_directory_holds(null)', 'INVALID_STATIONS');
select pg_temp.expect_error('select public.list_directory_holds(array[0]::bigint[])', 'INVALID_STATIONS');
select pg_temp.expect_error('select public.list_directory_holds(array[null]::bigint[])', 'INVALID_STATIONS');
select pg_temp.expect_error('select public.list_directory_holds(array[9007199254740992]::bigint[])', 'INVALID_STATIONS');
select pg_temp.expect_error('select public.list_directory_holds(array[[1,2],[3,4]]::bigint[])', 'INVALID_STATIONS');
select pg_temp.expect_error('select public.list_directory_holds(array(select generate_series(1,501))::bigint[])', 'INVALID_STATIONS');
select pg_temp.expect_error(
  $$select public.reserve_directory_plug(0,repeat('a',64),10,'dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')$$, 'INVALID_STATION'
);
select pg_temp.expect_error(
  $$select public.reserve_directory_plug(9007199254740992,repeat('a',64),10,'dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')$$, 'INVALID_STATION'
);
select pg_temp.expect_error(
  $$select public.reserve_directory_plug(101,repeat('A',64),10,'dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')$$, 'INVALID_SLOT'
);
select pg_temp.expect_error(
  $$select public.reserve_directory_plug(101,repeat('a',63),10,'dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')$$, 'INVALID_SLOT'
);
select pg_temp.expect_error(
  $$select public.reserve_directory_plug(101,repeat('a',64),0,'dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')$$, 'INVALID_HOLD'
);
select pg_temp.expect_error(
  $$select public.reserve_directory_plug(101,repeat('a',64),31,'dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')$$, 'INVALID_HOLD'
);
select pg_temp.expect_error(
  $$select public.reserve_directory_plug(101,repeat('a',64),10,null)$$, 'REQUEST_ID_REQUIRED'
);

do $$
declare v_empty jsonb; v_first jsonb; v_list jsonb;
begin
  v_empty := public.list_directory_holds(array[101,102]::bigint[]);
  perform pg_temp.assert_true(v_empty->'holds' = '[]'::jsonb and v_empty->>'serverNow' is not null,
    'No booking rows means unreserved app slots after a successful scoped read');
  v_first := public.reserve_directory_plug(101,repeat('a',64),10,'dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');
  perform pg_catalog.set_config('bayready.directory.first',v_first::text,true);
  perform pg_temp.assert_true(v_first->>'status' = 'held'
    and (v_first->>'expiresAt')::timestamptz - (v_first->>'createdAt')::timestamptz = interval '10 minutes',
    'Database clock sets the app hold duration');
  perform pg_temp.assert_true(
    public.reserve_directory_plug(101,repeat('a',64),10,'dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1') = v_first,
    'Identical request returns the same ID and deadline');
  perform public.reserve_directory_plug(102,repeat('b',64),5,'dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2');
  v_list := public.list_directory_holds(array[]::bigint[]);
  perform pg_temp.assert_true(pg_catalog.jsonb_array_length(v_list->'holds') = 2,
    'Empty viewport still recovers all caller-owned holds, including orphan slot keys');
  perform pg_temp.assert_true(not exists (
    select 1 from pg_catalog.jsonb_array_elements(v_list->'holds') h
    where not (h.value->>'isMine')::boolean or h.value->>'myReservationId' is null
      or (h.value->>'reservedUntil')::timestamptz <= (v_list->>'serverNow')::timestamptz
      or h.value ? 'owner_id' or h.value ? 'ownerId'
  ), 'Owned projection is private and every returned deadline is active');
end;
$$;
select pg_temp.expect_error(
  $$select public.reserve_directory_plug(101,repeat('b',64),10,'dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')$$, 'IDEMPOTENCY_CONFLICT'
);
select pg_temp.expect_error(
  $$select public.reserve_directory_plug(102,repeat('a',64),10,'dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')$$, 'IDEMPOTENCY_CONFLICT'
);
select pg_temp.expect_error(
  $$select public.reserve_directory_plug(101,repeat('a',64),5,'dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')$$, 'IDEMPOTENCY_CONFLICT'
);

select pg_catalog.set_config('request.jwt.claim.sub', 'd2222222-2222-4222-8222-222222222222', true);
do $$
declare v_list jsonb; v_first jsonb := pg_catalog.current_setting('bayready.directory.first')::jsonb;
begin
  perform public.reserve_directory_plug(103,repeat('c',64),10,'dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3');
  v_list := public.list_directory_holds(array[101]::bigint[]);
  perform pg_temp.assert_true(pg_catalog.jsonb_array_length(v_list->'holds') = 2,
    'Read returns requested-station holds plus own holds, excluding other unrequested stations');
  perform pg_temp.assert_true(exists (
    select 1 from pg_catalog.jsonb_array_elements(v_list->'holds') h
    where h.value->>'stationId' = '101' and not (h.value->>'isMine')::boolean
      and h.value->'myReservationId' = 'null'::jsonb
  ), 'Other users see the held slot and expiry without its owner or reservation ID');
  perform pg_temp.expect_error(pg_catalog.format('select public.cancel_directory_hold(%L)',v_first->>'id'),'RESERVATION_NOT_FOUND');
end;
$$;
select pg_temp.expect_error(
  $$select public.reserve_directory_plug(101,repeat('a',64),10,'dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4')$$, 'PLUG_RESERVED'
);
select public.reserve_directory_plug(101,repeat('b',64),10,'dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4');

select pg_catalog.set_config('request.jwt.claim.sub', 'd1111111-1111-4111-8111-111111111111', true);
do $$
declare v_first jsonb := pg_catalog.current_setting('bayready.directory.first')::jsonb; v_cancelled jsonb; v_expiring jsonb;
begin
  v_cancelled := public.cancel_directory_hold((v_first->>'id')::uuid);
  perform pg_temp.assert_true(v_cancelled->>'status' = 'cancelled', 'Owner can cancel without a current directory listing');
  perform pg_temp.assert_true(public.cancel_directory_hold((v_first->>'id')::uuid) = v_cancelled,'Repeated cancellation is safe');
  perform pg_temp.assert_true(
    public.reserve_directory_plug(101,repeat('a',64),10,'dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1') = v_cancelled,
    'Retry after cancellation never creates a replacement hold');
  v_expiring := public.reserve_directory_plug(101,repeat('a',64),10,'dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5');
  perform pg_catalog.set_config('bayready.directory.expiring',v_expiring::text,true);
end;
$$;
reset role;
with t as (select pg_catalog.clock_timestamp() as observed_at)
update public.directory_plug_reservations r
set created_at = t.observed_at - interval '11 minutes', expires_at = t.observed_at - interval '1 minute'
from t where r.id = (pg_catalog.current_setting('bayready.directory.expiring')::jsonb->>'id')::uuid;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', 'd2222222-2222-4222-8222-222222222222', true);
do $$
declare v_list jsonb; v_replacement jsonb;
begin
  v_list := public.list_directory_holds(array[101]::bigint[]);
  perform pg_temp.assert_true(not exists (
    select 1 from pg_catalog.jsonb_array_elements(v_list->'holds') h
    where h.value->>'stationId' = '101' and h.value->>'slotKey' = repeat('a',64)
  ), 'Elapsed holds disappear on a database read without a cleanup job');
  v_replacement := public.reserve_directory_plug(101,repeat('a',64),10,'dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6');
  perform pg_temp.assert_true(v_replacement->>'status' = 'held','Next user can book after database-clock expiry');
end;
$$;
select pg_catalog.set_config('request.jwt.claim.sub', 'd1111111-1111-4111-8111-111111111111', true);
do $$
declare v_old jsonb;
begin
  v_old := public.reserve_directory_plug(101,repeat('a',64),10,'dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5');
  perform pg_temp.assert_true(v_old->>'status' = 'expired','Retry preserves expired history');
  perform pg_temp.assert_true(public.cancel_directory_hold((v_old->>'id')::uuid)->>'status' = 'expired',
    'Cancelling expired history does not affect its replacement');
end;
$$;
reset role;
do $$
begin
  begin
    insert into public.directory_plug_reservations
      (station_id,slot_key,owner_id,created_at,expires_at,idempotency_key)
    values (101,repeat('a',64),'d1111111-1111-4111-8111-111111111111',
      '2020-01-01T00:00:00Z','2020-01-01T00:10:00Z','dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9');
  exception when unique_violation then return;
  end;
  raise exception 'Partial unique index accepted two held rows for the same virtual slot';
end;
$$;

rollback;
select 'Directory app-only hold assertions passed; fixtures rolled back.' as result;
