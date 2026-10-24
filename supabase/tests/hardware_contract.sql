-- Durable physical workflow assertions. Fictional locks only; no HTTP calls.
begin;
create function pg_temp.assert_true(p boolean,m text) returns void language plpgsql as $$
begin if p is distinct from true then raise exception 'Assertion failed: %',m; end if; end;
$$;
create function pg_temp.expect_error(q text,m text) returns void language plpgsql as $$
declare actual text;
begin
  begin execute q;
  exception when others then get stacked diagnostics actual=message_text;
    if actual=m then return; end if; raise exception 'Expected %, got %',m,actual;
  end;
  raise exception 'Expected %, statement succeeded',m;
end;
$$;
select pg_temp.assert_true(
  not pg_catalog.has_table_privilege('authenticated','public.hardware_operations','SELECT')
  and not pg_catalog.has_table_privilege('authenticated','public.hardware_controls','UPDATE')
  and not pg_catalog.has_function_privilege('authenticated','public.claim_hardware_operation(uuid,uuid)','EXECUTE')
  and not pg_catalog.has_function_privilege('anon','public.list_hardware_operations()','EXECUTE')
  and not pg_catalog.has_function_privilege('authenticated','public._cancel_demo_reservation(uuid)','EXECUTE')
  and not pg_catalog.has_function_privilege('authenticated','public._reserve_demo_bay(uuid,integer,uuid,uuid)','EXECUTE')
  and pg_catalog.has_function_privilege('service_role','public.claim_hardware_operation(uuid,uuid)','EXECUTE')
  and pg_catalog.has_function_privilege('authenticated','public.request_hardware_reservation(uuid,uuid,integer,uuid)','EXECUTE'),
  'Phones cannot read private controls, bypass guarded rehearsal RPCs, or claim hardware commands');
select pg_temp.assert_true((select pg_catalog.bool_and(c.relrowsecurity) from pg_catalog.pg_class c
  where c.oid in('public.hardware_controls'::regclass,'public.hardware_operations'::regclass)), 'Hardware tables have RLS');

insert into auth.users(id) values('f1111111-1111-4111-8111-111111111111'),('f2222222-2222-4222-8222-222222222222');
insert into public.charging_locations(id,label) values('f0000000-0000-4000-8000-000000000100','Fictional hardware test location');
insert into public.bookable_bays(id,location_id,label,integration_mode,ecurious_lock_id,enabled) values
 ('f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000100','Fictional hardware bay A','ecurious','fictional-contract-lock-a',true),
 ('f0000000-0000-4000-8000-000000000002','f0000000-0000-4000-8000-000000000100','Fictional hardware bay B','ecurious','fictional-contract-lock-b',true);
insert into public.bay_connectors(id,bay_id,label,connector_type,power_kw,enabled) values
 ('f0000000-0000-4000-8000-000000000011','f0000000-0000-4000-8000-000000000001','A CCS','CCS',150,true),
 ('f0000000-0000-4000-8000-000000000012','f0000000-0000-4000-8000-000000000001','A Type2','Typ2',22,true),
 ('f0000000-0000-4000-8000-000000000021','f0000000-0000-4000-8000-000000000002','B CCS','CCS',150,true);
insert into public.hardware_controls(bay_id) values('f0000000-0000-4000-8000-000000000001'),('f0000000-0000-4000-8000-000000000002');
select pg_catalog.set_config('request.jwt.claim.sub','',true);
select pg_temp.expect_error('select public.list_hardware_workflows()','AUTH_REQUIRED');
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
select pg_temp.expect_error($q$select public.request_hardware_reservation('f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000011',10,'fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')$q$,'HARDWARE_DISABLED');
reset role;
update public.hardware_controls set enabled=true,interlocks_confirmed=true where bay_id in('f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000002');
set local role authenticated;
do $$
declare w jsonb; again jsonb;
begin
  w:=public.request_hardware_reservation('f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000011',10,'fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');
  perform pg_temp.assert_true(w->>'phase'='protect_pending' and (w#>>'{reservation,isMine}')::boolean,'Reserve records intent without claiming protected hardware');
  perform pg_catalog.set_config('hardware.test.res',w#>>'{reservation,id}',true);
  perform pg_catalog.set_config('hardware.test.op',w#>>'{operation,id}',true);
  again:=public.request_hardware_reservation('f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000011',10,'fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');
  perform pg_temp.assert_true(again#>>'{reservation,id}'=w#>>'{reservation,id}' and again#>>'{operation,id}'=w#>>'{operation,id}','Repeated request creates neither a new hold nor command');
  perform pg_temp.expect_error(pg_catalog.format('select public.cancel_reservation(%L)',w#>>'{reservation,id}'),'HARDWARE_WORKFLOW_REQUIRED');
  perform pg_temp.assert_true(not exists(select 1 from pg_catalog.jsonb_array_elements(public.list_bay_availability()->'bays') x where x.value->>'mode'='ecurious'), 'Physical holds use their dedicated overdue-aware projection');
end;
$$;
select pg_temp.expect_error($q$select public.request_hardware_reservation('f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000012',10,'fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')$q$,'IDEMPOTENCY_CONFLICT');
select pg_catalog.set_config('request.jwt.claim.sub','f2222222-2222-4222-8222-222222222222',true);
select pg_temp.expect_error($q$select public.request_hardware_reservation('f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000012',10,'fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2')$q$,'HARDWARE_UNAVAILABLE');
do $$ declare w jsonb; begin
 w:=public.get_hardware_workflow('f0000000-0000-4000-8000-000000000001');
 perform pg_temp.assert_true(w#>'{reservation,id}'='null'::jsonb and not(w#>>'{reservation,isMine}')::boolean,'Other holder IDs remain private');
 perform pg_temp.expect_error(pg_catalog.format('select public.request_hardware_entry(%L)',pg_catalog.current_setting('hardware.test.res')),'RESERVATION_NOT_FOUND');
end; $$;
set local role service_role;
do $$ declare op jsonb; begin
 op:=public.claim_hardware_operation('faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',pg_catalog.current_setting('hardware.test.op')::uuid);
 perform pg_catalog.set_config('hardware.test.claim',op::text,true);
 perform pg_temp.assert_true(op->>'status'='claimed' and op->>'claimToken' is not null,'Worker receives a fenced predispatch claim');
 perform pg_temp.assert_true(public.claim_hardware_operation('faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',(op->>'id')::uuid) is null,'A live claim cannot be stolen');
 perform pg_temp.assert_true((public.list_hardware_operations()->'operations'->0->'claimToken')='null'::jsonb,'Listing never shares another live dispatcher token');
end; $$;
reset role;
update public.hardware_operations set claim_expires_at=pg_catalog.clock_timestamp()-interval '1 second' where id=pg_catalog.current_setting('hardware.test.op')::uuid;
set local role service_role;
do $$ declare old jsonb:=pg_catalog.current_setting('hardware.test.claim')::jsonb; op jsonb; occupied_at timestamptz; begin
 op:=public.claim_hardware_operation('faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',(old->>'id')::uuid);
 perform pg_temp.assert_true(op->>'claimToken'<>old->>'claimToken','Expired predispatch claim gets a new token');
 perform pg_temp.expect_error(pg_catalog.format('select public.mark_hardware_dispatch(%L,%L,clock_timestamp(),%L,%L,false,%L)',old->>'id',old->>'claimToken','lowered','vacant','disabled'),'HARDWARE_CLAIM_INVALID');
 perform pg_catalog.set_config('hardware.test.claim',op::text,true);
 perform pg_temp.expect_error(pg_catalog.format('select public.mark_hardware_dispatch(%L,%L,clock_timestamp(),%L,%L,false,%L)',op->>'id',op->>'claimToken','lowered','occupied','disabled'),'HARDWARE_PREFLIGHT_REJECTED');
 perform pg_temp.expect_error(pg_catalog.format('select public.mark_hardware_dispatch(%L,%L,clock_timestamp(),%L,%L,false,%L)',op->>'id',op->>'claimToken','lowered','vacant','any-plate'),'HARDWARE_PREFLIGHT_REJECTED');
 perform pg_temp.expect_error(pg_catalog.format('select public.mark_hardware_dispatch(%L,%L,clock_timestamp()-interval %L,%L,%L,false,%L)',op->>'id',op->>'claimToken','1 minute','lowered','vacant','disabled'),'HARDWARE_PREFLIGHT_REJECTED');
 occupied_at:=pg_catalog.clock_timestamp();
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'blocked',occupied_at,'lowered','occupied','BAY_OCCUPIED',false,'disabled');
 op:=public.claim_hardware_operation('faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',(op->>'id')::uuid);
 perform pg_temp.expect_error(pg_catalog.format('select public.mark_hardware_dispatch(%L,%L,%L::timestamptz,%L,%L,false,%L)',op->>'id',op->>'claimToken',occupied_at-interval '1 second','lowered','vacant','disabled'),'HARDWARE_PREFLIGHT_REJECTED');
 op:=public.mark_hardware_dispatch((op->>'id')::uuid,(op->>'claimToken')::uuid,pg_catalog.clock_timestamp(),'lowered','vacant',false,'disabled');
 perform pg_temp.assert_true(op->>'status'='dispatching','Dispatch permit is durable before any external write');
 perform pg_catalog.set_config('hardware.test.claim',op::text,true);
 perform pg_temp.expect_error(pg_catalog.format('select public.mark_hardware_dispatch(%L,%L,clock_timestamp(),%L,%L,false,%L)',op->>'id',op->>'claimToken','lowered','vacant','disabled'),'HARDWARE_CLAIM_INVALID');
end; $$;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
do $$ declare w jsonb; begin
 w:=public.request_hardware_release(pg_catalog.current_setting('hardware.test.res')::uuid);
 perform pg_temp.assert_true(w#>>'{operation,id}'=pg_catalog.current_setting('hardware.test.op') and w#>>'{operation,status}'='dispatching','Cancellation cannot replace an in-flight physical command');
end; $$;
set local role service_role;
do $$ declare op jsonb:=pg_catalog.current_setting('hardware.test.claim')::jsonb; result jsonb; begin
 result:=public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',pg_catalog.clock_timestamp(),'raised','vacant',null,false,'disabled');
 perform pg_temp.assert_true(result->>'status'='uncertain','A matching GET without persisted acknowledgement cannot release dispatch quarantine');
 perform pg_temp.assert_true(public.claim_hardware_operation('faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',(op->>'id')::uuid) is null,'Dispatched uncertain operation is never reclaimed');
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'acknowledged');
 result:=public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',(op->>'dispatchedAt')::timestamptz,'raised','vacant',null,false,'disabled');
 perform pg_temp.assert_true(result->>'status'='uncertain','Equal command/sample timestamps cannot confirm a new physical observation');
 result:=public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',(op->>'dispatchedAt')::timestamptz-interval '1 second','raised','vacant',null,false,'disabled');
 perform pg_temp.assert_true(result->>'status'='uncertain' and result->>'acknowledgedAt' is not null,'Old telemetry cannot confirm movement and does not erase acknowledgement');
 result:=public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',pg_catalog.clock_timestamp(),'raised','vacant',null,false,'disabled');
 perform pg_temp.assert_true(result->>'status'='confirmed','Fresh post-command target confirms an acknowledged movement');
end; $$;
reset role;
select pg_temp.assert_true((select r.status='held' and c.release_requested and c.phase='release_pending'
 from public.booking_reservations r join public.hardware_controls c on c.reservation_id=r.id
 where r.id=pg_catalog.current_setting('hardware.test.res')::uuid),'Cancellation keeps ownership until the new release operation finishes');
set local role service_role;
do $$ declare op jsonb; result jsonb; begin
 op:=public.claim_hardware_operation('faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3');
 perform pg_temp.assert_true(op->>'kind'='release','Cleanup queues only after prior movement is resolved');
 result:=public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'blocked',pg_catalog.clock_timestamp(),'raised','occupied','BAY_OCCUPIED',false,'disabled');
 perform pg_temp.assert_true(result->>'status'='queued','Known unsent occupied preflight can wait for a new safe observation');
 op:=public.claim_hardware_operation('faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',(op->>'id')::uuid);
 result:=public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',pg_catalog.clock_timestamp(),'lowered','vacant',null,false,'disabled');
 perform pg_temp.assert_true(result->>'status'='confirmed' and result->'dispatchedAt'='null'::jsonb,'Already-safe target is confirmed without issuing a command');
end; $$;
reset role;
select pg_temp.assert_true((select r.status='cancelled' and c.reservation_id is null and c.phase='idle'
 from public.booking_reservations r join public.hardware_controls c on c.bay_id=r.bay_id
 where r.id=pg_catalog.current_setting('hardware.test.res')::uuid),'Only confirmed vacant release frees the bay');

-- Entry is owner-requested and movement-confirmed, never a plate/charging claim.
set local role authenticated;
do $$ declare w jsonb; begin
 w:=public.request_hardware_reservation('f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000011',10,'fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5');
 perform pg_catalog.set_config('hardware.test.entry',w#>>'{reservation,id}',true);
end; $$;
set local role service_role;
do $$ declare op jsonb; sampled_at timestamptz; begin
 op:=public.claim_hardware_operation('faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3');
 sampled_at:=pg_catalog.clock_timestamp();
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',sampled_at,'raised','vacant',null,false,'disabled');
 perform public.record_hardware_result((op->>'id')::uuid,null,'blocked',sampled_at,'raised','occupied','BAY_OCCUPIED',false,'disabled');
 perform public.record_hardware_result((op->>'id')::uuid,null,'confirmed',sampled_at,'raised','vacant',null,false,'disabled');
 perform pg_catalog.set_config('hardware.test.conflicted_op',op->>'id',true);
end; $$;
set local role authenticated;
do $$ declare w jsonb; begin
 w:=public.get_hardware_workflow('f0000000-0000-4000-8000-000000000001');
 perform pg_temp.assert_true(w->>'phase'<>'protected' and (w#>>'{observation,conflicted}')::boolean,
   'Contradictory same-timestamp samples latch uncertainty; an identical old safe sample cannot clear it');
end; $$;
set local role service_role;
select public.record_hardware_result(pg_catalog.current_setting('hardware.test.conflicted_op')::uuid,null,'confirmed',pg_catalog.clock_timestamp(),'raised','vacant',null,false,'disabled');
set local role authenticated;
select public.request_hardware_entry(pg_catalog.current_setting('hardware.test.entry')::uuid);
set local role service_role;
do $$ declare op jsonb; begin
 op:=public.claim_hardware_operation('faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3');
 perform pg_temp.assert_true(op->>'kind'='entry','Protected owner entry queues the lower operation');
 op:=public.mark_hardware_dispatch((op->>'id')::uuid,(op->>'claimToken')::uuid,pg_catalog.clock_timestamp(),'raised','vacant',false,'disabled');
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'acknowledged');
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',pg_catalog.clock_timestamp(),'lowered','vacant',null,false,'disabled');
 perform public.record_hardware_result((op->>'id')::uuid,null,'blocked',pg_catalog.clock_timestamp(),'lowered','occupied','BAY_OCCUPIED',false,'disabled');
end; $$;
reset role;
select pg_temp.assert_true((select c.phase='entry_open' and r.status='held' and c.occupancy='occupied'
 from public.hardware_controls c join public.booking_reservations r on r.id=c.reservation_id
 where r.id=pg_catalog.current_setting('hardware.test.entry')::uuid),'Occupied entry retains ownership without inventing plate authorization or charging');
set local role authenticated;
select public.request_hardware_release(pg_catalog.current_setting('hardware.test.entry')::uuid);
set local role service_role;
do $$ declare op jsonb; begin
 op:=public.claim_hardware_operation('faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3');
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'blocked',pg_catalog.clock_timestamp(),'lowered','occupied','BAY_OCCUPIED',false,'disabled');
 op:=public.claim_hardware_operation('faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',(op->>'id')::uuid);
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',pg_catalog.clock_timestamp(),'lowered','vacant',null,false,'disabled');
end; $$;

-- Cancellation fences a claim that has not received a dispatch permit.
set local role authenticated;
do $$ declare w jsonb; begin
 w:=public.request_hardware_reservation('f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000011',10,'fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6');
 perform pg_catalog.set_config('hardware.test.cancelclaim',w#>>'{reservation,id}',true);
end; $$;
set local role service_role;
do $$ declare op jsonb; begin
 op:=public.claim_hardware_operation('faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3');
 perform pg_catalog.set_config('hardware.test.oldclaim',op::text,true);
end; $$;
set local role authenticated;
select public.request_hardware_release(pg_catalog.current_setting('hardware.test.cancelclaim')::uuid);
set local role service_role;
do $$ declare old jsonb:=pg_catalog.current_setting('hardware.test.oldclaim')::jsonb; op jsonb; begin
 perform pg_temp.expect_error(pg_catalog.format('select public.mark_hardware_dispatch(%L,%L,clock_timestamp(),%L,%L,false,%L)',old->>'id',old->>'claimToken','lowered','vacant','disabled'),'HARDWARE_CLAIM_INVALID');
 op:=public.claim_hardware_operation('faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3');
 perform pg_temp.assert_true(op->>'kind'='release','Invalidated unsent protection is replaced by safe cleanup intent');
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',pg_catalog.clock_timestamp(),'lowered','vacant',null,false,'disabled');
end; $$;

-- An unused protected hold expires as an intent, not as free physical capacity.
set local role authenticated;
do $$ declare w jsonb; begin
 w:=public.request_hardware_reservation('f0000000-0000-4000-8000-000000000002','f0000000-0000-4000-8000-000000000021',10,'fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3');
 perform pg_catalog.set_config('hardware.test.noshow',w#>>'{reservation,id}',true);
end; $$;
set local role service_role;
do $$ declare op jsonb; begin
 op:=public.claim_hardware_operation('faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3');
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',pg_catalog.clock_timestamp(),'raised','vacant',null,false,'disabled');
end; $$;
reset role;
with t as(select pg_catalog.clock_timestamp() n) update public.booking_reservations r
 set starts_at=t.n-interval '11 minutes',expires_at=t.n-interval '1 minute'
 from t where r.id=pg_catalog.current_setting('hardware.test.noshow')::uuid;
set local role service_role;
select public.reconcile_hardware_deadlines();
reset role;
select pg_temp.assert_true((select r.status='held' and c.release_requested and c.release_reason='no_show' and c.phase='release_pending'
 from public.booking_reservations r join public.hardware_controls c on c.reservation_id=r.id
 where r.id=pg_catalog.current_setting('hardware.test.noshow')::uuid),'No-show deadline retains allocation pending physical cleanup');
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','f2222222-2222-4222-8222-222222222222',true);
select pg_temp.expect_error($q$select public.request_hardware_reservation('f0000000-0000-4000-8000-000000000002','f0000000-0000-4000-8000-000000000021',10,'fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4')$q$,'HARDWARE_UNAVAILABLE');
reset role;
select pg_temp.expect_error($q$update public.bookable_bays set ecurious_lock_id='fictional-remapped-lock' where id='f0000000-0000-4000-8000-000000000002'$q$,'HARDWARE_MAPPING_IN_USE');
set local role service_role;
do $$ declare op jsonb; begin
 op:=public.claim_hardware_operation('faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3');
 perform public.record_hardware_result((op->>'id')::uuid,(op->>'claimToken')::uuid,'confirmed',pg_catalog.clock_timestamp(),'lowered','vacant',null,false,'disabled');
end; $$;
reset role;
select pg_temp.assert_true((select status='expired' from public.booking_reservations where id=pg_catalog.current_setting('hardware.test.noshow')::uuid),'No-show becomes expired only after confirmed vacant cleanup');
rollback;
select 'Hardware workflow contract passed; fictional fixtures rolled back.' as result;
