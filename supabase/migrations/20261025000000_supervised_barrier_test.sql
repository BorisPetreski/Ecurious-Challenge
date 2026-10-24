-- A separately enrolled, supervised test action uses a fresh human observation.
-- It never changes the age or meaning of the provider's retained sensor facts.
begin;

alter table public.hardware_controls add column supervised_test_enabled boolean not null default false;
alter table public.hardware_operations
  add column operator_attested_at timestamptz,
  add column operator_attested_by uuid references auth.users(id) on delete restrict,
  add constraint supervised_protect_evidence check (
    (operator_attested_at is null and operator_attested_by is null) or
    (operator_attested_at is not null and operator_attested_by is not null and kind='protect' and target='raised'));
comment on column public.hardware_controls.supervised_test_enabled is
  'Administrator-only default-off enrollment for a supervised lock-0002 barrier-only test. Each action additionally needs a new owner attestation; normal sensor policy is unchanged.';
comment on column public.hardware_operations.operator_attested_at is
  'Server time of the booking owner explicitly observing the test bay and arm path clear. Not provider telemetry. One protect operation only; expires for dispatch after 15 seconds and is never renewed on retry.';

alter function public._hardware_operation_json(uuid,boolean) rename to _hardware_operation_before_supervision_json;
create function public._hardware_operation_json(p_id uuid,p_reveal_token boolean default true)
returns jsonb language sql security definer set search_path='' as $$
  select public._hardware_operation_before_supervision_json(p_id,p_reveal_token)||
    pg_catalog.jsonb_build_object(
      'operatorAttestedAt',case when p_reveal_token then o.operator_attested_at else null end,
      'supervisedTestEnabled',case when p_reveal_token then c.supervised_test_enabled else null end)
  from public.hardware_operations o join public.hardware_controls c on c.bay_id=o.bay_id where o.id=p_id
$$;
alter function public._hardware_workflow_json(uuid,uuid) rename to _hardware_workflow_before_supervision_json;
create function public._hardware_workflow_json(p_bay_id uuid,p_owner uuid)
returns jsonb language sql security definer set search_path='' as $$
  select public._hardware_workflow_before_supervision_json(p_bay_id,p_owner)||
    pg_catalog.jsonb_build_object('supervisedTestEnabled',c.supervised_test_enabled)
  from public.hardware_controls c where c.bay_id=p_bay_id
$$;

create function public.request_supervised_hardware_slot(p_bay_id uuid,p_connector_id uuid,p_starts_at timestamptz,
  p_ends_at timestamptz,p_request_id uuid,p_plate_hash text,p_masked_plate text,p_booking_mode text,
  p_operator_bay_clear boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid(); c public.hardware_controls%rowtype; b public.bookable_bays%rowtype;
  s public.hardware_slot_bookings%rowtype; v_now timestamptz; v_result jsonb; v_res uuid; v_op uuid;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if p_operator_bay_clear is distinct from true then raise exception 'OPERATOR_OBSERVATION_REQUIRED'; end if;
  if p_booking_mode is distinct from 'now' then raise exception 'SUPERVISED_TEST_NOW_ONLY'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bayready:owner:'||v_owner::text,0));
  select x.* into s from public.hardware_slot_bookings x where x.owner_id=v_owner and x.idempotency_key=p_request_id;
  if found then
    -- Validate the original request through the unchanged booking contract.
    v_result:=public.request_hardware_slot(p_bay_id,p_connector_id,p_starts_at,p_ends_at,p_request_id,
      p_plate_hash,p_masked_plate,p_booking_mode);
    if not exists(select 1 from public.hardware_operations o where o.reservation_id=s.hardware_reservation_id
      and o.operator_attested_by=v_owner and o.operator_attested_at is not null and o.kind='protect') then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return v_result; -- In particular, never renew an old operator observation.
  end if;
  select x.* into b from public.bookable_bays x where x.id=p_bay_id for update;
  select x.* into c from public.hardware_controls x where x.bay_id=p_bay_id for update;
  v_now:=pg_catalog.clock_timestamp();
  if b.id is null or c.bay_id is null or b.integration_mode<>'ecurious' or b.ecurious_lock_id<>'lock-0002'
    or not b.enabled or not c.enabled or not c.interlocks_confirmed or not c.supervised_test_enabled
    or not exists(select 1 from public.bay_connectors x where x.id=p_connector_id and x.bay_id=b.id
      and x.enabled and x.connector_type='BARRIER_TEST' and x.power_kw=0) then
    raise exception 'SUPERVISED_TEST_DISABLED';
  end if;
  if c.reservation_id is not null or c.release_requested or c.entry_requested or c.observation_conflict
    or not(c.phase='idle' or c.phase='blocked' and c.reason='TELEMETRY_UNKNOWN')
    or c.observed_at is null or c.observed_at>v_now or c.faulted or c.access_mode<>'disabled'
    or (c.observed_at>=v_now-pg_catalog.make_interval(secs=>c.telemetry_max_age_ms/1000.0) and c.occupancy='occupied')
    or exists(select 1 from public.hardware_operations o where o.bay_id=b.id
      and o.status in ('queued','claimed','dispatching','acknowledged','uncertain'))
    or exists(select 1 from public.booking_reservations r where r.bay_id=b.id and r.status='held') then
    raise exception 'SUPERVISED_TEST_UNAVAILABLE';
  end if;
  v_result:=public.request_hardware_slot(p_bay_id,p_connector_id,p_starts_at,p_ends_at,p_request_id,
    p_plate_hash,p_masked_plate,p_booking_mode);
  select x.* into s from public.hardware_slot_bookings x where x.id=(v_result#>>'{slot,id}')::uuid for update;
  v_now:=pg_catalog.clock_timestamp();
  insert into public.booking_reservations(bay_id,connector_id,owner_id,starts_at,expires_at,idempotency_key,created_at)
    values(b.id,p_connector_id,v_owner,v_now,s.protection_deadline_at,s.activation_request_id,v_now) returning id into v_res;
  update public.hardware_controls set reservation_id=v_res,release_requested=false,release_reason=null,
    entry_requested=false,reason=null,updated_at=v_now where bay_id=b.id;
  update public.hardware_slot_bookings set hardware_reservation_id=v_res,activated_at=v_now,status='active',updated_at=v_now where id=s.id;
  v_op:=public._queue_hardware_operation(b.id,'protect');
  update public.hardware_operations set operator_attested_at=v_now,operator_attested_by=v_owner where id=v_op;
  return public.get_hardware_slot(s.id);
end;
$$;

create function public.mark_supervised_hardware_dispatch(p_operation_id uuid,p_claim_token uuid,p_observed_at timestamptz,
  p_barrier text,p_occupancy text,p_faulted boolean,p_access_mode text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_bay uuid; c public.hardware_controls%rowtype; o public.hardware_operations%rowtype;
  r public.booking_reservations%rowtype; s public.hardware_slot_bookings%rowtype; v_now timestamptz;
begin
  select x.bay_id into v_bay from public.hardware_operations x where x.id=p_operation_id;
  select x.* into c from public.hardware_controls x where x.bay_id=v_bay for update;
  select x.* into o from public.hardware_operations x where x.id=p_operation_id for update;
  v_now:=pg_catalog.clock_timestamp();
  if o.id is null or c.current_operation_id is distinct from o.id or c.reservation_id is distinct from o.reservation_id
    or o.status<>'claimed' or p_claim_token is null or o.claim_token is distinct from p_claim_token
    or o.claim_expires_at<=v_now then raise exception 'HARDWARE_CLAIM_INVALID'; end if;
  select x.* into r from public.booking_reservations x where x.id=o.reservation_id;
  select x.* into s from public.hardware_slot_bookings x where x.hardware_reservation_id=r.id;
  if not c.enabled or not c.interlocks_confirmed or not c.supervised_test_enabled or o.lock_id<>'lock-0002'
    or o.kind<>'protect' or o.target<>'raised'
    or not exists(select 1 from public.bookable_bays b join public.bay_connectors x on x.bay_id=b.id
      where b.id=v_bay and b.integration_mode='ecurious' and b.ecurious_lock_id=o.lock_id and b.enabled
        and x.id=r.connector_id and x.enabled and x.connector_type='BARRIER_TEST' and x.power_kw=0) then
    raise exception 'SUPERVISED_TEST_DISABLED';
  end if;
  if o.operator_attested_at is null or o.operator_attested_at>v_now or o.operator_attested_at<v_now-interval '15 seconds'
    or o.operator_attested_by is distinct from r.owner_id or r.status is distinct from 'held' or r.expires_at<=v_now
    or s.id is null or s.owner_id is distinct from r.owner_id or s.booking_mode<>'now' or s.status<>'active'
    or c.release_requested or c.entry_requested or c.observation_conflict or c.phase<>'protect_pending'
    or c.faulted or c.access_mode<>'disabled' or p_faulted is distinct from false or p_access_mode is distinct from 'disabled'
    or c.observed_at is null or c.observed_at>v_now or p_observed_at is null or p_observed_at>v_now or p_observed_at<c.observed_at
    or p_barrier is null or p_barrier not in ('raised','lowered','unknown')
    or p_occupancy is null or p_occupancy not in ('vacant','occupied','unknown')
    or (c.observed_at>=v_now-pg_catalog.make_interval(secs=>c.telemetry_max_age_ms/1000.0) and c.occupancy='occupied')
    or (p_observed_at>=v_now-pg_catalog.make_interval(secs=>c.telemetry_max_age_ms/1000.0) and p_occupancy is distinct from 'vacant')
    or (c.observed_at>=o.operator_attested_at and c.occupancy='occupied')
    or (p_observed_at>=o.operator_attested_at and p_occupancy='occupied')
    or (p_observed_at=c.observed_at and
      ((p_faulted,p_access_mode) is distinct from (c.faulted,c.access_mode)
        or (p_barrier<>'unknown' and c.barrier<>'unknown' and p_barrier<>c.barrier)
        or (p_occupancy<>'unknown' and c.occupancy<>'unknown' and p_occupancy<>c.occupancy))) then
    raise exception 'HARDWARE_PREFLIGHT_REJECTED';
  end if;
  -- Consume the same irreversible permit; retained provider observations remain untouched.
  update public.hardware_operations set status='dispatching',dispatched_at=v_now,claim_expires_at=null where id=o.id;
  update public.hardware_controls set phase='protecting',reason='WAITING_FOR_CONFIRMATION',updated_at=v_now where bay_id=v_bay;
  return public._hardware_operation_json(o.id);
end;
$$;

revoke all on function public._hardware_operation_before_supervision_json(uuid,boolean),
  public._hardware_workflow_before_supervision_json(uuid,uuid),public._hardware_operation_json(uuid,boolean),
  public._hardware_workflow_json(uuid,uuid),
  public.request_supervised_hardware_slot(uuid,uuid,timestamptz,timestamptz,uuid,text,text,text,boolean),
  public.mark_supervised_hardware_dispatch(uuid,uuid,timestamptz,text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.request_supervised_hardware_slot(uuid,uuid,timestamptz,timestamptz,uuid,text,text,text,boolean) to authenticated;
grant execute on function public.mark_supervised_hardware_dispatch(uuid,uuid,timestamptz,text,text,boolean,text) to service_role;
notify pgrst,'reload schema';
commit;
