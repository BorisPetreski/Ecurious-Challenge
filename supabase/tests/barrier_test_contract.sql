-- Fictional barrier only. No provider HTTP, actual lock, plate or charger.
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
create function pg_temp.expect_constraint(q text) returns void language plpgsql as $$
begin begin execute q; exception when check_violation then return; end;
  raise exception 'Expected connector power constraint rejection'; end;
$$;
insert into auth.users(id) values('e1111111-1111-4111-8111-111111111111');
insert into public.charging_locations(id,label) values('e0000000-0000-4000-8000-000000000100','Fictional barrier-only test location');
insert into public.bookable_bays(id,location_id,label,integration_mode,ecurious_lock_id,enabled) values
 ('e0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000100','Fictional barrier-only bay','ecurious','fictional-barrier-only-lock',true);
insert into public.bay_connectors(id,bay_id,label,connector_type,power_kw,enabled) values
 ('e0000000-0000-4000-8000-000000000011','e0000000-0000-4000-8000-000000000001','Barrier only — no charger','BARRIER_TEST',0,true),
 ('e0000000-0000-4000-8000-000000000012','e0000000-0000-4000-8000-000000000001','Historical unknown plug','UNKNOWN',0,false);
select pg_temp.expect_constraint($q$update public.bay_connectors set connector_type='CCS',power_kw=0 where id='e0000000-0000-4000-8000-000000000011'$q$);
select pg_temp.expect_constraint($q$update public.bay_connectors set connector_type='CCS',power_kw=0,enabled=false where id='e0000000-0000-4000-8000-000000000011'$q$);
select pg_temp.expect_constraint($q$update public.bay_connectors set power_kw=-1 where id='e0000000-0000-4000-8000-000000000011'$q$);
select pg_temp.expect_constraint($q$update public.bay_connectors set power_kw=22 where id='e0000000-0000-4000-8000-000000000011'$q$);
select pg_temp.expect_constraint($q$update public.bay_connectors set enabled=true where id='e0000000-0000-4000-8000-000000000012'$q$);
insert into public.hardware_controls(bay_id) values('e0000000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','e1111111-1111-4111-8111-111111111111',true);
do $$ declare w jsonb; t timestamptz:=clock_timestamp(); begin
 w:=public.get_hardware_workflow('e0000000-0000-4000-8000-000000000001');
 perform pg_temp.assert_true(w#>>'{bay,connectors,0,type}'='BARRIER_TEST' and (w#>>'{bay,connectors,0,powerKw}')::numeric=0,
  'Hardware projection explicitly labels a zero-power non-charging test interface');
 perform pg_temp.expect_error(pg_catalog.format('select public.request_hardware_slot(%L,%L,%L::timestamptz,%L::timestamptz,%L,%L,%L,%L)',
  'e0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000011',t,t+interval '10 minutes',
  'eeeeeeee-bbbb-4bbb-8bbb-bbbbbbbbbbb1',repeat('e',64),'•••11','now'),'HARDWARE_DISABLED');
 perform pg_temp.assert_true(not exists(select 1 from jsonb_array_elements(public.list_bay_availability()->'bays') x
  where x.value->>'id'='e0000000-0000-4000-8000-000000000001'), 'Barrier-only Ecurious inventory never enters the demo charger list');
end; $$;
set local role service_role;
select pg_temp.assert_true(public.claim_hardware_operation('eeeeeeee-aaaa-4aaa-8aaa-aaaaaaaaaaa1') is null,
 'Disabled enrollment cannot produce a claim or dispatch permit');
reset role;
select pg_temp.assert_true(not exists(select 1 from public.hardware_operations where bay_id='e0000000-0000-4000-8000-000000000001'),
 'A test-interface row alone creates no movement operation');
-- Enabling only one gate remains insufficient. These flags refer exclusively
-- to the fictional fixture and do not assert real hardware interlocks.
update public.hardware_controls set enabled=true where bay_id='e0000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ declare t timestamptz:=clock_timestamp(); begin
 perform pg_temp.expect_error(pg_catalog.format('select public.request_hardware_slot(%L,%L,%L::timestamptz,%L::timestamptz,%L,%L,%L,%L)',
  'e0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000011',t,t+interval '10 minutes',
  'eeeeeeee-bbbb-4bbb-8bbb-bbbbbbbbbbb1',repeat('e',64),'•••11','now'),'HARDWARE_DISABLED');
end; $$;
reset role;
update public.hardware_controls set interlocks_confirmed=true,observed_at=clock_timestamp(),barrier='lowered',
 occupancy='vacant',faulted=false,access_mode='disabled' where bay_id='e0000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ declare w jsonb; t timestamptz:=clock_timestamp(); begin
 w:=public.request_hardware_slot('e0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000011',
  t,t+interval '10 minutes','eeeeeeee-bbbb-4bbb-8bbb-bbbbbbbbbbb2',repeat('e',64),'•••11','now');
 perform pg_catalog.set_config('barrier.test.slot',w#>>'{slot,id}',true);
end; $$;
set local role service_role;
select public.reconcile_hardware_slots();
do $$ declare op jsonb; begin
 op:=public.claim_hardware_operation('eeeeeeee-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
 perform pg_temp.assert_true(op->>'kind'='protect','Explicitly enabled fictional interface uses the existing durable protection workflow');
 -- Synthetic already-target observations use the existing no-op confirmation
 -- path; no external lock/POST or bypassed motion safety is involved.
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',clock_timestamp(),'raised','vacant',null,false,'disabled');
 perform public.authorize_hardware_plate_entry(current_setting('barrier.test.slot')::uuid,repeat('e',64),clock_timestamp(),repeat('1',64));
 op:=public.claim_hardware_operation('eeeeeeee-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
 perform pg_temp.assert_true(op->>'kind'='entry','A trusted matching synthetic fingerprint queues the same guarded entry operation');
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',clock_timestamp(),'lowered','vacant',null,false,'disabled');
end; $$;
select public.record_hardware_bay_observation('e0000000-0000-4000-8000-000000000001',clock_timestamp(),'lowered','occupied',false,'disabled');
select public.record_hardware_bay_observation('e0000000-0000-4000-8000-000000000001',clock_timestamp(),'lowered','vacant',false,'disabled');
do $$ declare op jsonb; begin
 op:=public.claim_hardware_operation('eeeeeeee-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
 perform pg_temp.assert_true(op->>'kind'='release','Sensor departure queues existing guarded cleanup');
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',clock_timestamp(),'lowered','vacant',null,false,'disabled');
 perform public.reconcile_hardware_slots();
end; $$;
reset role;
select pg_temp.assert_true((select s.status='completed' and s.arrived_at is not null and s.departed_at>s.arrived_at
 and c.reservation_id is null and c.phase='idle' and x.connector_type='BARRIER_TEST' and x.power_kw=0
 from public.hardware_slot_bookings s join public.hardware_controls c on c.bay_id=s.bay_id
 join public.bay_connectors x on x.id=s.connector_id where s.id=current_setting('barrier.test.slot')::uuid),
 'Barrier-only session completes through sensor evidence and safe cleanup without inventing charging power');
rollback;
select 'Barrier-test interface power constraints, default-off enrollment and durable session contract passed.' as result;
