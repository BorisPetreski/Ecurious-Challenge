-- Synthetic slow-reporting devices; no provider requests or live enrollment.
begin;
create function pg_temp.assert_true(p boolean,m text) returns void language plpgsql as $$
begin if p is distinct from true then raise exception 'Assertion failed: %',m; end if; end;
$$;
insert into auth.users(id) values('f3111111-1111-4111-8111-111111111111');
insert into public.charging_locations(id,label) values
 ('f3000000-0000-4000-8000-000000000100','Fictional stale Now site'),
 ('f3000000-0000-4000-8000-000000000200','Fictional stale Scheduled site'),
 ('f3000000-0000-4000-8000-000000000300','Fictional occupied site');
insert into public.bookable_bays(id,location_id,label,integration_mode,ecurious_lock_id,enabled) values
 ('f3000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000100','Fictional stale Now','ecurious','fictional-wait-a',true),
 ('f3000000-0000-4000-8000-000000000002','f3000000-0000-4000-8000-000000000200','Fictional stale Scheduled','ecurious','fictional-wait-b',true),
 ('f3000000-0000-4000-8000-000000000003','f3000000-0000-4000-8000-000000000300','Fictional occupied','ecurious','fictional-wait-c',true);
insert into public.bay_connectors(id,bay_id,label,connector_type,power_kw,enabled)
 select id,id,'Barrier-only fixture','BARRIER_TEST',0,true from public.bookable_bays where id::text like 'f3000000-0000-4000-8000-00000000000%';
insert into public.hardware_controls(bay_id,enabled,interlocks_confirmed,observed_at,barrier,occupancy,faulted,access_mode,phase,reason)
 select id,true,true,clock_timestamp()-interval '3 minutes','lowered','vacant',false,'disabled','blocked','TELEMETRY_UNKNOWN'
 from public.bookable_bays where id::text like 'f3000000-0000-4000-8000-00000000000%';
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','f3111111-1111-4111-8111-111111111111',true);
do $$ declare w jsonb; t timestamptz:=clock_timestamp(); begin
 w:=public.request_hardware_slot('f3000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001',
  t,t+interval '10 minutes','f3bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',repeat('f',64),'•••11','now');
 perform pg_catalog.set_config('wait.test.now',w#>>'{slot,id}',true);
 w:=public.request_hardware_slot('f3000000-0000-4000-8000-000000000002','f3000000-0000-4000-8000-000000000002',
  t+interval '5 minutes',t+interval '15 minutes','f3bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',repeat('f',64),'•••11','scheduled');
 perform pg_catalog.set_config('wait.test.scheduled',w#>>'{slot,id}',true);
end; $$;
set local role service_role;
select public.reconcile_hardware_slots();
select public.reconcile_hardware_slots();
reset role;
select pg_temp.assert_true((select count(*)=2 and bool_and(status='scheduled' and failure_reason is null
 and hardware_reservation_id is null and activated_at is null)
 from public.hardware_slot_bookings where id in(current_setting('wait.test.now')::uuid,current_setting('wait.test.scheduled')::uuid)),
 'Stale Now and due Scheduled bookings remain pending intents rather than false full-location cancellations');
select pg_temp.assert_true((select payment_status='mock_paid' from public.hardware_slot_bookings
 where id=current_setting('wait.test.scheduled')::uuid),'Stale data alone does not fabricate a LOCATION_FULL refund');
select pg_temp.assert_true(not exists(select 1 from public.hardware_operations where bay_id::text like 'f3000000-%')
 and not exists(select 1 from public.booking_reservations where bay_id::text like 'f3000000-%'),
 'Pending stale intent binds no physical hold and issues no operation');
select pg_temp.assert_true((select bool_and(phase='blocked' and reason='TELEMETRY_UNKNOWN' and reservation_id is null)
 from public.hardware_controls where bay_id in('f3000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000002')),
 'Waiting does not reset the existing physical recovery/unknown guard');
set local role service_role;
select public.record_hardware_bay_observation('f3000000-0000-4000-8000-000000000001',clock_timestamp(),'lowered','vacant',false,'disabled');
select public.reconcile_hardware_slots();
reset role;
select pg_temp.assert_true((select s.status='active' and s.hardware_reservation_id=c.reservation_id and o.kind='protect' and o.status='queued'
 from public.hardware_slot_bookings s join public.hardware_controls c on c.bay_id=s.bay_id
 join public.hardware_operations o on o.id=c.current_operation_id where s.id=current_setting('wait.test.now')::uuid),
 'A fresh safe observation restores idle and allows the previously waiting intent to queue protection');
-- The existing unused deadline still bounds an unactivated waiting intent.
with t as(select clock_timestamp() n)
update public.hardware_slot_bookings s set starts_at=t.n-interval '11 minutes',protection_starts_at=t.n-interval '21 minutes',
 ends_at=t.n-interval '1 minute',protection_deadline_at=t.n-interval '1 minute'
 from t where s.id=current_setting('wait.test.scheduled')::uuid;
set local role service_role;
select public.reconcile_hardware_slots();
select public.record_hardware_bay_observation('f3000000-0000-4000-8000-000000000003',clock_timestamp(),'lowered','occupied',false,'disabled');
set local role authenticated;
do $$ declare w jsonb; t timestamptz:=clock_timestamp(); begin
 w:=public.request_hardware_slot('f3000000-0000-4000-8000-000000000003','f3000000-0000-4000-8000-000000000003',
  t+interval '5 minutes',t+interval '15 minutes','f3bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',repeat('f',64),'•••11','scheduled');
 perform pg_catalog.set_config('wait.test.full',w#>>'{slot,id}',true);
end; $$;
set local role service_role;
select public.reconcile_hardware_slots();
reset role;
select pg_temp.assert_true((select status='expired' and hardware_reservation_id is null from public.hardware_slot_bookings
 where id=current_setting('wait.test.scheduled')::uuid),'Waiting intent expires at its existing deadline without touching a physical allocation');
select pg_temp.assert_true((select status='cancelled' and failure_reason='LOCATION_FULL' and payment_status='mock_refunded'
 and hardware_reservation_id is null from public.hardware_slot_bookings where id=current_setting('wait.test.full')::uuid),
 'Fresh known occupied full inventory preserves the existing cancellation/mock refund');
-- A fresh compatible alternative still follows the same whole-bay selection.
insert into public.bookable_bays(id,location_id,label,integration_mode,ecurious_lock_id,enabled) values
 ('f3000000-0000-4000-8000-000000000004','f3000000-0000-4000-8000-000000000300','Fictional safe alternative','ecurious','fictional-wait-d',true);
insert into public.bay_connectors(id,bay_id,label,connector_type,power_kw,enabled) values
 ('f3000000-0000-4000-8000-000000000004','f3000000-0000-4000-8000-000000000004','Barrier-only fixture','BARRIER_TEST',0,true);
insert into public.hardware_controls(bay_id,enabled,interlocks_confirmed,observed_at,barrier,occupancy,faulted,access_mode)
 values('f3000000-0000-4000-8000-000000000004',true,true,clock_timestamp(),'lowered','vacant',false,'disabled');
set local role authenticated;
do $$ declare w jsonb; t timestamptz:=clock_timestamp(); begin
 w:=public.request_hardware_slot('f3000000-0000-4000-8000-000000000003','f3000000-0000-4000-8000-000000000003',
  t,t+interval '10 minutes','f3bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',repeat('f',64),'•••11','now');
 perform pg_catalog.set_config('wait.test.fallback',w#>>'{slot,id}',true);
end; $$;
set local role service_role;
select public.reconcile_hardware_slots();
reset role;
select pg_temp.assert_true((select status='active' and bay_id='f3000000-0000-4000-8000-000000000004'
 and requested_bay_id='f3000000-0000-4000-8000-000000000003' from public.hardware_slot_bookings
 where id=current_setting('wait.test.fallback')::uuid),'Fresh safe alternative allocation remains unchanged');
rollback;
select 'Slow telemetry waits; fresh safe activation/fallback, existing deadline and known-full refund passed.' as result;
