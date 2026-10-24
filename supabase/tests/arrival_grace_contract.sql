-- Focused arrival/grace contract. Fictional hardware, hashes and observations.
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
insert into auth.users(id) values('c1111111-1111-4111-8111-111111111111'),('c2222222-2222-4222-8222-222222222222');
insert into public.charging_locations(id,label) values('c0000000-0000-4000-8000-000000000100','Fictional grace location');
insert into public.bookable_bays(id,location_id,label,integration_mode,ecurious_lock_id,enabled) values
 ('c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000100','Fictional scheduled bay','ecurious','fictional-grace-a',true),
 ('c0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000100','Fictional matching bay','ecurious','fictional-grace-b',true);
insert into public.bay_connectors(id,bay_id,label,connector_type,power_kw,enabled)
 select id,id,'Fictional CCS','CCS',150,true from public.bookable_bays where id::text like 'c0000000-0000-4000-8000-00000000000%';
insert into public.hardware_controls(bay_id,enabled,interlocks_confirmed,observed_at,barrier,occupancy,faulted,access_mode)
 select id,true,true,clock_timestamp(),'lowered','vacant',false,'disabled' from public.bookable_bays
 where id::text like 'c0000000-0000-4000-8000-00000000000%';
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','c1111111-1111-4111-8111-111111111111',true);
do $$ declare w jsonb; t timestamptz:=clock_timestamp()+interval '30 minutes'; begin
 w:=public.request_hardware_slot('c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001',
  t,t+interval '10 minutes','cccccccc-bbbb-4bbb-8bbb-bbbbbbbbbbb1',repeat('c',64),'•••11','scheduled');
 perform pg_catalog.set_config('grace.test.scheduled',w#>>'{slot,id}',true);
 perform pg_temp.assert_true((w#>>'{slot,startsAt}')::timestamptz-(w#>>'{slot,protectionStartsAt}')::timestamptz=interval '10 minutes'
  and (w#>>'{slot,protectionDeadlineAt}')::timestamptz-(w#>>'{slot,startsAt}')::timestamptz=interval '10 minutes',
  'Booked arrival T has protection T-10 and unused cutoff T+10');
 perform pg_temp.assert_true((public.get_hardware_workflow('c0000000-0000-4000-8000-000000000001')#>>'{capabilities,canReserve}')::boolean,
  'A future reservation leaves the presently vacant control available');
end; $$;
set local role service_role;
select public.reconcile_hardware_slots();
reset role;
select pg_temp.assert_true(not exists(select 1 from public.hardware_operations where bay_id='c0000000-0000-4000-8000-000000000001'),
 'No protection operation is queued before T-10');
-- Advance only fictional fixture times to the protection boundary.
with t as(select clock_timestamp()-interval '1 second' n)
update public.hardware_slot_bookings s set protection_starts_at=t.n,starts_at=t.n+interval '10 minutes',
 ends_at=t.n+interval '20 minutes',protection_deadline_at=t.n+interval '20 minutes'
 from t where s.id=current_setting('grace.test.scheduled')::uuid;
set local role service_role;
select public.reconcile_hardware_slots();
set local role authenticated;
do $$ declare w jsonb; old_deadline timestamptz; begin
 w:=public.get_hardware_slot(current_setting('grace.test.scheduled')::uuid);
 old_deadline:=(w#>>'{slot,protectionDeadlineAt}')::timestamptz;
 perform pg_temp.assert_true(w#>>'{slot,status}'='active' and (w#>>'{slot,activatedAt}')::timestamptz<(w#>>'{slot,startsAt}')::timestamptz,
  'Protection activates at T-10 while planned arrival remains in the future');
 w:=public.request_hardware_slot_extension(current_setting('grace.test.scheduled')::uuid,'cccccccc-bbbb-4bbb-8bbb-bbbbbbbbbbb2');
 perform pg_temp.assert_true((w#>>'{slot,protectionDeadlineAt}')::timestamptz=old_deadline+interval '10 minutes'
  and (w#>>'{slot,reservationFeeCents}')::integer=200,'Scheduled extension adds ten unused-hold minutes and one mock euro');
 perform pg_temp.assert_true(public.request_hardware_slot_extension(current_setting('grace.test.scheduled')::uuid,
  'cccccccc-bbbb-4bbb-8bbb-bbbbbbbbbbb2')#>>'{slot,protectionDeadlineAt}'=w#>>'{slot,protectionDeadlineAt}',
  'Scheduled extension retry does not extend twice');
end; $$;
set local role service_role;
do $$ declare op jsonb; begin
 op:=public.claim_hardware_operation('cccccccc-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',clock_timestamp(),'raised','vacant',null,false,'disabled');
end; $$;
reset role;
with t as(select clock_timestamp() n)
update public.hardware_slot_bookings s set starts_at=t.n-interval '21 minutes',protection_starts_at=t.n-interval '31 minutes',
 ends_at=t.n-interval '1 minute',protection_deadline_at=t.n-interval '1 minute'
 from t where s.id=current_setting('grace.test.scheduled')::uuid;
with t as(select clock_timestamp() n)
update public.booking_reservations r set starts_at=t.n-interval '31 minutes',expires_at=t.n-interval '1 minute'
 from t,public.hardware_slot_bookings s where s.id=current_setting('grace.test.scheduled')::uuid and r.id=s.hardware_reservation_id;
set local role service_role;
select pg_temp.expect_error(pg_catalog.format('select public.authorize_hardware_plate_entry(%L,%L,clock_timestamp(),%L)',
 current_setting('grace.test.scheduled'),repeat('c',64),repeat('1',64)),'HARDWARE_ENTRY_NOT_READY');
select public.reconcile_hardware_slots();
reset role;
select pg_temp.assert_true((select c.release_requested and c.release_reason='no_show' and r.status='held'
 from public.hardware_controls c join public.booking_reservations r on r.id=c.reservation_id
 join public.hardware_slot_bookings s on s.hardware_reservation_id=r.id where s.id=current_setting('grace.test.scheduled')::uuid),
 'Unused expiry queues cleanup and rejects a late scan, retaining the physical allocation');
set local role service_role;
do $$ declare op jsonb; begin
 op:=public.claim_hardware_operation('cccccccc-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'blocked',clock_timestamp(),'raised','occupied','BAY_OCCUPIED',false,'disabled');
 op:=public.claim_hardware_operation('cccccccc-aaaa-4aaa-8aaa-aaaaaaaaaaa1',(op->>'id')::uuid);
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',clock_timestamp(),'lowered','vacant',null,false,'disabled');
end; $$;

set local role authenticated;
do $$ declare w jsonb; t timestamptz:=clock_timestamp(); begin
 w:=public.request_hardware_slot('c0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000002',
  t,t+interval '10 minutes','cccccccc-bbbb-4bbb-8bbb-bbbbbbbbbbb3',repeat('c',64),'•••11','now');
 perform pg_catalog.set_config('grace.test.matched',w#>>'{slot,id}',true);
end; $$;
set local role service_role;
select public.reconcile_hardware_slots();
do $$ declare op jsonb; begin
 op:=public.claim_hardware_operation('cccccccc-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',clock_timestamp(),'raised','vacant',null,false,'disabled');
 perform public.authorize_hardware_plate_entry(current_setting('grace.test.matched')::uuid,repeat('c',64),clock_timestamp(),repeat('2',64));
end; $$;
reset role;
-- Simulate an accepted recognition eleven minutes ago, before an unused
-- deadline two minutes ago. Physical parked arrival has not been observed.
with t as(select clock_timestamp() n)
update public.hardware_slot_bookings s set starts_at=t.n-interval '12 minutes',protection_starts_at=t.n-interval '12 minutes',
 ends_at=t.n-interval '2 minutes',protection_deadline_at=t.n-interval '2 minutes',
 entry_authorized_at=t.n-interval '11 minutes',last_plate_event_at=t.n-interval '11 minutes'
 from t where s.id=current_setting('grace.test.matched')::uuid;
with t as(select clock_timestamp() n)
update public.booking_reservations r set starts_at=t.n-interval '12 minutes',expires_at=t.n-interval '2 minutes'
 from t,public.hardware_slot_bookings s where s.id=current_setting('grace.test.matched')::uuid and r.id=s.hardware_reservation_id;
set local role service_role;
select public.reconcile_hardware_slots();
select public.reconcile_hardware_deadlines();
reset role;
select pg_temp.assert_true((select r.status='held' and not c.release_requested and s.arrived_at is null
 from public.hardware_slot_bookings s join public.booking_reservations r on r.id=s.hardware_reservation_id
 join public.hardware_controls c on c.reservation_id=r.id where s.id=current_setting('grace.test.matched')::uuid),
 'Matched scan prevents both deadline paths from expiring a driver who is entering; no parked arrival is invented');
set local role authenticated;
select pg_temp.expect_error(pg_catalog.format('select public.request_hardware_slot_extension(%L,%L)',
 current_setting('grace.test.matched'),'cccccccc-bbbb-4bbb-8bbb-bbbbbbbbbbb4'),'SLOT_NOT_EXTENDABLE');
set local role service_role;
do $$ declare op jsonb; begin
 op:=public.claim_hardware_operation('cccccccc-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',clock_timestamp(),'lowered','vacant',null,false,'disabled');
end; $$;
select public.record_hardware_bay_observation('c0000000-0000-4000-8000-000000000002',clock_timestamp(),'lowered','occupied',false,'disabled');
select public.record_hardware_bay_observation('c0000000-0000-4000-8000-000000000002',clock_timestamp(),'lowered','vacant',false,'disabled');
do $$ declare op jsonb; begin
 op:=public.claim_hardware_operation('cccccccc-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',clock_timestamp(),'lowered','vacant',null,false,'disabled');
 perform public.reconcile_hardware_slots();
end; $$;
reset role;
select pg_temp.assert_true((select status='completed' and arrived_at is not null and departed_at>arrived_at
 from public.hardware_slot_bookings where id=current_setting('grace.test.matched')::uuid),
 'Matched session completes only after sensor occupied then newer vacant and confirmed cleanup');

set local role authenticated;
do $$ declare w jsonb; begin
 w:=public.reserve_directory_booking(915,repeat('c',64),'scheduled',clock_timestamp()+interval '1 hour',
  'cccccccc-bbbb-4bbb-8bbb-bbbbbbbbbbb5');
 perform pg_temp.assert_true(w->>'protectionDeadlineAt'=w->>'expiresAt','Directory projection aliases its existing authoritative deadline');
 perform pg_temp.assert_true(jsonb_array_length(public.list_directory_holds(array[915]::bigint[])->'holds')=0,
  'Future directory booking does not reserve the map choice before its lead-in');
end; $$;
select pg_catalog.set_config('request.jwt.claim.sub','c2222222-2222-4222-8222-222222222222',true);
select public.reserve_directory_booking(915,repeat('c',64),'now',null,'cccccccc-bbbb-4bbb-8bbb-bbbbbbbbbbb6');
rollback;
select 'Arrival T-10/T+10, scheduled extension, matched-entry retention and sensor departure passed.' as result;
