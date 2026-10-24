-- Fictional registered bays; all observations and plate hashes are synthetic.
begin;
create function pg_temp.assert_true(p boolean,m text) returns void language plpgsql as $$
begin if p is distinct from true then raise exception 'Assertion failed: %',m; end if; end;
$$;
create function pg_temp.expect_error(q text,m text) returns void language plpgsql as $$
declare actual text;
begin
  begin execute q; exception when others then get stacked diagnostics actual=message_text;
    if actual=m then return; end if; raise exception 'Expected %, got %',m,actual; end;
  raise exception 'Expected %, statement succeeded',m;
end;
$$;
insert into auth.users(id) values('a1111111-1111-4111-8111-111111111111'),('a2222222-2222-4222-8222-222222222222');
insert into public.charging_locations(id,label) values('a0000000-0000-4000-8000-000000000100','Fictional scheduled location');
insert into public.bookable_bays(id,location_id,label,integration_mode,ecurious_lock_id,enabled) values
 ('a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000100','Fictional calendar bay','ecurious','fictional-slot-a',true),
 ('a0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000100','Fictional arrival bay','ecurious','fictional-slot-b',true),
 ('a0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000100','Fictional idle bay','ecurious','fictional-slot-c',true);
insert into public.bay_connectors(id,bay_id,label,connector_type,power_kw,enabled) values
 ('a0000000-0000-4000-8000-000000000011','a0000000-0000-4000-8000-000000000001','Calendar CCS','CCS',150,true),
 ('a0000000-0000-4000-8000-000000000012','a0000000-0000-4000-8000-000000000001','Calendar Type2','Typ2',22,true),
 ('a0000000-0000-4000-8000-000000000021','a0000000-0000-4000-8000-000000000002','Arrival CCS','CCS',150,true),
 ('a0000000-0000-4000-8000-000000000031','a0000000-0000-4000-8000-000000000003','Idle CCS','CCS',150,true);
insert into public.hardware_controls(bay_id,enabled,interlocks_confirmed)
 select id,true,true from public.bookable_bays where id in
 ('a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000003');
select pg_temp.assert_true(not pg_catalog.has_table_privilege('authenticated','public.hardware_slot_bookings','SELECT')
 and not pg_catalog.has_function_privilege('authenticated','public.authorize_hardware_plate_entry(uuid,text,timestamptz,text)','EXECUTE')
 and not pg_catalog.has_function_privilege('anon','public.list_my_hardware_slots()','EXECUTE')
 and not pg_catalog.has_function_privilege('authenticated','public._request_manual_hardware_entry(uuid)','EXECUTE'),
 'Guest cannot read HMACs, impersonate a camera worker, or bypass scheduled entry checks');
select pg_catalog.set_config('slots.test.now',pg_catalog.clock_timestamp()::text,true);
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
do $$ declare w jsonb; again jsonb; t timestamptz:=pg_catalog.current_setting('slots.test.now')::timestamptz; begin
 w:=public.request_hardware_slot('a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000011',
  t+interval '5 minutes',t+interval '30 minutes','abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',repeat('a',64),'•••11');
 perform pg_catalog.set_config('slots.test.future',w#>>'{slot,id}',true);
 again:=public.request_hardware_slot('a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000011',
  t+interval '5 minutes',t+interval '30 minutes','abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',repeat('a',64),'•••11');
 perform pg_temp.assert_true(w#>>'{slot,id}'=again#>>'{slot,id}' and w#>>'{slot,status}'='scheduled','Same request returns the original unchanged future window');
 perform pg_temp.expect_error(pg_catalog.format($q$select public.request_hardware_slot(%L,%L,%L::timestamptz,%L::timestamptz,%L,%L,%L)$q$,
  'a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000012',t+interval '5 minutes',t+interval '30 minutes',
  'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',repeat('a',64),'•••11'),'IDEMPOTENCY_CONFLICT');
 perform pg_temp.expect_error($q$select public.request_hardware_reservation('a0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000011',10,'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2')$q$,'SLOT_RESERVED');
 perform pg_temp.expect_error(pg_catalog.format($q$select public.request_hardware_slot(%L,%L,%L::timestamptz,%L::timestamptz,%L,%L,%L)$q$,
  'a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000012',t+interval '20 minutes',t+interval '40 minutes',
  'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',repeat('a',64),'•••11'),'SLOT_RESERVED');
 perform public.request_hardware_slot('a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000012',
  t+interval '30 minutes',t+interval '40 minutes','abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',repeat('a',64),'•••11');
end; $$;
set local role service_role;
select public.reconcile_hardware_slots();
reset role;
select pg_temp.assert_true(not exists(select 1 from public.hardware_operations where bay_id='a0000000-0000-4000-8000-000000000001')
 and not exists(select 1 from public.booking_reservations where bay_id='a0000000-0000-4000-8000-000000000001'),
 'Future booking and conflicting immediate rollback create no early barrier operation or allocation');
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','a2222222-2222-4222-8222-222222222222',true);
do $$ declare w jsonb; begin
 w:=public.list_hardware_slots('a0000000-0000-4000-8000-000000000001');
 perform pg_temp.assert_true(pg_catalog.jsonb_array_length(w->'slots')=2 and w#>'{slots,0,id}'='null'::jsonb
  and w#>'{slots,0,maskedPlate}'='null'::jsonb and w#>'{slots,0,activatedAt}'='null'::jsonb
  and w#>'{slots,0,protectionConfirmedAt}'='null'::jsonb,'Calendar shares windows without owner identity, plate or session facts');
 perform pg_temp.expect_error(pg_catalog.format('select public.cancel_hardware_slot(%L)',pg_catalog.current_setting('slots.test.future')),'SLOT_NOT_FOUND');
end; $$;
select pg_catalog.set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
do $$ declare w jsonb; begin
 w:=public.cancel_hardware_slot(pg_catalog.current_setting('slots.test.future')::uuid);
 perform pg_temp.assert_true(w#>>'{slot,status}'='cancelled','Cancelling an unactivated future window needs no physical operation');
end; $$;
do $$ declare w jsonb; begin
 w:=public.request_hardware_slot('a0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000021',
  pg_catalog.clock_timestamp()-interval '1 second',pg_catalog.clock_timestamp()+interval '20 minutes',
  'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5',repeat('b',64),'•••22');
 perform pg_catalog.set_config('slots.test.active',w#>>'{slot,id}',true);
end; $$;
set local role service_role;
select public.record_hardware_bay_observation('a0000000-0000-4000-8000-000000000002',clock_timestamp(),'lowered','vacant',false,'disabled');
select public.reconcile_hardware_slots();
do $$ declare op jsonb; begin
 op:=public.claim_hardware_operation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
 perform pg_temp.assert_true(op->>'kind'='protect','Due window queues protection only after trusted idle observation');
 perform pg_catalog.set_config('slots.test.res',op->>'reservationId',true);
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',clock_timestamp(),'raised','vacant',null,false,'disabled');
end; $$;
set local role authenticated;
select pg_temp.expect_error(pg_catalog.format('select public.request_hardware_entry(%L)',pg_catalog.current_setting('slots.test.res')),'PLATE_AUTH_REQUIRED');
set local role service_role;
do $$ declare w jsonb; s uuid:=pg_catalog.current_setting('slots.test.active')::uuid; begin
 perform pg_temp.expect_error(pg_catalog.format('select public.authorize_hardware_plate_entry(%L,%L,clock_timestamp(),%L)',s,repeat('c',64),repeat('1',64)),'PLATE_NOT_AUTHORIZED');
 perform pg_temp.expect_error(pg_catalog.format('select public.authorize_hardware_plate_entry(%L,%L,clock_timestamp()-interval %L,%L)',s,repeat('b',64),'1 minute',repeat('1',64)),'HARDWARE_ENTRY_NOT_READY');
 w:=public.authorize_hardware_plate_entry(s,repeat('b',64),clock_timestamp(),repeat('2',64));
 perform pg_temp.assert_true(w->>'phase'='entry_pending','Only matching trusted post-protection recognition queues entry');
 perform public.authorize_hardware_plate_entry(s,repeat('b',64),clock_timestamp(),repeat('2',64));
end; $$;
do $$ declare op jsonb; begin
 op:=public.claim_hardware_operation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
 perform pg_temp.assert_true(op->>'kind'='entry','One entry operation exists after duplicate camera event');
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',clock_timestamp(),'lowered','vacant',null,false,'disabled');
end; $$;
select public.record_hardware_bay_observation('a0000000-0000-4000-8000-000000000002',clock_timestamp(),'lowered','occupied',false,'disabled');
reset role;
select pg_temp.assert_true((select arrived_at is not null and departed_at is null from public.hardware_slot_bookings
 where id=pg_catalog.current_setting('slots.test.active')::uuid),'Arrival requires authorized entry followed by actual occupied sensor observation');
set local role service_role;
select public.record_hardware_bay_observation('a0000000-0000-4000-8000-000000000002',clock_timestamp(),'lowered','vacant',false,'disabled');
reset role;
select pg_temp.assert_true((select s.departed_at>s.arrived_at and r.status='held' from public.hardware_slot_bookings s
 join public.booking_reservations r on r.id=s.hardware_reservation_id where s.id=pg_catalog.current_setting('slots.test.active')::uuid),
 'Sensor departure records facts while retaining allocation until cleanup confirmation');
set local role service_role;
do $$ declare op jsonb; begin
 op:=public.claim_hardware_operation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
 perform pg_temp.assert_true(op->>'kind'='release','Departure queues checked cleanup');
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',clock_timestamp(),'lowered','vacant',null,false,'disabled');
 perform public.reconcile_hardware_slots();
end; $$;
reset role;
select pg_temp.assert_true((select status='completed' and billing_stopped_at=entry_authorized_at from public.hardware_slot_bookings
 where id=pg_catalog.current_setting('slots.test.active')::uuid),'Completed session stops mocked protection billing at matched plate recognition');

-- Fifteen-minute no-show grace begins at confirmed protection, not creation.
set local role authenticated;
do $$ declare w jsonb; begin
 w:=public.request_hardware_slot('a0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000021',
  clock_timestamp(),clock_timestamp()+interval '30 minutes','abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6',repeat('b',64),'•••22');
 perform pg_catalog.set_config('slots.test.noshow',w#>>'{slot,id}',true);
end; $$;
set local role service_role;
select public.reconcile_hardware_slots();
do $$ declare op jsonb; begin
 op:=public.claim_hardware_operation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',clock_timestamp(),'raised','vacant',null,false,'disabled');
end; $$;
reset role;
update public.hardware_operations set confirmed_at=clock_timestamp()-interval '15 minutes 5 seconds'
 where kind='protect' and reservation_id=(select hardware_reservation_id from public.hardware_slot_bookings
   where id=pg_catalog.current_setting('slots.test.noshow')::uuid);
set local role service_role;
do $$ declare s uuid:=pg_catalog.current_setting('slots.test.noshow')::uuid; begin
 perform pg_temp.expect_error(pg_catalog.format('select public.authorize_hardware_plate_entry(%L,%L,clock_timestamp(),%L)',
  s,repeat('b',64),repeat('3',64)),'HARDWARE_ENTRY_NOT_READY');
 perform pg_temp.expect_error(pg_catalog.format('select public.authorize_hardware_plate_entry(%L,%L,clock_timestamp()-interval %L,%L)',
  s,repeat('b',64),'10 seconds',repeat('4',64)),'HARDWARE_ENTRY_NOT_READY');
end; $$;
select public.reconcile_hardware_slots();
reset role;
select pg_temp.assert_true((select c.release_requested and c.release_reason='no_show' and r.status='held'
 and s.billing_stopped_at<clock_timestamp() and s.status='active'
 from public.hardware_slot_bookings s join public.booking_reservations r on r.id=s.hardware_reservation_id
 join public.hardware_controls c on c.reservation_id=r.id where s.id=pg_catalog.current_setting('slots.test.noshow')::uuid),
 'No-show stops mock billing after 15 protected minutes but keeps bay allocated pending cleanup');
set local role service_role;
do $$ declare op jsonb; begin
 op:=public.claim_hardware_operation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'blocked',clock_timestamp(),'raised','occupied','BAY_OCCUPIED',false,'disabled');
 op:=public.claim_hardware_operation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',(op->>'id')::uuid);
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',clock_timestamp(),'lowered','vacant',null,false,'disabled');
 perform public.reconcile_hardware_slots();
end; $$;
reset role;
select pg_temp.assert_true((select status='expired' from public.hardware_slot_bookings
 where id=pg_catalog.current_setting('slots.test.noshow')::uuid),'No-show becomes expired only after physical cleanup');

set local role authenticated;
do $$ declare w jsonb; begin
 w:=public.request_hardware_slot('a0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000021',
  clock_timestamp(),clock_timestamp()+interval '10 minutes','abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7',repeat('b',64),'•••22');
 perform pg_catalog.set_config('slots.test.cancel',w#>>'{slot,id}',true);
end; $$;
set local role service_role;
select public.reconcile_hardware_slots();
set local role authenticated;
do $$ declare w jsonb; begin
 w:=public.cancel_hardware_slot(pg_catalog.current_setting('slots.test.cancel')::uuid);
 perform pg_temp.assert_true(w#>>'{slot,status}'='cancel_requested' and (w#>>'{slot,billingWaived}')::boolean,
  'Cancelling an activated window keeps schedule exclusion and waives mock fees while awaiting safe cleanup');
end; $$;
reset role;
select pg_temp.assert_true((select r.status='held' from public.hardware_slot_bookings s
 join public.booking_reservations r on r.id=s.hardware_reservation_id where s.id=pg_catalog.current_setting('slots.test.cancel')::uuid),
 'Activated cancellation cannot prematurely free the physical row');
set local role service_role;
do $$ declare op jsonb; begin
 op:=public.claim_hardware_operation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',clock_timestamp(),'lowered','vacant',null,false,'disabled');
 perform public.reconcile_hardware_slots();
end; $$;
reset role;
select pg_temp.assert_true((select status='cancelled' from public.hardware_slot_bookings
 where id=pg_catalog.current_setting('slots.test.cancel')::uuid),'Cancelled slot ends after confirmed physical cleanup');

-- Idle bay occupancy blocks allocation; raised idle barrier lowers through the
-- same durable permit ledger, with no synthetic customer reservation.
set local role service_role;
select public.record_hardware_bay_observation('a0000000-0000-4000-8000-000000000003',clock_timestamp(),'lowered','occupied',false,'disabled');
reset role;
select pg_temp.assert_true((select phase='blocked' from public.hardware_controls where bay_id='a0000000-0000-4000-8000-000000000003'),'Unexpected idle occupancy blocks bay');
set local role service_role;
select public.record_hardware_bay_observation('a0000000-0000-4000-8000-000000000003',clock_timestamp(),'raised','vacant',false,'disabled');
do $$ declare op jsonb; result jsonb; begin
 op:=public.claim_hardware_operation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
 perform pg_temp.assert_true(op->>'kind'='release' and op->'reservationId'='null'::jsonb,'Idle lowering uses a null-owner release ledger entry');
 op:=public.mark_hardware_dispatch((op->>'id')::uuid,(op->>'claimToken')::uuid,clock_timestamp(),'raised','vacant',false,'disabled');
 result:=public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',clock_timestamp(),'lowered','vacant',null,false,'disabled');
 perform pg_temp.assert_true(result->>'status'='uncertain','Idle release without acknowledgement remains quarantined');
 perform public.record_hardware_bay_observation('a0000000-0000-4000-8000-000000000003',clock_timestamp(),'lowered','vacant',false,'disabled');
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'acknowledged');
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',clock_timestamp(),'lowered','vacant',null,false,'disabled');
end; $$;
reset role;
select pg_temp.assert_true((select phase='idle' and reservation_id is null from public.hardware_controls
 where bay_id='a0000000-0000-4000-8000-000000000003'),'Only acknowledged and physically confirmed idle lowering restores idle');
rollback;
select 'Scheduled hardware slots, plate authorization, idle and session contracts passed.' as result;
