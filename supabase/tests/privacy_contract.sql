-- Fictional owners and booking history only. The export/request RPCs must not
-- cancel bookings, remove Auth identities, or release physical safety guards.
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
 ('f1111111-1111-4111-8111-111111111111'),('f2222222-2222-4222-8222-222222222222');
insert into public.charging_locations(id,label) values
 ('f0000000-0000-4000-8000-000000000100','Fictional privacy test location');
insert into public.bookable_bays(id,location_id,label,integration_mode,ecurious_lock_id,enabled) values
 ('f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000100','Fictional owner A hardware','ecurious','fictional-privacy-a',true),
 ('f0000000-0000-4000-8000-000000000002','f0000000-0000-4000-8000-000000000100','Fictional owner B hardware','ecurious','fictional-privacy-b',true),
 ('f0000000-0000-4000-8000-000000000003','f0000000-0000-4000-8000-000000000100','Fictional owner A demo','demo',null,true),
 ('f0000000-0000-4000-8000-000000000004','f0000000-0000-4000-8000-000000000100','Fictional owner B demo','demo',null,true);
insert into public.bay_connectors(id,bay_id,label,connector_type,power_kw,enabled)
 select b.id,b.id,'Fictional CCS','CCS',150,true from public.bookable_bays b
 where b.id::text like 'f0000000-0000-4000-8000-00000000000%';
insert into public.hardware_controls(bay_id,enabled,interlocks_confirmed,observed_at,barrier,occupancy,faulted,access_mode)
 select b.id,true,true,clock_timestamp(),'lowered','vacant',false,'disabled' from public.bookable_bays b
 where b.id in ('f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000002');

select pg_temp.assert_true(not pg_catalog.has_table_privilege('authenticated','public.privacy_erasure_requests','SELECT')
 and not pg_catalog.has_table_privilege('authenticated','public.privacy_erasure_requests','INSERT')
 and not pg_catalog.has_table_privilege('authenticated','public.privacy_erasure_requests','UPDATE')
 and not pg_catalog.has_table_privilege('authenticated','public.privacy_erasure_requests','DELETE')
 and not pg_catalog.has_table_privilege('anon','public.privacy_erasure_requests','SELECT')
 and not pg_catalog.has_function_privilege('anon','public.export_my_bayready_data()','EXECUTE')
 and not pg_catalog.has_function_privilege('anon','public.request_my_data_erasure()','EXECUTE')
 and not pg_catalog.has_function_privilege('anon','public.get_my_privacy_request()','EXECUTE')
 and not pg_catalog.has_function_privilege('authenticated','public._privacy_request_json(uuid)','EXECUTE')
 and (select relrowsecurity from pg_catalog.pg_class where oid='public.privacy_erasure_requests'::regclass),
 'Privacy table is RLS protected; neither clients nor anonymous callers can bypass owner RPCs');
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','',true);
select pg_temp.expect_error('select public.export_my_bayready_data()','AUTH_REQUIRED');
select pg_temp.expect_error('select public.request_my_data_erasure()','AUTH_REQUIRED');
select pg_temp.expect_error('select public.get_my_privacy_request()','AUTH_REQUIRED');
select pg_catalog.set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
do $$ declare w jsonb; t timestamptz:=clock_timestamp(); begin
 perform pg_temp.assert_true(public.get_my_privacy_request() is null,'No request exists before the owner asks');
 w:=public.export_my_bayready_data();
 perform pg_temp.assert_true(w->>'ownerId'='f1111111-1111-4111-8111-111111111111'
  and w->>'schemaVersion'='1' and w->'erasureRequest'='null'::jsonb
  and w->'directoryReservations'='[]'::jsonb and w->'directoryExtensions'='[]'::jsonb
  and w->'bayReservations'='[]'::jsonb and w->'hardwareBookings'='[]'::jsonb and w->'hardwareExtensions'='[]'::jsonb,
  'An empty owner export has stable empty arrays and does not create an erasure request');
 w:=public.reserve_directory_booking(9911,repeat('a',64),'now',null,'ffffffff-bbbb-4bbb-8bbb-bbbbbbbbbbb1');
 perform public.extend_directory_booking((w->>'id')::uuid,'ffffffff-bbbb-4bbb-8bbb-bbbbbbbbbbb2');
 perform public.cancel_directory_hold((w->>'id')::uuid);
 perform public.reserve_bay('f0000000-0000-4000-8000-000000000003',10,
  'ffffffff-bbbb-4bbb-8bbb-bbbbbbbbbbb3','f0000000-0000-4000-8000-000000000003');
 w:=public.request_hardware_slot('f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000001',
  t,t+interval '10 minutes','ffffffff-bbbb-4bbb-8bbb-bbbbbbbbbbb4',repeat('a',64),'•••11','now');
 perform pg_catalog.set_config('privacy.test.slot_a',w#>>'{slot,id}',true);
 perform public.request_hardware_slot_extension((w#>>'{slot,id}')::uuid,'ffffffff-bbbb-4bbb-8bbb-bbbbbbbbbbb5');
end; $$;
select pg_catalog.set_config('request.jwt.claim.sub','f2222222-2222-4222-8222-222222222222',true);
do $$ declare w jsonb; t timestamptz:=clock_timestamp(); begin
 w:=public.reserve_directory_booking(9922,repeat('b',64),'now',null,'ffffffff-bbbb-4bbb-8bbb-bbbbbbbbbbb6');
 perform public.extend_directory_booking((w->>'id')::uuid,'ffffffff-bbbb-4bbb-8bbb-bbbbbbbbbbb7');
 perform public.reserve_bay('f0000000-0000-4000-8000-000000000004',10,
  'ffffffff-bbbb-4bbb-8bbb-bbbbbbbbbbb8','f0000000-0000-4000-8000-000000000004');
 w:=public.request_hardware_slot('f0000000-0000-4000-8000-000000000002','f0000000-0000-4000-8000-000000000002',
  t,t+interval '10 minutes','ffffffff-bbbb-4bbb-8bbb-bbbbbbbbbbb9',repeat('b',64),'•••22','now');
 perform pg_catalog.set_config('privacy.test.slot_b',w#>>'{slot,id}',true);
 perform public.request_hardware_slot_extension((w#>>'{slot,id}')::uuid,'ffffffff-bbbb-4bbb-8bbb-bbbbbbbbbb10');
end; $$;
set local role service_role;
select public.reconcile_hardware_slots();
reset role;
-- Snapshot every physical/allocation/Auth row, not just counts. Intake and
-- exports may add the private queue row but must preserve these exact facts.
select pg_catalog.set_config('privacy.test.guards_before',(select jsonb_build_object(
 'auth',(select jsonb_agg(to_jsonb(u) order by u.id) from auth.users u),
 'controls',(select jsonb_agg(to_jsonb(c) order by c.bay_id) from public.hardware_controls c),
 'operations',(select jsonb_agg(to_jsonb(o) order by o.id) from public.hardware_operations o),
 'reservations',(select jsonb_agg(to_jsonb(r) order by r.id) from public.booking_reservations r),
 'hardwareSlots',(select jsonb_agg(to_jsonb(s) order by s.id) from public.hardware_slot_bookings s),
 'directory',(select jsonb_agg(to_jsonb(r) order by r.id) from public.directory_plug_reservations r)
 )::text),true);

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
do $$ declare w jsonb; q jsonb; again jsonb; begin
 w:=public.export_my_bayready_data();
 perform pg_temp.assert_true(jsonb_array_length(w->'directoryReservations')=1
  and w#>>'{directoryReservations,0,stationId}'='9911' and w#>>'{directoryReservations,0,status}'='cancelled'
  and jsonb_array_length(w->'directoryExtensions')=1 and jsonb_array_length(w->'bayReservations')=2
  and jsonb_array_length(w->'hardwareBookings')=1 and jsonb_array_length(w->'hardwareExtensions')=1
  and w#>>'{hardwareBookings,0,id}'=current_setting('privacy.test.slot_a')
  and w#>>'{hardwareBookings,0,maskedPlate}'='•••11',
  'Owner A export includes their terminal directory history/extensions, demo and hardware allocation, slot and extension');
 perform pg_temp.assert_true(not exists(select 1 from jsonb_array_elements(w->'bayReservations') r
   where r->>'bayId' not in ('f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000003'))
  and strpos(w::text,'f2222222-2222-4222-8222-222222222222')=0
  and strpos(w::text,current_setting('privacy.test.slot_b'))=0
  and strpos(w::text,repeat('a',64))>0 -- Own opaque directory slot, not a plate fingerprint field.
  and not (w#>'{hardwareBookings,0}' ?| array['plateHash','plate_hash','lastPlateEventKey','last_plate_event_key','activationRequestId'])
  and w::text!~'claimToken|claim_token|licensePlate|camera|apiKey|api_key|access_token',
  'Owner A export excludes owner B, camera/secret fields and private plate matching keys');
 q:=public.request_my_data_erasure();
 again:=public.request_my_data_erasure();
 perform pg_catalog.set_config('privacy.test.request_a',q->>'id',true);
 perform pg_temp.assert_true(q=again and q=public.get_my_privacy_request()
  and q->>'status'='pending_review' and (q->>'hasActiveHardwareBookings')::boolean
  and q->>'requestedAt'=q->>'updatedAt' and strpos(q->>'notice','has not been deleted')>0,
  'Repeated owner erasure intake returns the same pending request and clearly preserves active physical allocation');
 perform pg_temp.assert_true(public.export_my_bayready_data()->'erasureRequest'=q,
  'Owner export includes their own pending erasure request');
end; $$;

select pg_catalog.set_config('request.jwt.claim.sub','f2222222-2222-4222-8222-222222222222',true);
do $$ declare w jsonb; q jsonb; begin
 perform pg_temp.assert_true(public.get_my_privacy_request() is null,'Owner B cannot read owner A privacy request');
 w:=public.export_my_bayready_data();
 perform pg_temp.assert_true(jsonb_array_length(w->'directoryReservations')=1
  and w#>>'{directoryReservations,0,stationId}'='9922' and jsonb_array_length(w->'directoryExtensions')=1
  and jsonb_array_length(w->'bayReservations')=2 and jsonb_array_length(w->'hardwareBookings')=1
  and jsonb_array_length(w->'hardwareExtensions')=1 and w->'erasureRequest'='null'::jsonb
  and w#>>'{hardwareBookings,0,id}'=current_setting('privacy.test.slot_b')
  and strpos(w::text,current_setting('privacy.test.slot_a'))=0
  and strpos(w::text,current_setting('privacy.test.request_a'))=0,
  'Owner B export contains only B history and does not expose A request');
 q:=public.request_my_data_erasure();
 perform pg_temp.assert_true(q->>'id'<>current_setting('privacy.test.request_a')
  and q=public.request_my_data_erasure(),'Each owner gets exactly one independent idempotent pending request');
end; $$;
reset role;
select pg_temp.assert_true((select count(*)=2 and bool_and(status='pending_review') from public.privacy_erasure_requests),
 'Two owners create two pending rows despite duplicate requests');
select pg_temp.assert_true(current_setting('privacy.test.guards_before')::jsonb=(select jsonb_build_object(
 'auth',(select jsonb_agg(to_jsonb(u) order by u.id) from auth.users u),
 'controls',(select jsonb_agg(to_jsonb(c) order by c.bay_id) from public.hardware_controls c),
 'operations',(select jsonb_agg(to_jsonb(o) order by o.id) from public.hardware_operations o),
 'reservations',(select jsonb_agg(to_jsonb(r) order by r.id) from public.booking_reservations r),
 'hardwareSlots',(select jsonb_agg(to_jsonb(s) order by s.id) from public.hardware_slot_bookings s),
 'directory',(select jsonb_agg(to_jsonb(r) order by r.id) from public.directory_plug_reservations r)
 )), 'Privacy export/intake preserves every Auth identity, reservation, hardware guard and operation exactly');
rollback;
select 'Owner data export, private erasure intake, idempotency and untouched physical/Auth state passed.' as result;
