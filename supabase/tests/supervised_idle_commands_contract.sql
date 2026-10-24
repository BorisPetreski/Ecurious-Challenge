-- Synthetic local SQL only; no hardware commands or hosted changes.
begin;
create function pg_temp.assert_true(p boolean,m text) returns void language plpgsql as $$
begin if p is distinct from true then raise exception 'Assertion failed: %',m; end if; end;
$$;
insert into auth.users(id) values ('81111111-1111-4111-8111-111111111111');
insert into public.charging_locations(id,label) values ('80000000-0000-4000-8000-000000000100','Synthetic idle control test');
insert into public.bookable_bays(id,location_id,label,integration_mode,ecurious_lock_id,enabled) values
 ('80000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000100','Synthetic supervised barrier','ecurious','lock-0002',true),
 ('80000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000100','Synthetic normal barrier','ecurious','fictional-idle-control',true);
insert into public.bay_connectors(id,bay_id,label,connector_type,power_kw,enabled) values
 ('80000000-0000-4000-8000-000000000011','80000000-0000-4000-8000-000000000001','Synthetic test interface','BARRIER_TEST',0,true),
 ('80000000-0000-4000-8000-000000000021','80000000-0000-4000-8000-000000000002','Synthetic normal interface','BARRIER_TEST',0,true);
insert into public.hardware_controls(bay_id,enabled,interlocks_confirmed,supervised_test_enabled,observed_at,barrier,occupancy,faulted,access_mode)
 select id,true,true,true,clock_timestamp(),'raised','vacant',false,'disabled' from public.bookable_bays where id in
 ('80000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000002');
select pg_temp.assert_true(public._queue_idle_hardware_release('80000000-0000-4000-8000-000000000001') is null
 and not exists(select 1 from public.hardware_operations where bay_id='80000000-0000-4000-8000-000000000001'),
 'Supervised designated barrier does not create an autonomous idle command');
select pg_temp.assert_true(public._queue_idle_hardware_release('80000000-0000-4000-8000-000000000002') is not null,
 'A different lock keeps normal idle cleanup even if its administrative flag is set');
-- Customer expiry/cancellation cleanup uses the existing reservation operation,
-- not the no-customer idle helper, and must remain available in supervised mode.
insert into public.booking_reservations(id,bay_id,connector_id,owner_id,starts_at,expires_at,idempotency_key)
 values('80000000-0000-4000-8000-000000000301','80000000-0000-4000-8000-000000000001',
 '80000000-0000-4000-8000-000000000011','81111111-1111-4111-8111-111111111111',clock_timestamp(),
 clock_timestamp()+interval '10 minutes','80000000-0000-4000-8000-000000000401');
update public.hardware_controls set reservation_id='80000000-0000-4000-8000-000000000301'
 where bay_id='80000000-0000-4000-8000-000000000001';
select pg_temp.assert_true(public._queue_hardware_operation('80000000-0000-4000-8000-000000000001','release') is not null
 and (select status='held' from public.booking_reservations where id='80000000-0000-4000-8000-000000000301'),
 'Supervised customer cleanup still queues a release and retains its allocation');
-- End this wholly synthetic fixture's customer cycle before examining idle
-- mode transitions. No helper under test performs these fixture mutations.
update public.hardware_operations set status='confirmed' where bay_id='80000000-0000-4000-8000-000000000001';
update public.booking_reservations set status='cancelled' where id='80000000-0000-4000-8000-000000000301';
update public.hardware_controls set reservation_id=null,supervised_test_enabled=false,phase='idle'
 where bay_id='80000000-0000-4000-8000-000000000001';
select set_config('supervised.idle.specialop',public._queue_idle_hardware_release('80000000-0000-4000-8000-000000000001')::text,true);
select pg_temp.assert_true(current_setting('supervised.idle.specialop')<>'' and (select status='queued' and reservation_id is null
 from public.hardware_operations where id=current_setting('supervised.idle.specialop')::uuid),
 'Turning supervised mode off restores ordinary idle command creation for the designated barrier');
update public.hardware_operations set status='dispatching',dispatched_at=clock_timestamp()
 where id=current_setting('supervised.idle.specialop')::uuid;
update public.hardware_controls set supervised_test_enabled=true,phase='releasing',reason='WAITING_FOR_CONFIRMATION'
 where bay_id='80000000-0000-4000-8000-000000000001';
select pg_temp.assert_true(public._queue_idle_hardware_release('80000000-0000-4000-8000-000000000001') is null
 and (select status='dispatching' and dispatched_at is not null from public.hardware_operations
   where id=current_setting('supervised.idle.specialop')::uuid)
 and (select current_operation_id=current_setting('supervised.idle.specialop')::uuid and phase='releasing'
   and reason='WAITING_FOR_CONFIRMATION' from public.hardware_controls where bay_id='80000000-0000-4000-8000-000000000001'),
 'Enabling supervision neither cancels an old dispatch nor clears its pointer/phase/recovery evidence');
-- Ordinary mode still creates one idle operation. Enabling supervised mode
-- subsequently never cancels, changes, or reclaims that old operation.
update public.hardware_controls set supervised_test_enabled=false where bay_id='80000000-0000-4000-8000-000000000002';
select set_config('supervised.idle.oldop',public._queue_idle_hardware_release('80000000-0000-4000-8000-000000000002')::text,true);
select pg_temp.assert_true((select count(*)=1 from public.hardware_operations where bay_id='80000000-0000-4000-8000-000000000002'),
 'Normal idle operation reuses its existing durable operation without duplicate allocation');
rollback;
select 'Supervised idle suppression leaves normal commands and customer cleanup unchanged.' as result;
