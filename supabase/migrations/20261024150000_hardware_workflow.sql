-- Durable commands for explicitly registered Ecurious bays. No hardware seed.
-- This schema never calls hardware. Service-role workers use fenced claims;
-- a dispatched command is never automatically claimed or sent a second time.
begin;

create table public.hardware_controls (
  bay_id uuid primary key references public.bookable_bays(id) on delete restrict,
  enabled boolean not null default false,
  interlocks_confirmed boolean not null default false,
  telemetry_max_age_ms integer not null default 5000 check (telemetry_max_age_ms between 1000 and 15000),
  reservation_id uuid unique references public.booking_reservations(id) on delete restrict,
  current_operation_id uuid,
  phase text not null default 'idle' check (phase in (
    'idle','protect_pending','protecting','protected','entry_pending','entering','entry_open',
    'release_pending','releasing','blocked','uncertain'
  )),
  reason text,
  release_requested boolean not null default false,
  release_reason text check (release_reason in ('cancel','no_show','expired')),
  entry_requested boolean not null default false,
  observed_at timestamptz,
  observation_conflict boolean not null default false,
  barrier text not null default 'unknown' check (barrier in ('raised','lowered','unknown')),
  occupancy text not null default 'unknown' check (occupancy in ('vacant','occupied','unknown')),
  faulted boolean not null default true,
  access_mode text not null default 'unknown' check (access_mode in ('disabled','specific-plates','any-plate','unknown')),
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);
create table public.hardware_operations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  sequence bigint generated always as identity unique,
  bay_id uuid not null references public.hardware_controls(bay_id) on delete restrict,
  reservation_id uuid not null references public.booking_reservations(id) on delete restrict,
  lock_id text not null,
  kind text not null check (kind in ('protect','entry','release')),
  target text not null check (target in ('raised','lowered')),
  status text not null default 'queued' check (status in (
    'queued','claimed','dispatching','acknowledged','uncertain','confirmed','cancelled'
  )),
  worker_id uuid,
  claim_token uuid,
  claim_expires_at timestamptz,
  requested_at timestamptz not null default pg_catalog.clock_timestamp(),
  dispatched_at timestamptz,
  acknowledged_at timestamptz,
  confirmed_at timestamptz,
  observed_at timestamptz,
  reason text,
  constraint operation_target check ((kind='protect' and target='raised') or (kind in ('entry','release') and target='lowered'))
);
alter table public.hardware_controls add constraint control_current_operation
  foreign key(current_operation_id) references public.hardware_operations(id) on delete restrict;
create unique index hardware_one_unresolved_operation on public.hardware_operations(bay_id)
  where status in ('queued','claimed','dispatching','acknowledged','uncertain');
create index hardware_operations_history on public.hardware_operations(bay_id,sequence desc);
alter table public.hardware_controls enable row level security;
alter table public.hardware_operations enable row level security;
revoke all on public.hardware_controls,public.hardware_operations from public,anon,authenticated;
comment on table public.hardware_controls is
  'Private per-bay allocation and physical recovery guard. Default disabled; an overdue or cancelled intent never frees a protected/uncertain bay without confirmed cleanup. Operator must confirm interlocks and mapping.';
comment on table public.hardware_operations is
  'Private command ledger. Claims can be replaced only before dispatch; dispatching/acknowledged/uncertain operations are read-reconciled, never resent. No raw plates, camera captures or arbitrary upstream payloads.';

create function public._hardware_operation_json(p_id uuid,p_reveal_token boolean default true)
returns jsonb language sql security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'id',o.id,'bayId',o.bay_id,'lockId',o.lock_id,'reservationId',o.reservation_id,
    'kind',o.kind,'target',o.target,'status',o.status,
    'claimToken',case when p_reveal_token then o.claim_token else null end,
    'requestedAt',o.requested_at,'dispatchedAt',o.dispatched_at,'acknowledgedAt',o.acknowledged_at,
    'controlsEnabled',c.enabled,'interlocksConfirmed',c.interlocks_confirmed,
    'telemetryMaxAgeMs',c.telemetry_max_age_ms
  ) from public.hardware_operations o join public.hardware_controls c on c.bay_id=o.bay_id where o.id=p_id
$$;

create function public._hardware_workflow_json(p_bay_id uuid,p_owner uuid)
returns jsonb language sql security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'serverNow',pg_catalog.clock_timestamp(),
    'bay',pg_catalog.jsonb_build_object('id',b.id,'label',b.label,'lockId',b.ecurious_lock_id,
      'connectors',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',x.id,'label',x.label,'type',x.connector_type,'powerKw',x.power_kw,'enabled',x.enabled
      ) order by x.label,x.id) from public.bay_connectors x where x.bay_id=b.id),'[]'::jsonb)),
    'reservation',pg_catalog.jsonb_build_object(
      'id',case when r.owner_id=p_owner then r.id else null end,
      'isMine',coalesce(r.owner_id=p_owner,false),'expiresAt',r.expires_at),
    'phase',c.phase,'reason',c.reason,
    'controlsEnabled',c.enabled,'interlocksConfirmed',c.interlocks_confirmed,
    'telemetryMaxAgeMs',c.telemetry_max_age_ms,
    'observation',pg_catalog.jsonb_build_object('observedAt',c.observed_at,'conflicted',c.observation_conflict,'barrier',c.barrier,
      'occupancy',c.occupancy,'faulted',c.faulted,'accessMode',c.access_mode),
    'operation',case when o.id is null then null else pg_catalog.jsonb_build_object(
      'id',o.id,'kind',o.kind,'target',o.target,'status',o.status,
      'requestedAt',o.requested_at,'dispatchedAt',o.dispatched_at) end,
    'capabilities',pg_catalog.jsonb_build_object(
      'canReserve',b.enabled and c.enabled and c.interlocks_confirmed and c.phase='idle' and c.reservation_id is null,
      'canRequestEntry',coalesce(r.owner_id=p_owner,false) and c.enabled and c.interlocks_confirmed
        and c.phase='protected' and not c.release_requested and r.expires_at>pg_catalog.clock_timestamp(),
      'canRequestRelease',coalesce(r.owner_id=p_owner,false) and c.reservation_id is not null
    )
  ) from public.bookable_bays b join public.hardware_controls c on c.bay_id=b.id
    left join public.booking_reservations r on r.id=c.reservation_id
    left join public.hardware_operations o on o.id=c.current_operation_id
  where b.id=p_bay_id and b.integration_mode='ecurious'
$$;

create function public._queue_hardware_operation(p_bay_id uuid,p_kind text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_control public.hardware_controls%rowtype; v_old public.hardware_operations%rowtype; v_id uuid;
begin
  select c.* into v_control from public.hardware_controls c where c.bay_id=p_bay_id for update;
  if v_control.reservation_id is null then raise exception 'NO_HARDWARE_RESERVATION'; end if;
  select o.* into v_old from public.hardware_operations o where o.id=v_control.current_operation_id for update;
  if found and v_old.status in ('dispatching','acknowledged','uncertain') then return v_old.id; end if;
  if v_old.id is not null and v_old.status in ('queued','claimed') then
    if v_old.kind=p_kind then return v_old.id; end if;
    update public.hardware_operations set status='cancelled',claim_token=null,claim_expires_at=null where id=v_old.id;
  end if;
  insert into public.hardware_operations(bay_id,reservation_id,lock_id,kind,target)
  select p_bay_id,v_control.reservation_id,b.ecurious_lock_id,p_kind,
    case when p_kind='protect' then 'raised' else 'lowered' end
  from public.bookable_bays b where b.id=p_bay_id returning id into v_id;
  update public.hardware_controls set current_operation_id=v_id,
    phase=case p_kind when 'protect' then 'protect_pending' when 'entry' then 'entry_pending' else 'release_pending' end,
    updated_at=pg_catalog.clock_timestamp() where bay_id=p_bay_id;
  return v_id;
end;
$$;

create function public.get_hardware_workflow(p_bay_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid(); v_result jsonb;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  v_result:=public._hardware_workflow_json(p_bay_id,v_owner);
  if v_result is null then raise exception 'HARDWARE_BAY_NOT_FOUND'; end if;
  return v_result;
end;
$$;
create function public.list_hardware_workflows()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid(); v_items jsonb;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  select coalesce(pg_catalog.jsonb_agg(public._hardware_workflow_json(c.bay_id,v_owner) order by b.label,b.id),'[]'::jsonb)
    into v_items from public.hardware_controls c join public.bookable_bays b on b.id=c.bay_id where b.integration_mode='ecurious';
  return pg_catalog.jsonb_build_object('serverNow',pg_catalog.clock_timestamp(),'workflows',v_items);
end;
$$;

create function public.request_hardware_reservation(p_bay_id uuid,p_connector_id uuid,p_hold_minutes integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid(); v_bay public.bookable_bays%rowtype; v_control public.hardware_controls%rowtype;
  v_existing public.booking_reservations%rowtype; v_now timestamptz; v_id uuid;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if p_hold_minutes is null or p_hold_minutes not between 1 and 30 then raise exception 'INVALID_HOLD'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
  if p_connector_id is null then raise exception 'CONNECTOR_REQUIRED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bayready:owner:'||v_owner::text,0));
  select r.* into v_existing from public.booking_reservations r where r.owner_id=v_owner and r.idempotency_key=p_request_id;
  if found and (v_existing.bay_id is distinct from p_bay_id or v_existing.connector_id is distinct from p_connector_id
    or v_existing.expires_at-v_existing.starts_at<>pg_catalog.make_interval(mins=>p_hold_minutes)) then
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;
  select b.* into v_bay from public.bookable_bays b where b.id=p_bay_id for update;
  if not found or v_bay.integration_mode<>'ecurious' then raise exception 'HARDWARE_BAY_NOT_FOUND'; end if;
  select c.* into v_control from public.hardware_controls c where c.bay_id=p_bay_id for update;
  if not found then raise exception 'HARDWARE_NOT_ENROLLED'; end if;
  if v_existing.id is not null then return public._hardware_workflow_json(p_bay_id,v_owner); end if;
  if not v_bay.enabled or not v_control.enabled or not v_control.interlocks_confirmed then raise exception 'HARDWARE_DISABLED'; end if;
  if v_control.reservation_id is not null or v_control.phase<>'idle'
    or exists(select 1 from public.booking_reservations r where r.bay_id=p_bay_id and r.status='held') then
    raise exception 'HARDWARE_UNAVAILABLE';
  end if;
  perform 1 from public.bay_connectors c where c.id=p_connector_id and c.bay_id=p_bay_id and c.enabled for share;
  if not found then raise exception 'CONNECTOR_NOT_AVAILABLE'; end if;
  v_now:=pg_catalog.clock_timestamp();
  insert into public.booking_reservations(bay_id,connector_id,owner_id,starts_at,expires_at,created_at,idempotency_key)
    values(p_bay_id,p_connector_id,v_owner,v_now,v_now+pg_catalog.make_interval(mins=>p_hold_minutes),v_now,p_request_id)
    returning id into v_id;
  update public.hardware_controls set reservation_id=v_id,release_requested=false,release_reason=null,
    entry_requested=false,reason=null,updated_at=v_now where bay_id=p_bay_id;
  perform public._queue_hardware_operation(p_bay_id,'protect');
  return public._hardware_workflow_json(p_bay_id,v_owner);
end;
$$;

create function public.request_hardware_entry(p_reservation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid(); v_res public.booking_reservations%rowtype; v_control public.hardware_controls%rowtype;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bayready:owner:'||v_owner::text,0));
  select r.* into v_res from public.booking_reservations r where r.id=p_reservation_id and r.owner_id=v_owner;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  select c.* into v_control from public.hardware_controls c where c.bay_id=v_res.bay_id for update;
  if not found or v_control.reservation_id is distinct from v_res.id then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v_control.entry_requested then return public._hardware_workflow_json(v_res.bay_id,v_owner); end if;
  if not v_control.enabled or not v_control.interlocks_confirmed then raise exception 'HARDWARE_DISABLED'; end if;
  if v_control.phase<>'protected' or v_control.release_requested or v_res.expires_at<=pg_catalog.clock_timestamp() then
    raise exception 'HARDWARE_ENTRY_NOT_READY';
  end if;
  update public.hardware_controls set entry_requested=true,reason=null where bay_id=v_res.bay_id;
  perform public._queue_hardware_operation(v_res.bay_id,'entry');
  return public._hardware_workflow_json(v_res.bay_id,v_owner);
end;
$$;

create function public.request_hardware_release(p_reservation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid(); v_res public.booking_reservations%rowtype; v_control public.hardware_controls%rowtype;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bayready:owner:'||v_owner::text,0));
  select r.* into v_res from public.booking_reservations r where r.id=p_reservation_id and r.owner_id=v_owner;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  select c.* into v_control from public.hardware_controls c where c.bay_id=v_res.bay_id for update;
  if not found then raise exception 'HARDWARE_BAY_NOT_FOUND'; end if;
  if v_res.status<>'held' then return public._hardware_workflow_json(v_res.bay_id,v_owner); end if;
  if v_control.reservation_id is distinct from v_res.id then raise exception 'RESERVATION_NOT_FOUND'; end if;
  update public.hardware_controls set release_requested=true,
    release_reason=coalesce(release_reason,'cancel'),reason='RELEASE_REQUESTED' where bay_id=v_res.bay_id;
  perform public._queue_hardware_operation(v_res.bay_id,'release');
  return public._hardware_workflow_json(v_res.bay_id,v_owner);
end;
$$;

-- Existing rehearsal RPCs must never expire/cancel a physical workflow early.
alter function public.reserve_bay(uuid,integer,uuid,uuid) rename to _reserve_demo_bay;
alter function public.cancel_reservation(uuid) rename to _cancel_demo_reservation;
alter function public.list_bay_availability() rename to _list_demo_bays;
create function public.reserve_bay(p_bay_id uuid,p_hold_minutes integer default 10,p_request_id uuid default null,p_connector_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bayready:owner:'||auth.uid()::text,0));
  perform 1 from public.bookable_bays b where b.id=p_bay_id for update;
  if exists(select 1 from public.bookable_bays b where b.id=p_bay_id and b.integration_mode='ecurious') then
    raise exception 'BAY_NOT_BOOKABLE';
  end if;
  if exists(select 1 from public.hardware_controls c where c.bay_id=p_bay_id and c.reservation_id is not null) then
    raise exception 'HARDWARE_UNAVAILABLE';
  end if;
  return public._reserve_demo_bay(p_bay_id,p_hold_minutes,p_request_id,p_connector_id);
end;
$$;
create function public.cancel_reservation(p_reservation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_bay_id uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bayready:owner:'||auth.uid()::text,0));
  select r.bay_id into v_bay_id from public.booking_reservations r where r.id=p_reservation_id and r.owner_id=auth.uid();
  perform 1 from public.bookable_bays b where b.id=v_bay_id for update;
  if exists(select 1 from public.bookable_bays b where b.id=v_bay_id and b.integration_mode='ecurious')
    or exists(select 1 from public.hardware_controls c where c.reservation_id=p_reservation_id) then
    raise exception 'HARDWARE_WORKFLOW_REQUIRED';
  end if;
  return public._cancel_demo_reservation(p_reservation_id);
end;
$$;
create function public.list_bay_availability()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_snapshot jsonb; v_items jsonb;
begin
  v_snapshot:=public._list_demo_bays();
  select coalesce(pg_catalog.jsonb_agg(x.value),'[]'::jsonb) into v_items
    from pg_catalog.jsonb_array_elements(v_snapshot->'bays') x where x.value->>'mode'<>'ecurious';
  return pg_catalog.jsonb_build_object('serverNow',v_snapshot->'serverNow','bays',v_items);
end;
$$;

-- Worker functions and grants follow below.
create function public.list_hardware_operations()
returns jsonb language sql security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object('serverNow',pg_catalog.clock_timestamp(),'operations',
    coalesce(pg_catalog.jsonb_agg(public._hardware_operation_json(o.id,
      o.status in ('dispatching','acknowledged','uncertain')) order by o.sequence),'[]'::jsonb))
  from public.hardware_operations o join public.hardware_controls c on c.current_operation_id=o.id
  where c.reservation_id=o.reservation_id and o.status<>'cancelled'
$$;

create function public.claim_hardware_operation(p_worker_id uuid,p_operation_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_control public.hardware_controls%rowtype; v_op public.hardware_operations%rowtype; v_now timestamptz;
begin
  if p_worker_id is null then raise exception 'WORKER_ID_REQUIRED'; end if;
  select c.* into v_control from public.hardware_controls c
  join public.hardware_operations o on o.id=c.current_operation_id
  where c.enabled and c.interlocks_confirmed and c.reservation_id=o.reservation_id
    and (p_operation_id is null or o.id=p_operation_id)
    and (o.status='queued' or (o.status='claimed' and o.claim_expires_at<=pg_catalog.clock_timestamp()))
  order by o.sequence for update of c skip locked limit 1;
  if not found then return null; end if;
  select o.* into v_op from public.hardware_operations o where o.id=v_control.current_operation_id for update;
  v_now:=pg_catalog.clock_timestamp();
  if v_op.status<>'queued' and not(v_op.status='claimed' and v_op.claim_expires_at<=v_now) then return null; end if;
  update public.hardware_operations set status='claimed',worker_id=p_worker_id,claim_token=pg_catalog.gen_random_uuid(),
    claim_expires_at=v_now+interval '30 seconds' where id=v_op.id;
  return public._hardware_operation_json(v_op.id);
end;
$$;

create function public.mark_hardware_dispatch(
  p_operation_id uuid,p_claim_token uuid,p_observed_at timestamptz,p_barrier text,
  p_occupancy text,p_faulted boolean,p_access_mode text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_bay_id uuid; v_control public.hardware_controls%rowtype; v_op public.hardware_operations%rowtype; v_now timestamptz;
begin
  select o.bay_id into v_bay_id from public.hardware_operations o where o.id=p_operation_id;
  select c.* into v_control from public.hardware_controls c where c.bay_id=v_bay_id for update;
  select o.* into v_op from public.hardware_operations o where o.id=p_operation_id for update;
  v_now:=pg_catalog.clock_timestamp();
  if v_op.id is null or v_control.current_operation_id is distinct from v_op.id
    or v_control.reservation_id is distinct from v_op.reservation_id or v_op.status<>'claimed'
    or p_claim_token is null or v_op.claim_token is distinct from p_claim_token or v_op.claim_expires_at<=v_now then
    raise exception 'HARDWARE_CLAIM_INVALID';
  end if;
  if not v_control.enabled or not v_control.interlocks_confirmed
    or not exists(select 1 from public.bookable_bays b where b.id=v_bay_id and b.integration_mode='ecurious'
      and b.ecurious_lock_id=v_op.lock_id and b.enabled) then raise exception 'HARDWARE_DISABLED'; end if;
  if p_observed_at is null or p_observed_at>v_now
    or p_observed_at<v_now-pg_catalog.make_interval(secs=>v_control.telemetry_max_age_ms/1000.0)
    or p_barrier is null or p_barrier not in ('raised','lowered') or p_barrier=v_op.target
    or p_occupancy is distinct from 'vacant' or p_faulted is distinct from false
    or (v_control.observed_at is not null and (p_observed_at<v_control.observed_at
      or (p_observed_at=v_control.observed_at and (v_control.observation_conflict
        or (p_barrier,p_occupancy,p_faulted,case when p_access_mode in ('disabled','specific-plates','any-plate') then p_access_mode else 'unknown' end)
          is distinct from (v_control.barrier,v_control.occupancy,v_control.faulted,v_control.access_mode)))))
    or (v_op.kind='protect' and p_access_mode is distinct from 'disabled') then
    raise exception 'HARDWARE_PREFLIGHT_REJECTED';
  end if;
  update public.hardware_operations set status='dispatching',dispatched_at=v_now,claim_expires_at=null where id=v_op.id;
  update public.hardware_controls set phase=case v_op.kind when 'protect' then 'protecting'
    when 'entry' then 'entering' else 'releasing' end,reason='WAITING_FOR_CONFIRMATION',
    observed_at=p_observed_at,observation_conflict=false,barrier=p_barrier,occupancy=p_occupancy,faulted=false,
    access_mode=case when p_access_mode in ('disabled','specific-plates','any-plate') then p_access_mode else 'unknown' end,
    updated_at=v_now where bay_id=v_bay_id;
  return public._hardware_operation_json(v_op.id);
end;
$$;

create function public.record_hardware_result(
  p_operation_id uuid,p_claim_token uuid,p_outcome text,p_observed_at timestamptz default null,
  p_barrier text default 'unknown',p_occupancy text default 'unknown',p_reason text default null,
  p_faulted boolean default true,p_access_mode text default 'unknown'
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_bay_id uuid; v_control public.hardware_controls%rowtype; v_op public.hardware_operations%rowtype;
  v_now timestamptz; v_fresh boolean; v_good boolean; v_monitor boolean; v_reason text; v_outcome text;
begin
  select o.bay_id into v_bay_id from public.hardware_operations o where o.id=p_operation_id;
  select c.* into v_control from public.hardware_controls c where c.bay_id=v_bay_id for update;
  select o.* into v_op from public.hardware_operations o where o.id=p_operation_id for update;
  v_now:=pg_catalog.clock_timestamp();
  v_monitor:=v_op.status='confirmed' and p_claim_token is null;
  if v_op.id is null or v_control.current_operation_id is distinct from v_op.id
    or v_control.reservation_id is distinct from v_op.reservation_id
    or (not v_monitor and (p_claim_token is null or v_op.claim_token is distinct from p_claim_token))
    or v_op.status in ('queued','cancelled')
    or (v_op.status='claimed' and v_op.claim_expires_at<=v_now) then raise exception 'HARDWARE_CLAIM_INVALID'; end if;
  v_outcome:=case p_outcome when 'preflight_blocked' then 'blocked' when 'preflight_unknown' then 'unknown' else p_outcome end;
  if v_outcome is null or v_outcome not in ('blocked','unknown','acknowledged','uncertain','confirmed','failed') then
    raise exception 'HARDWARE_RESULT_INVALID'; end if;
  v_reason:=case when p_reason~'^[A-Z][A-Z0-9_]{0,79}$' then p_reason else 'HARDWARE_STATE_UNRESOLVED' end;
  v_fresh:=coalesce(p_observed_at<=v_now and p_observed_at>=v_now-pg_catalog.make_interval(secs=>v_control.telemetry_max_age_ms/1000.0)
    and p_barrier in ('raised','lowered') and p_occupancy in ('vacant','occupied')
    and (v_control.observed_at is null or p_observed_at>v_control.observed_at
      or (p_observed_at=v_control.observed_at and not v_control.observation_conflict
        and (p_barrier,p_occupancy,coalesce(p_faulted,true),case when p_access_mode in ('disabled','specific-plates','any-plate') then p_access_mode else 'unknown' end)
          is not distinct from (v_control.barrier,v_control.occupancy,v_control.faulted,v_control.access_mode))),false);
  if p_observed_at=v_control.observed_at
    and (p_barrier,p_occupancy,coalesce(p_faulted,true),case when p_access_mode in ('disabled','specific-plates','any-plate') then p_access_mode else 'unknown' end)
      is distinct from (v_control.barrier,v_control.occupancy,v_control.faulted,v_control.access_mode) then
    update public.hardware_controls set observation_conflict=true where bay_id=v_bay_id;
  end if;
  if p_observed_at is not null and p_observed_at<=v_now
    and (v_control.observed_at is null or p_observed_at>v_control.observed_at) then
    update public.hardware_controls set observed_at=p_observed_at,observation_conflict=false,
      barrier=case when p_barrier in ('raised','lowered') then p_barrier else 'unknown' end,
      occupancy=case when p_occupancy in ('vacant','occupied') then p_occupancy else 'unknown' end,
      faulted=coalesce(p_faulted,true),
      access_mode=case when p_access_mode in ('disabled','specific-plates','any-plate') then p_access_mode else 'unknown' end,
      updated_at=v_now where bay_id=v_bay_id;
  end if;

  if v_outcome='acknowledged' then
    if v_op.dispatched_at is null or v_op.status='confirmed' then raise exception 'HARDWARE_RESULT_INVALID'; end if;
    update public.hardware_operations set status='acknowledged',acknowledged_at=coalesce(acknowledged_at,v_now) where id=v_op.id;
    update public.hardware_controls set reason='WAITING_FOR_CONFIRMATION' where bay_id=v_bay_id;
    return public._hardware_operation_json(v_op.id);
  end if;

  v_good:=v_fresh and p_barrier=v_op.target and p_faulted is false
    and (v_op.kind<>'protect' or p_access_mode='disabled')
    and (p_occupancy='vacant' or (v_op.kind='entry' and v_op.dispatched_at is not null and p_occupancy='occupied'))
    and v_control.enabled and v_control.interlocks_confirmed;
  if v_op.dispatched_at is not null then
    v_good:=v_good and p_observed_at>v_op.dispatched_at and v_op.acknowledged_at is not null;
  end if;

  if v_outcome='confirmed' and v_good then
    update public.hardware_operations set status='confirmed',confirmed_at=coalesce(confirmed_at,v_now),
      observed_at=p_observed_at,reason=null where id=v_op.id;
    if v_op.kind='release' then
      update public.booking_reservations set status=case when v_control.release_reason in ('no_show','expired') then 'expired' else 'cancelled' end
        where id=v_op.reservation_id and status='held';
      update public.hardware_controls set reservation_id=null,phase='idle',reason=null,release_requested=false,
        release_reason=null,entry_requested=false,updated_at=v_now where bay_id=v_bay_id;
    else
      update public.hardware_controls set phase=case when v_op.kind='protect' then 'protected' else 'entry_open' end,
        reason=case when p_occupancy='occupied' then 'OCCUPANCY_UNVERIFIED' else null end,updated_at=v_now where bay_id=v_bay_id;
      if v_control.release_requested then perform public._queue_hardware_operation(v_bay_id,'release'); end if;
    end if;
    return public._hardware_operation_json(v_op.id);
  end if;

  if v_monitor then
    -- Observing occupancy after entry is not a plate match or charging evidence.
    update public.hardware_controls set phase=case when v_op.kind='entry' then 'entry_open'
      when v_outcome='blocked' then 'blocked' else 'uncertain' end,reason=v_reason,updated_at=v_now where bay_id=v_bay_id;
    if v_control.release_requested then perform public._queue_hardware_operation(v_bay_id,'release'); end if;
  elsif v_op.dispatched_at is null then
    -- No dispatch permit was issued: safe to obtain a new claim and preflight.
    update public.hardware_operations set status='queued',claim_token=null,claim_expires_at=null,worker_id=null,reason=v_reason where id=v_op.id;
    update public.hardware_controls set phase='blocked',reason=v_reason,updated_at=v_now where bay_id=v_bay_id;
  else
    -- Unknown delivery without acknowledgement requires operator recovery.
    -- Even a matching GET cannot prove a paused old dispatcher cannot send late.
    update public.hardware_operations set status='uncertain',reason=case when acknowledged_at is null then 'COMMAND_DELIVERY_UNRESOLVED' else v_reason end where id=v_op.id;
    update public.hardware_controls set phase='uncertain',reason=case when v_op.acknowledged_at is null then 'COMMAND_DELIVERY_UNRESOLVED' else v_reason end,
      updated_at=v_now where bay_id=v_bay_id;
  end if;
  return public._hardware_operation_json(v_op.id);
end;
$$;

create function public.reconcile_hardware_deadlines()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_control public.hardware_controls%rowtype; v_count integer:=0;
begin
  for v_control in select c.* from public.hardware_controls c join public.booking_reservations r on r.id=c.reservation_id
    where not c.release_requested and r.status='held' and r.expires_at<=pg_catalog.clock_timestamp()
    for update of c skip locked loop
    update public.hardware_controls set release_requested=true,
      release_reason=case when entry_requested then 'expired' else 'no_show' end,
      reason=case when entry_requested then 'HOLD_EXPIRED' else 'NO_SHOW_RELEASE_REQUESTED' end where bay_id=v_control.bay_id;
    perform public._queue_hardware_operation(v_control.bay_id,'release');
    v_count:=v_count+1;
  end loop;
  return pg_catalog.jsonb_build_object('serverNow',pg_catalog.clock_timestamp(),'changed',v_count);
end;
$$;

-- Prevent a late operator remap from changing the target of an active command.
create function public._guard_hardware_mapping()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_control public.hardware_controls%rowtype;
begin
  select c.* into v_control from public.hardware_controls c where c.bay_id=old.id for update;
  if found and (new.integration_mode is distinct from old.integration_mode or new.ecurious_lock_id is distinct from old.ecurious_lock_id)
    and (v_control.reservation_id is not null or v_control.phase<>'idle') then raise exception 'HARDWARE_MAPPING_IN_USE'; end if;
  return new;
end;
$$;
create trigger hardware_mapping_guard before update of integration_mode,ecurious_lock_id on public.bookable_bays
  for each row execute function public._guard_hardware_mapping();

revoke all on function public._hardware_operation_json(uuid,boolean),public._hardware_workflow_json(uuid,uuid),
  public._queue_hardware_operation(uuid,text),public._reserve_demo_bay(uuid,integer,uuid,uuid),
  public._cancel_demo_reservation(uuid),public._list_demo_bays(),public._guard_hardware_mapping()
  from public,anon,authenticated,service_role;
revoke all on function public.get_hardware_workflow(uuid),public.list_hardware_workflows(),
  public.request_hardware_reservation(uuid,uuid,integer,uuid),public.request_hardware_entry(uuid),public.request_hardware_release(uuid),
  public.reserve_bay(uuid,integer,uuid,uuid),public.cancel_reservation(uuid),public.list_bay_availability() from public,anon;
grant execute on function public.get_hardware_workflow(uuid),public.list_hardware_workflows(),
  public.request_hardware_reservation(uuid,uuid,integer,uuid),public.request_hardware_entry(uuid),public.request_hardware_release(uuid),
  public.reserve_bay(uuid,integer,uuid,uuid),public.cancel_reservation(uuid),public.list_bay_availability() to authenticated;
revoke all on function public.list_hardware_operations(),public.claim_hardware_operation(uuid,uuid),
  public.mark_hardware_dispatch(uuid,uuid,timestamptz,text,text,boolean,text),
  public.record_hardware_result(uuid,uuid,text,timestamptz,text,text,text,boolean,text),public.reconcile_hardware_deadlines()
  from public,anon,authenticated;
grant execute on function public.list_hardware_operations(),public.claim_hardware_operation(uuid,uuid),
  public.mark_hardware_dispatch(uuid,uuid,timestamptz,text,text,boolean,text),
  public.record_hardware_result(uuid,uuid,text,timestamptz,text,text,text,boolean,text),public.reconcile_hardware_deadlines() to service_role;

commit;
