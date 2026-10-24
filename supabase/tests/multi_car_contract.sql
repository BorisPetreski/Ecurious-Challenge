-- Separate authenticated drivers and fictional keyed plate fingerprints.
-- Provider observations/worker confirmations below are injected test facts;
-- this contract never claims to move hardware or run the recognition model.
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

insert into auth.users(id) values
 ('d1111111-1111-4111-8111-111111111111'),('d2222222-2222-4222-8222-222222222222');
insert into public.charging_locations(id,label,latitude,longitude) values
 ('d0000000-0000-4000-8000-000000000100','Fictional multi-car location',52.52,13.405),
 ('d0000000-0000-4000-8000-000000000200','Fictional nearest alternative',52.53,13.41),
 ('d0000000-0000-4000-8000-000000000300','Fictional farther alternative',52.56,13.44);
insert into public.bookable_bays(id,location_id,label,integration_mode,ecurious_lock_id,enabled) values
 ('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000100','Fictional two-connector bay','ecurious','fictional-multi-car-a',true),
 ('d0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000100','Fictional separate fallback bay','ecurious','fictional-multi-car-b',true),
 ('d0000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000200','Fictional nearest compatible bay','ecurious','fictional-multi-car-c',true),
 ('d0000000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-000000000300','Fictional farther compatible bay','ecurious','fictional-multi-car-d',true);
insert into public.bay_connectors(id,bay_id,label,connector_type,power_kw,enabled)
 select b.id,b.id,'Fictional CCS','CCS',150,true from public.bookable_bays b
 where b.id::text like 'd0000000-0000-4000-8000-00000000000%';
insert into public.bay_connectors(id,bay_id,label,connector_type,power_kw,enabled) values
 ('d0000000-0000-4000-8000-000000000012','d0000000-0000-4000-8000-000000000001','Fictional second CCS','CCS',150,true);
insert into public.hardware_controls(bay_id,enabled,interlocks_confirmed,observed_at,barrier,occupancy,faulted,access_mode)
 select b.id,true,true,clock_timestamp(),'lowered','vacant',false,'disabled' from public.bookable_bays b
 where b.id::text like 'd0000000-0000-4000-8000-00000000000%';

select pg_temp.assert_true(not pg_catalog.has_table_privilege('authenticated','public.hardware_slot_bookings','SELECT')
 and not pg_catalog.has_function_privilege('authenticated','public.authorize_hardware_plate_entry(uuid,text,timestamptz,text)','EXECUTE'),
 'Driver sessions cannot read private fingerprints or submit trusted plate authorizations');
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','d1111111-1111-4111-8111-111111111111',true);
do $$ declare w jsonb; t timestamptz:=clock_timestamp(); begin
 w:=public.request_hardware_slot('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001',
  t,t+interval '10 minutes','dddddddd-bbbb-4bbb-8bbb-bbbbbbbbbbb1',repeat('a',64),'•••11','now');
 perform pg_catalog.set_config('multi.test.a',w#>>'{slot,id}',true);
end; $$;
select pg_catalog.set_config('request.jwt.claim.sub','d2222222-2222-4222-8222-222222222222',true);
do $$ declare w jsonb; s text:=current_setting('multi.test.a'); begin
 perform pg_temp.expect_error(format('select public.get_hardware_slot(%L)',s),'SLOT_NOT_FOUND');
 perform pg_temp.expect_error(format('select public.cancel_hardware_slot(%L)',s),'SLOT_NOT_FOUND');
 perform pg_temp.expect_error(format('select public.request_hardware_slot_extension(%L,%L)',s,
  'dddddddd-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),'SLOT_NOT_FOUND');
 w:=public.list_hardware_slots('d0000000-0000-4000-8000-000000000001');
 perform pg_temp.assert_true(jsonb_array_length(w->'slots')=1 and w#>'{slots,0,id}'='null'::jsonb
  and w#>'{slots,0,maskedPlate}'='null'::jsonb and w#>'{slots,0,paymentStatus}'='null'::jsonb,
  'Another driver sees shared timing without owner booking ID, vehicle or payment');
 perform pg_temp.assert_true(jsonb_array_length(public.list_my_hardware_slots()->'slots')=0,
  'Owner B does not inherit owner A bookings');
end; $$;

set local role service_role;
select public.reconcile_hardware_slots();
do $$ declare op jsonb; begin
 op:=public.claim_hardware_operation('dddddddd-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
 perform pg_temp.assert_true(op->>'kind'='protect','A fresh vacant bay queues protection for owner A');
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,
  'confirmed',clock_timestamp(),'raised','vacant',null,false,'disabled');
end; $$;
do $$ declare s uuid:=current_setting('multi.test.a')::uuid; w jsonb; begin
 perform pg_temp.expect_error(format('select public.authorize_hardware_plate_entry(%L,%L,clock_timestamp(),%L)',
  s,repeat('b',64),repeat('2',64)),'PLATE_NOT_AUTHORIZED');
 w:=public.authorize_hardware_plate_entry(s,repeat('a',64),clock_timestamp(),repeat('1',64));
 perform pg_temp.assert_true(w->>'phase'='entry_pending','Only owner A matching car requests barrier entry');
 perform public.authorize_hardware_plate_entry(s,repeat('a',64),clock_timestamp(),repeat('1',64));
end; $$;
reset role;
select pg_temp.assert_true((select count(*)=1 from public.hardware_operations where kind='entry'
 and bay_id='d0000000-0000-4000-8000-000000000001'),
 'Duplicate trusted recognition queues exactly one entry intent');
select pg_temp.assert_true((select entry_authorized_at is not null and arrived_at is null
 from public.hardware_slot_bookings where id=current_setting('multi.test.a')::uuid),
 'Plate recognition alone never fabricates occupied parking');
set local role service_role;
do $$ declare op jsonb; begin
 op:=public.claim_hardware_operation('dddddddd-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
 perform pg_temp.assert_true(op->>'kind'='entry','Entry follows the one accepted car');
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,
  'confirmed',clock_timestamp(),'lowered','vacant',null,false,'disabled');
end; $$;
select public.record_hardware_bay_observation('d0000000-0000-4000-8000-000000000001',
 clock_timestamp(),'lowered','occupied',false,'disabled');
reset role;
select pg_temp.assert_true((select arrived_at is not null and departed_at is null from public.hardware_slot_bookings
 where id=current_setting('multi.test.a')::uuid),'A newer occupied sensor fact records owner A physical arrival');
set local role authenticated;
select pg_temp.assert_true(not (public.get_hardware_workflow('d0000000-0000-4000-8000-000000000001')#>>'{capabilities,canReserve}')::boolean,
 'Owner B cannot reserve the currently occupied physical bay');
do $$ declare t timestamptz:=clock_timestamp(); begin
 perform pg_temp.expect_error(format('select public.request_hardware_slot(%L,%L,%L::timestamptz,%L::timestamptz,%L,%L,%L,%L)',
  'd0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000012',t,t+interval '10 minutes',
  'dddddddd-bbbb-4bbb-8bbb-bbbbbbbbbbb3',repeat('b',64),'•••22','now'),'SLOT_RESERVED');
end; $$;

set local role service_role;
select public.record_hardware_bay_observation('d0000000-0000-4000-8000-000000000001',
 clock_timestamp(),'lowered','vacant',false,'disabled');
reset role;
select pg_temp.assert_true((select s.departed_at>s.arrived_at and r.status='held' and c.release_requested
 from public.hardware_slot_bookings s join public.booking_reservations r on r.id=s.hardware_reservation_id
 join public.hardware_controls c on c.reservation_id=r.id where s.id=current_setting('multi.test.a')::uuid),
 'Departure requests cleanup but keeps owner A whole-bay allocation');
set local role authenticated;
do $$ declare t timestamptz:=clock_timestamp(); begin
 perform pg_temp.expect_error(format('select public.request_hardware_slot(%L,%L,%L::timestamptz,%L::timestamptz,%L,%L,%L,%L)',
  'd0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000012',t,t+interval '10 minutes',
  'dddddddd-bbbb-4bbb-8bbb-bbbbbbbbbbb4',repeat('b',64),'•••22','now'),'SLOT_RESERVED');
end; $$;
set local role service_role;
do $$ declare op jsonb; begin
 op:=public.claim_hardware_operation('dddddddd-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
 perform pg_temp.assert_true(op->>'kind'='release','Departure cleanup uses the guarded operation ledger');
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,
  'confirmed',clock_timestamp(),'lowered','vacant',null,false,'disabled');
 perform public.reconcile_hardware_slots();
end; $$;
reset role;
select pg_temp.assert_true((select status='completed' from public.hardware_slot_bookings
 where id=current_setting('multi.test.a')::uuid),'Confirmed vacant/lowered cleanup ends owner A session');
set local role authenticated;
do $$ declare t timestamptz:=clock_timestamp(); w jsonb; begin
 w:=public.request_hardware_slot('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000012',
  t,t+interval '10 minutes','dddddddd-bbbb-4bbb-8bbb-bbbbbbbbbbb5',repeat('b',64),'•••22','now');
 perform pg_temp.assert_true(w#>>'{slot,connectorId}'='d0000000-0000-4000-8000-000000000012',
  'After confirmed cleanup owner B can select the other connector on the same bay');
 perform public.cancel_hardware_slot((w#>>'{slot,id}')::uuid);
end; $$;

-- An unrelated blocking car enters an unreserved bay. The second connector
-- does not create another parking space; fallback needs another physical bay.
set local role service_role;
select public.record_hardware_bay_observation('d0000000-0000-4000-8000-000000000001',
 clock_timestamp(),'lowered','occupied',false,'disabled');
set local role authenticated;
do $$ declare t timestamptz:=clock_timestamp(); w jsonb; begin
 w:=public.request_hardware_slot('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000012',
  t,t+interval '10 minutes','dddddddd-bbbb-4bbb-8bbb-bbbbbbbbbbb6',repeat('b',64),'•••22','now');
 perform pg_catalog.set_config('multi.test.fallback',w#>>'{slot,id}',true);
end; $$;
set local role service_role;
select public.reconcile_hardware_slots();
reset role;
select pg_temp.assert_true((select bay_id='d0000000-0000-4000-8000-000000000002'
 and connector_id='d0000000-0000-4000-8000-000000000002'
 and requested_bay_id='d0000000-0000-4000-8000-000000000001' and status='active'
 from public.hardware_slot_bookings where id=current_setting('multi.test.fallback')::uuid),
 'A blocking car causes owner B fallback to another compatible physical bay');
select pg_temp.assert_true(not exists(select 1 from public.hardware_operations
 where bay_id='d0000000-0000-4000-8000-000000000001' and status in ('queued','claimed','dispatching','acknowledged')),
 'No barrier operation targets either connector on the occupied original bay');

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','d1111111-1111-4111-8111-111111111111',true);
do $$ declare t timestamptz:=clock_timestamp()+interval '5 minutes'; w jsonb; begin
 w:=public.request_hardware_slot('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001',
  t,t+interval '10 minutes','dddddddd-bbbb-4bbb-8bbb-bbbbbbbbbbb7',repeat('a',64),'•••11','scheduled');
 perform pg_catalog.set_config('multi.test.full',w#>>'{slot,id}',true);
end; $$;
set local role service_role;
select public.reconcile_hardware_slots();
do $$ declare w jsonb; begin
 w:=public.list_hardware_booking_alternatives(current_setting('multi.test.full')::uuid);
 perform pg_temp.assert_true(jsonb_array_length(w->'alternatives')=2
  and w#>>'{alternatives,0,locationId}'='d0000000-0000-4000-8000-000000000200',
  'Full location suggests the nearest compatible freshly vacant other registered location');
end; $$;
reset role;
select pg_temp.assert_true((select status='cancelled' and failure_reason='LOCATION_FULL'
 and payment_status='mock_refunded' and reservation_fee_cents=100 and hardware_reservation_id is null
 from public.hardware_slot_bookings where id=current_setting('multi.test.full')::uuid),
 'Full location records a mock refund without allocating or releasing someone else’s bay');
rollback;
select 'Distinct drivers, car identity, ownership, occupied retention, cleanup, fallback and mock refund passed.' as result;
