-- Targeted v7 product contract; synthetic inventory, no provider requests.
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
insert into auth.users(id) values('b1111111-1111-4111-8111-111111111111'),('b2222222-2222-4222-8222-222222222222');
insert into public.charging_locations(id,label,latitude,longitude) values
 ('b0000000-0000-4000-8000-000000000100','Fictional primary location',52.52,13.405),
 ('b0000000-0000-4000-8000-000000000200','Fictional next location 1',52.53,13.41),
 ('b0000000-0000-4000-8000-000000000300','Fictional next location 2',52.54,13.42),
 ('b0000000-0000-4000-8000-000000000400','Fictional next location 3',52.55,13.43),
 ('b0000000-0000-4000-8000-000000000500','Fictional next location 4',52.56,13.44);
insert into public.bookable_bays(id,location_id,label,integration_mode,ecurious_lock_id,enabled) values
 ('b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000100','Fictional occupied bay','ecurious','fictional-option-a',true),
 ('b0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000100','Fictional alternate bay','ecurious','fictional-option-b',true),
 ('b0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000100','Fictional lower power bay','ecurious','fictional-option-c',true),
 ('b0000000-0000-4000-8000-000000000004','b0000000-0000-4000-8000-000000000200','Fictional early protection','ecurious','fictional-option-d',true),
 ('b0000000-0000-4000-8000-000000000005','b0000000-0000-4000-8000-000000000300','Fictional nearby bay 2','ecurious','fictional-option-e',true),
 ('b0000000-0000-4000-8000-000000000006','b0000000-0000-4000-8000-000000000400','Fictional nearby bay 3','ecurious','fictional-option-f',true),
 ('b0000000-0000-4000-8000-000000000007','b0000000-0000-4000-8000-000000000500','Fictional nearby bay 4','ecurious','fictional-option-g',true);
insert into public.bay_connectors(id,bay_id,label,connector_type,power_kw,enabled)
 select b.id,b.id,'Fictional CCS','CCS',case when b.id='b0000000-0000-4000-8000-000000000003' then 50 else 150 end,true
 from public.bookable_bays b where b.id::text like 'b0000000-0000-4000-8000-00000000000%';
insert into public.hardware_controls(bay_id,enabled,interlocks_confirmed,observed_at,barrier,occupancy,faulted,access_mode,phase)
 select b.id,true,true,clock_timestamp(),'lowered',case when b.id='b0000000-0000-4000-8000-000000000001' then 'occupied' else 'vacant' end,
 false,'disabled',case when b.id='b0000000-0000-4000-8000-000000000001' then 'blocked' else 'idle' end
 from public.bookable_bays b where b.id::text like 'b0000000-0000-4000-8000-00000000000%';
select pg_temp.assert_true(not pg_catalog.has_table_privilege('authenticated','public.hardware_slot_extensions','SELECT')
 and not pg_catalog.has_function_privilege('authenticated','public.list_hardware_booking_alternatives(uuid)','EXECUTE'),
 'Extensions are private rows and availability alternatives require a trusted worker');
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','b1111111-1111-4111-8111-111111111111',true);
do $$ declare w jsonb; t timestamptz:=clock_timestamp(); begin
 perform pg_catalog.set_config('options.test.request_start',t::text,true);
 w:=public.request_hardware_slot('b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001',
  t,t+interval '10 minutes','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',repeat('b',64),'•••11','now');
 perform pg_catalog.set_config('options.test.now',w#>>'{slot,id}',true);
 perform pg_temp.assert_true(w#>>'{slot,bookingMode}'='now' and w#>>'{slot,paymentStatus}'='free'
  and (w#>>'{slot,reservationFeeCents}')::integer=0
  and (w#>>'{slot,endsAt}')::timestamptz-(w#>>'{slot,startsAt}')::timestamptz=interval '10 minutes',
  'Reserve now is exactly ten DB-clock minutes with a zero mock fee');
end; $$;
set local role service_role;
select public.reconcile_hardware_slots();
reset role;
select pg_temp.assert_true((select bay_id='b0000000-0000-4000-8000-000000000002' and connector_id=bay_id
 and requested_bay_id='b0000000-0000-4000-8000-000000000001' and status='active'
 from public.hardware_slot_bookings where id=current_setting('options.test.now')::uuid),
 'Occupied bay switches to another compatible physical bay at the same location, preserving requested identity');
select pg_temp.assert_true(not exists(select 1 from public.hardware_operations where bay_id='b0000000-0000-4000-8000-000000000001'),
 'Fallback never operates the occupied original bay or another plug on that occupied bay');
set local role authenticated;
do $$ declare w jsonb; again jsonb; t timestamptz:=current_setting('options.test.request_start')::timestamptz; begin
 w:=public.request_hardware_slot('b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001',
  t,t+interval '10 minutes','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',repeat('b',64),'•••11','now');
 perform pg_temp.assert_true(w#>>'{slot,id}'=current_setting('options.test.now'),'Original request remains idempotent after resource fallback');
 w:=public.request_hardware_slot_extension(current_setting('options.test.now')::uuid,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2');
 again:=public.request_hardware_slot_extension(current_setting('options.test.now')::uuid,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2');
 perform pg_temp.assert_true((w#>>'{slot,extensionCount}')::integer=1 and (w#>>'{slot,reservationFeeCents}')::integer=100
  and w#>>'{slot,paymentStatus}'='mock_paid' and again#>>'{slot,endsAt}'=w#>>'{slot,endsAt}',
  'One extension adds exactly ten minutes and one mocked euro; retries add nothing');
 perform pg_catalog.set_config('options.test.start',w#>>'{slot,startsAt}',true);
 perform public.request_hardware_slot('b0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002',
  (w#>>'{slot,startsAt}')::timestamptz+interval '30 minutes',(w#>>'{slot,startsAt}')::timestamptz+interval '50 minutes',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',repeat('b',64),'•••11','scheduled');
 perform pg_temp.expect_error(pg_catalog.format('select public.request_hardware_slot_extension(%L,%L)',current_setting('options.test.now'),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4'),'SLOT_RESERVED');
end; $$;
reset role;
select pg_temp.assert_true((select r.expires_at=s.ends_at and s.extension_count=1 and r.expires_at-r.starts_at>interval '19 minutes'
 from public.hardware_slot_bookings s join public.booking_reservations r on r.id=s.hardware_reservation_id
 where s.id=current_setting('options.test.now')::uuid),'Extension updates the physical expiry atomically; conflicting extension rolls back all changes');
set local role service_role;
do $$ declare op jsonb; begin
 op:=public.claim_hardware_operation('bbbbbbbb-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',clock_timestamp(),'raised','vacant',null,false,'disabled');
end; $$;
reset role;
update public.hardware_operations set confirmed_at=clock_timestamp()-interval '16 minutes'
 where reservation_id=(select hardware_reservation_id from public.hardware_slot_bookings where id=current_setting('options.test.now')::uuid)
 and kind='protect';
set local role service_role;
select public.reconcile_hardware_slots();
do $$ declare w jsonb; begin
 w:=public.authorize_hardware_plate_entry(current_setting('options.test.now')::uuid,repeat('b',64),clock_timestamp(),repeat('1',64));
 perform pg_temp.assert_true(w->>'phase'='entry_pending','Paid extension keeps Now entry valid beyond the old fifteen-minute policy');
end; $$;

set local role authenticated;
do $$ declare w jsonb; t timestamptz:=clock_timestamp(); begin
 w:=public.request_hardware_slot('b0000000-0000-4000-8000-000000000004','b0000000-0000-4000-8000-000000000004',
  t+interval '5 minutes',t+interval '25 minutes','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5',repeat('b',64),'•••11','scheduled');
 perform pg_catalog.set_config('options.test.scheduled',w#>>'{slot,id}',true);
 perform pg_temp.assert_true((w#>>'{slot,startsAt}')::timestamptz-(w#>>'{slot,protectionStartsAt}')::timestamptz=interval '10 minutes'
  and (w#>>'{slot,reservationFeeCents}')::integer=100 and w#>>'{slot,paymentStatus}'='mock_paid',
  'Scheduled booking costs one mocked euro and reserves ten-minute protection lead-in');
end; $$;
set local role service_role;
select public.reconcile_hardware_slots();
reset role;
select pg_temp.assert_true((select status='active' and activated_at<starts_at from public.hardware_slot_bookings
 where id=current_setting('options.test.scheduled')::uuid),'Scheduled protection activates during lead-in, before expected arrival');
set local role authenticated;
do $$ declare w jsonb; t timestamptz:=clock_timestamp(); begin
 w:=public.request_hardware_slot('b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001',
  t+interval '5 minutes',t+interval '25 minutes','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6',repeat('b',64),'•••11','scheduled');
 perform pg_catalog.set_config('options.test.failed',w#>>'{slot,id}',true);
end; $$;
set local role service_role;
select public.reconcile_hardware_slots();
do $$ declare w jsonb; begin
 w:=public.list_hardware_booking_alternatives(current_setting('options.test.failed')::uuid);
 perform pg_temp.assert_true(jsonb_array_length(w->'alternatives')=3
  and w#>>'{alternatives,0,locationId}'='b0000000-0000-4000-8000-000000000300',
  'Alternatives return the nearest three safe compatible other registered locations');
end; $$;
reset role;
select pg_temp.assert_true((select status='cancelled' and failure_reason='LOCATION_FULL' and payment_status='mock_refunded'
 and hardware_reservation_id is null from public.hardware_slot_bookings where id=current_setting('options.test.failed')::uuid),
 'A full location cancels/refunds an unactivated paid slot without creating or freeing a physical allocation');
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','b2222222-2222-4222-8222-222222222222',true);
select pg_temp.expect_error(pg_catalog.format('select public.request_hardware_slot_extension(%L,%L)',current_setting('options.test.now'),
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7'),'SLOT_NOT_FOUND');
do $$ declare w jsonb; begin
 w:=public.list_hardware_slots('b0000000-0000-4000-8000-000000000002');
 perform pg_temp.assert_true(w#>'{slots,0,paymentStatus}'='null'::jsonb and w#>'{slots,0,reservationFeeCents}'='null'::jsonb
  and w#>'{slots,0,requestedBayId}'='null'::jsonb and w#>>'{slots,0,bookingMode}'='now',
  'Shared calendar exposes protection timing but keeps payment and original resource identity private');
end; $$;
rollback;
select 'Booking options, extensions, physical fallback and registered alternatives passed.' as result;
