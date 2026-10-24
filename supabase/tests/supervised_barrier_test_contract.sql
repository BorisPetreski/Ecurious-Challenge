-- Entirely synthetic isolated Postgres fixture. No hardware/API requests.
begin;
create function pg_temp.assert_true(p boolean,m text) returns void language plpgsql as $$
begin if p is distinct from true then raise exception 'Assertion failed: %',m; end if; end;
$$;
create function pg_temp.expect_error(q text,m text) returns void language plpgsql as $$
declare actual text;
begin begin execute q; exception when others then get stacked diagnostics actual=message_text;
  if actual=m then return; end if; raise exception 'Expected %, got %',m,actual; end;
  raise exception 'Expected %, statement succeeded',m; end;
$$;
create function pg_temp.supervised_request(p_key uuid,p_clear boolean default true,
  p_bay uuid default 'f0000000-0000-4000-8000-000000000001',
  p_connector uuid default 'f0000000-0000-4000-8000-000000000011') returns jsonb language sql as $$
  select public.request_supervised_hardware_slot(p_bay,p_connector,
    current_setting('supervised.test.now')::timestamptz,current_setting('supervised.test.now')::timestamptz+interval '10 minutes',
    p_key,repeat('f',64),'•••11','now',p_clear)
$$;
insert into auth.users(id) values ('f1111111-1111-4111-8111-111111111111'),('f2222222-2222-4222-8222-222222222222');
insert into public.charging_locations(id,label) values ('f0000000-0000-4000-8000-000000000100','Synthetic supervised location');
insert into public.bookable_bays(id,location_id,label,integration_mode,ecurious_lock_id,enabled) values
 ('f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000100','Synthetic assigned barrier','ecurious','lock-0002',true),
 ('f0000000-0000-4000-8000-000000000002','f0000000-0000-4000-8000-000000000100','Synthetic different barrier','ecurious','fictional-other-lock',true);
insert into public.bay_connectors(id,bay_id,label,connector_type,power_kw,enabled) values
 ('f0000000-0000-4000-8000-000000000011','f0000000-0000-4000-8000-000000000001','Synthetic non-charging interface','BARRIER_TEST',0,true),
 ('f0000000-0000-4000-8000-000000000021','f0000000-0000-4000-8000-000000000002','Synthetic other interface','BARRIER_TEST',0,true);
insert into public.hardware_controls(bay_id,enabled,interlocks_confirmed,observed_at,barrier,occupancy,faulted,access_mode,phase,reason)
 select id,true,true,clock_timestamp()-interval '3 minutes','lowered','vacant',false,'disabled','blocked','TELEMETRY_UNKNOWN'
 from public.bookable_bays where id in ('f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000002');
select set_config('supervised.test.now',clock_timestamp()::text,true);
select set_config('supervised.test.provider',(select observed_at::text from public.hardware_controls where bay_id='f0000000-0000-4000-8000-000000000001'),true);
select pg_temp.assert_true(not has_table_privilege('authenticated','public.hardware_controls','UPDATE')
 and not has_function_privilege('authenticated','public.mark_supervised_hardware_dispatch(uuid,uuid,timestamptz,text,text,boolean,text)','EXECUTE')
 and not has_function_privilege('anon','public.request_supervised_hardware_slot(uuid,uuid,timestamptz,timestamptz,uuid,text,text,text,boolean)','EXECUTE'),
 'Phones cannot enroll supervised mode or mint a private dispatch permit');
set local role authenticated;
select pg_temp.expect_error($q$select pg_temp.supervised_request('fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')$q$,'AUTH_REQUIRED');
select set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
-- Normal booking intent keeps its unchanged stale-sensor movement guard.
do $$ declare w jsonb; t timestamptz:=current_setting('supervised.test.now')::timestamptz; begin
 w:=public.request_hardware_slot('f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000011',
   t,t+interval '10 minutes','fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0',repeat('f',64),'•••11','now');
 perform set_config('supervised.test.normal',w#>>'{slot,id}',true);
end; $$;
set local role service_role;
select public.reconcile_hardware_slots();
reset role;
select pg_temp.assert_true(not exists(select 1 from public.hardware_operations where bay_id='f0000000-0000-4000-8000-000000000001'),
 'Normal stale sample cannot queue a physical movement');
set local role authenticated;
select public.cancel_hardware_slot(current_setting('supervised.test.normal')::uuid);
select pg_temp.expect_error($q$select pg_temp.supervised_request('fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')$q$,'SUPERVISED_TEST_DISABLED');
reset role;
update public.hardware_controls set supervised_test_enabled=true where bay_id in
 ('f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.expect_error($q$select pg_temp.supervised_request('fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',false)$q$,'OPERATOR_OBSERVATION_REQUIRED');
select pg_temp.expect_error($q$select pg_temp.supervised_request('fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',true,
 'f0000000-0000-4000-8000-000000000002','f0000000-0000-4000-8000-000000000021')$q$,'SUPERVISED_TEST_DISABLED');
reset role;
update public.hardware_controls set observed_at=clock_timestamp(),occupancy='occupied' where bay_id='f0000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect_error($q$select pg_temp.supervised_request('fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')$q$,'SUPERVISED_TEST_UNAVAILABLE');
reset role;
update public.hardware_controls set observed_at=current_setting('supervised.test.provider')::timestamptz,occupancy='vacant',faulted=true
 where bay_id='f0000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect_error($q$select pg_temp.supervised_request('fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')$q$,'SUPERVISED_TEST_UNAVAILABLE');
reset role;
update public.hardware_controls set faulted=false,access_mode='specific-plates' where bay_id='f0000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect_error($q$select pg_temp.supervised_request('fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')$q$,'SUPERVISED_TEST_UNAVAILABLE');
reset role;
update public.hardware_controls set access_mode='disabled' where bay_id='f0000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ declare w jsonb; again jsonb; begin
 w:=pg_temp.supervised_request('fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');
 again:=pg_temp.supervised_request('fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');
 perform pg_temp.assert_true(w#>>'{slot,id}'=again#>>'{slot,id}' and w#>>'{slot,status}'='active',
   'Owner observation atomically allocates one supervised Now booking; retry returns the same booking');
end; $$;
select set_config('request.jwt.claim.sub','f2222222-2222-4222-8222-222222222222',true);
select pg_temp.expect_error($q$select pg_temp.supervised_request('fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')$q$,'SUPERVISED_TEST_UNAVAILABLE');
reset role;
select pg_temp.assert_true((select count(*)=1 from public.hardware_operations where bay_id='f0000000-0000-4000-8000-000000000001')
 and (select observed_at=current_setting('supervised.test.provider')::timestamptz and barrier='lowered' and occupancy='vacant'
   from public.hardware_controls where bay_id='f0000000-0000-4000-8000-000000000001'),
 'Only one operator-protected operation exists; provider timestamp/barrier/occupancy are unchanged');
select set_config('supervised.test.proof',(select operator_attested_at::text from public.hardware_operations where bay_id='f0000000-0000-4000-8000-000000000001'),true);
set local role service_role;
do $$ declare op jsonb; begin
 op:=public.claim_hardware_operation('faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
 perform pg_temp.assert_true(op->>'kind'='protect' and (op->>'supervisedTestEnabled')::boolean
   and op->>'operatorAttestedAt' is not null,'Private worker receives evidence on this protect operation only');
 perform set_config('supervised.test.op',op->>'id',true);
 perform set_config('supervised.test.token',op->>'claimToken',true);
 perform pg_temp.expect_error(format('select public.mark_hardware_dispatch(%L,%L,%L::timestamptz,%L,%L,false,%L)',
   op->>'id',op->>'claimToken',current_setting('supervised.test.provider'),'lowered','vacant','disabled'),'HARDWARE_PREFLIGHT_REJECTED');
end; $$;
create function pg_temp.supervised_dispatch(p_presence text default 'unknown',p_sample timestamptz default null) returns jsonb language sql as $$
 select public.mark_supervised_hardware_dispatch(current_setting('supervised.test.op')::uuid,current_setting('supervised.test.token')::uuid,
   coalesce(p_sample,current_setting('supervised.test.provider')::timestamptz),'unknown',p_presence,false,'disabled')
$$;
reset role;
update public.hardware_operations set operator_attested_at=clock_timestamp()-interval '16 seconds' where id=current_setting('supervised.test.op')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
select pg_temp.supervised_request('fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');
reset role;
select pg_temp.assert_true((select operator_attested_at<clock_timestamp()-interval '15 seconds'
 from public.hardware_operations where id=current_setting('supervised.test.op')::uuid),
 'Retrying an accepted request cannot renew expired operator proof');
set local role service_role;
select pg_temp.expect_error('select pg_temp.supervised_dispatch()','HARDWARE_PREFLIGHT_REJECTED');
reset role;
update public.hardware_operations set operator_attested_at=current_setting('supervised.test.proof')::timestamptz,
 operator_attested_by='f2222222-2222-4222-8222-222222222222' where id=current_setting('supervised.test.op')::uuid;
set local role service_role;
select pg_temp.expect_error('select pg_temp.supervised_dispatch()','HARDWARE_PREFLIGHT_REJECTED');
reset role;
update public.hardware_operations set operator_attested_by='f1111111-1111-4111-8111-111111111111' where id=current_setting('supervised.test.op')::uuid;
set local role service_role;
select pg_temp.expect_error('select pg_temp.supervised_dispatch(''occupied'',clock_timestamp())','HARDWARE_PREFLIGHT_REJECTED');
select pg_temp.expect_error('select pg_temp.supervised_dispatch(''occupied'')','HARDWARE_PREFLIGHT_REJECTED');
do $$ declare op jsonb; begin
 op:=pg_temp.supervised_dispatch();
 perform pg_temp.assert_true(op->>'status'='dispatching' and op->>'dispatchedAt' is not null,
  'New honest operator observation permits one supervised raise despite retained old sensor facts');
end; $$;
select pg_temp.expect_error('select pg_temp.supervised_dispatch()','HARDWARE_CLAIM_INVALID');
reset role;
select pg_temp.assert_true((select observed_at=current_setting('supervised.test.provider')::timestamptz and barrier='lowered'
 and occupancy='vacant' from public.hardware_controls where bay_id='f0000000-0000-4000-8000-000000000001')
 and (select operator_attested_at=current_setting('supervised.test.proof')::timestamptz
   from public.hardware_operations where id=current_setting('supervised.test.op')::uuid),
 'Dispatch does not fake provider freshness or renew proof on replay');
select pg_temp.assert_true((public._hardware_operation_json(current_setting('supervised.test.op')::uuid,false)->>'operatorAttestedAt') is null,
 'Operator evidence is omitted from the non-private operation projection');
rollback;
select 'Supervised test evidence, normal guards, proof expiry and one-permit SQL contract passed.' as result;
