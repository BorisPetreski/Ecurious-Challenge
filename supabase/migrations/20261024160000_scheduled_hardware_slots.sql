-- Physical scheduling is separate from directory plug holds. No hardware seed,
-- device requests, raw plate or camera payload is created by this migration.
begin;
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

alter table public.booking_reservations drop constraint reservation_hold_interval;
alter table public.booking_reservations add constraint reservation_hold_interval
  check (expires_at>starts_at and expires_at<=starts_at+interval '120 minutes');
alter table public.hardware_operations alter column reservation_id drop not null;
alter table public.hardware_operations add constraint idle_operations_are_release
  check (reservation_id is not null or kind='release');

create table public.hardware_slot_bookings (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  bay_id uuid not null references public.bookable_bays(id) on delete restrict,
  connector_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in
    ('scheduled','active','blocked','cancel_requested','cancelled','completed','expired')),
  source text not null default 'scheduled' check (source in ('scheduled','immediate')),
  idempotency_key uuid not null,
  activation_request_id uuid not null default pg_catalog.gen_random_uuid(),
  plate_hash text check (plate_hash ~ '^[0-9a-f]{64}$'),
  masked_plate text check (masked_plate ~ '^•••[A-Z0-9]{2}$'),
  hardware_reservation_id uuid unique references public.booking_reservations(id) on delete restrict,
  activated_at timestamptz,
  entry_authorized_at timestamptz,
  arrived_at timestamptz,
  departed_at timestamptz,
  last_plate_event_at timestamptz,
  last_plate_event_key text check (last_plate_event_key ~ '^[0-9a-f]{64}$'),
  billing_waived boolean not null default false,
  billing_stopped_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key(connector_id,bay_id) references public.bay_connectors(id,bay_id) on delete restrict,
  unique(owner_id,idempotency_key),
  check (ends_at>starts_at and ends_at<=starts_at+interval '120 minutes'),
  check (source='immediate' or (ends_at>=starts_at+interval '5 minutes' and plate_hash is not null and masked_plate is not null)),
  constraint hardware_slot_no_overlap exclude using gist (
    bay_id with =,
    pg_catalog.tstzrange(starts_at,ends_at,'[)') with &&
  ) where (status in ('scheduled','active','blocked','cancel_requested'))
);
create index hardware_slot_owner_time on public.hardware_slot_bookings(owner_id,starts_at desc);
create index hardware_slot_due on public.hardware_slot_bookings(starts_at) where status in ('scheduled','blocked');
alter table public.hardware_slot_bookings enable row level security;
revoke all on public.hardware_slot_bookings from public,anon,authenticated;
comment on table public.hardware_slot_bookings is
  'Whole-bay half-open schedule; one selected connector per car. HMAC and masked suffix only. An unverified customer plate claim is not evidence of ownership or arrival. Physical quarantine survives the scheduled end.';

-- Preserve allocations admitted before this migration as unscheduled manual
-- prototype sessions. No invented plate identity or new device command.
insert into public.hardware_slot_bookings(bay_id,connector_id,owner_id,starts_at,ends_at,source,idempotency_key,
  hardware_reservation_id,activated_at,status)
select r.bay_id,r.connector_id,r.owner_id,r.starts_at,r.expires_at,'immediate',r.idempotency_key,r.id,r.starts_at,'active'
from public.hardware_controls c join public.booking_reservations r on r.id=c.reservation_id where r.status='held';

-- Reuse all dispatch fencing and acknowledgement guards for idle lowering.
-- These two existing functions compared reservation IDs with SQL =; NULL-safe
-- equality is necessary for an idle release that has no customer allocation.
do $$
declare v_name text; v_definition text;
begin
  foreach v_name in array array['public.list_hardware_operations()','public.claim_hardware_operation(uuid,uuid)'] loop
    v_definition:=pg_catalog.pg_get_functiondef(v_name::regprocedure);
    if pg_catalog.strpos(v_definition,'c.reservation_id=o.reservation_id')=0 then
      raise exception 'HARDWARE_NULL_GUARD_UPGRADE_REQUIRED';
    end if;
    execute pg_catalog.replace(v_definition,'c.reservation_id=o.reservation_id','c.reservation_id is not distinct from o.reservation_id');
  end loop;
end;
$$;

create function public._queue_idle_hardware_release(p_bay_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.hardware_controls%rowtype; o public.hardware_operations%rowtype; v_id uuid;
begin
  select x.* into c from public.hardware_controls x where x.bay_id=p_bay_id for update;
  if not found or c.reservation_id is not null then raise exception 'HARDWARE_NOT_IDLE'; end if;
  select x.* into o from public.hardware_operations x where x.id=c.current_operation_id for update;
  if o.id is not null and o.status in ('queued','claimed','dispatching','acknowledged','uncertain') then return o.id; end if;
  insert into public.hardware_operations(bay_id,reservation_id,lock_id,kind,target)
    select p_bay_id,null,b.ecurious_lock_id,'release','lowered' from public.bookable_bays b
      where b.id=p_bay_id and b.integration_mode='ecurious' returning id into v_id;
  if v_id is null then raise exception 'HARDWARE_BAY_NOT_FOUND'; end if;
  update public.hardware_controls set current_operation_id=v_id,phase='release_pending',reason='IDLE_LOWER_REQUESTED',
    updated_at=pg_catalog.clock_timestamp() where bay_id=p_bay_id;
  return v_id;
end;
$$;

create function public._finish_hardware_slots(p_bay_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  -- Only a final underlying allocation, after confirmed physical cleanup, can
  -- finish an activated window. Time alone never clears a physical guard.
  update public.hardware_slot_bookings s set status=case
      when s.departed_at is not null then 'completed'
      when s.status='cancel_requested' then 'cancelled' else 'expired' end,
    billing_stopped_at=coalesce(s.billing_stopped_at,s.arrived_at,least(s.ends_at,pg_catalog.clock_timestamp())),
    updated_at=pg_catalog.clock_timestamp()
  from public.booking_reservations r,public.hardware_controls c
  where s.bay_id=p_bay_id and s.hardware_reservation_id=r.id and c.bay_id=s.bay_id
    and s.status in ('active','blocked','cancel_requested') and r.status<>'held'
    and c.reservation_id is distinct from r.id;
  get diagnostics v_count=row_count;
  update public.hardware_slot_bookings set status='expired',updated_at=pg_catalog.clock_timestamp()
    where bay_id=p_bay_id and hardware_reservation_id is null and ends_at<=pg_catalog.clock_timestamp()
      and status in ('scheduled','blocked');
  return v_count;
end;
$$;

create function public._hardware_slot_json(p_id uuid,p_owner uuid)
returns jsonb language sql security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'id',case when s.owner_id=p_owner then s.id else null end,
    'bayId',s.bay_id,'connectorId',s.connector_id,'startsAt',s.starts_at,'endsAt',s.ends_at,
    'status',s.status,'isMine',s.owner_id=p_owner,
    'maskedPlate',case when s.owner_id=p_owner then s.masked_plate else null end,
    'hardwareReservationId',case when s.owner_id=p_owner then s.hardware_reservation_id else null end,
    'activatedAt',case when s.owner_id=p_owner then s.activated_at else null end,
    'protectionConfirmedAt',case when s.owner_id=p_owner then (select min(o.confirmed_at) from public.hardware_operations o
      where o.reservation_id=s.hardware_reservation_id and o.kind='protect' and o.status='confirmed') else null end,
    'entryAuthorizedAt',case when s.owner_id=p_owner then s.entry_authorized_at else null end,
    'arrivedAt',case when s.owner_id=p_owner then s.arrived_at else null end,
    'departedAt',case when s.owner_id=p_owner then s.departed_at else null end,
    'billingStoppedAt',case when s.owner_id=p_owner then s.billing_stopped_at else null end,
    'billingWaived',case when s.owner_id=p_owner then s.billing_waived else null end,
    'canCancel',s.owner_id=p_owner and s.status in ('scheduled','active','blocked')
  ) from public.hardware_slot_bookings s where s.id=p_id
$$;

create function public.list_hardware_slots(p_bay_id uuid default null,p_from timestamptz default null,p_until timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid(); v_now timestamptz:=pg_catalog.clock_timestamp(); v_from timestamptz; v_until timestamptz; v_items jsonb;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  v_from:=coalesce(p_from,v_now-interval '1 day'); v_until:=coalesce(p_until,v_now+interval '7 days');
  if not pg_catalog.isfinite(v_from) or not pg_catalog.isfinite(v_until) or v_until<=v_from
    or v_until-v_from>interval '8 days 1 minute' then raise exception 'INVALID_WINDOW'; end if;
  if p_bay_id is not null and not exists(select 1 from public.hardware_controls c where c.bay_id=p_bay_id) then
    raise exception 'HARDWARE_BAY_NOT_FOUND'; end if;
  select coalesce(pg_catalog.jsonb_agg(public._hardware_slot_json(x.id,v_owner) order by x.starts_at,x.id),'[]'::jsonb)
    into v_items from (select s.* from public.hardware_slot_bookings s
      where (p_bay_id is null and s.owner_id=v_owner or s.bay_id=p_bay_id)
        and (s.starts_at<v_until and s.ends_at>v_from
          or s.owner_id=v_owner and s.status in ('active','blocked','cancel_requested'))
        and (s.owner_id=v_owner or s.status in ('scheduled','active','blocked','cancel_requested'))
      order by s.starts_at,s.id limit 1000) x;
  return pg_catalog.jsonb_build_object('serverNow',v_now,'slots',v_items);
end;
$$;
create function public.list_my_hardware_slots()
returns jsonb language sql security definer set search_path='' as $$ select public.list_hardware_slots(null,null,null) $$;
create function public.get_hardware_slot(p_slot_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid(); v_slot jsonb;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  select public._hardware_slot_json(s.id,v_owner) into v_slot from public.hardware_slot_bookings s
    where s.id=p_slot_id and s.owner_id=v_owner;
  if v_slot is null then raise exception 'SLOT_NOT_FOUND'; end if;
  return pg_catalog.jsonb_build_object('serverNow',pg_catalog.clock_timestamp(),'slot',v_slot);
end;
$$;

create function public.request_hardware_slot(p_bay_id uuid,p_connector_id uuid,p_starts_at timestamptz,
  p_ends_at timestamptz,p_request_id uuid,p_plate_hash text,p_masked_plate text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid(); v_now timestamptz; s public.hardware_slot_bookings%rowtype;
  b public.bookable_bays%rowtype; c public.hardware_controls%rowtype; v_id uuid;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
  if p_connector_id is null then raise exception 'CONNECTOR_REQUIRED'; end if;
  if p_plate_hash is null or p_plate_hash!~'^[0-9a-f]{64}$' or p_masked_plate is null
    or p_masked_plate!~'^•••[A-Z0-9]{2}$' then raise exception 'INVALID_PLATE'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bayready:owner:'||v_owner::text,0));
  select x.* into s from public.hardware_slot_bookings x where x.owner_id=v_owner and x.idempotency_key=p_request_id;
  if found then
    if (s.bay_id,s.connector_id,s.starts_at,s.ends_at,s.plate_hash,s.masked_plate,s.source)
      is distinct from (p_bay_id,p_connector_id,p_starts_at,p_ends_at,p_plate_hash,p_masked_plate,'scheduled'::text) then
      raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return public.get_hardware_slot(s.id);
  end if;
  v_now:=pg_catalog.clock_timestamp();
  if p_starts_at is null or p_ends_at is null or not pg_catalog.isfinite(p_starts_at) or not pg_catalog.isfinite(p_ends_at)
    or p_starts_at<v_now-interval '60 seconds' or p_starts_at>v_now+interval '7 days'
    or p_ends_at<=v_now or p_ends_at<p_starts_at+interval '5 minutes'
    or p_ends_at>p_starts_at+interval '120 minutes' then raise exception 'INVALID_WINDOW'; end if;
  select x.* into b from public.bookable_bays x where x.id=p_bay_id for update;
  if not found or b.integration_mode<>'ecurious' then raise exception 'HARDWARE_BAY_NOT_FOUND'; end if;
  select x.* into c from public.hardware_controls x where x.bay_id=p_bay_id for update;
  if not found then raise exception 'HARDWARE_NOT_ENROLLED'; end if;
  if not b.enabled or not c.enabled or not c.interlocks_confirmed then raise exception 'HARDWARE_DISABLED'; end if;
  perform 1 from public.bay_connectors x where x.id=p_connector_id and x.bay_id=p_bay_id and x.enabled for share;
  if not found then raise exception 'CONNECTOR_NOT_AVAILABLE'; end if;
  perform public._finish_hardware_slots(p_bay_id);
  begin
    insert into public.hardware_slot_bookings(bay_id,connector_id,owner_id,starts_at,ends_at,idempotency_key,plate_hash,masked_plate)
      values(p_bay_id,p_connector_id,v_owner,p_starts_at,p_ends_at,p_request_id,p_plate_hash,p_masked_plate) returning id into v_id;
  exception when exclusion_violation then raise exception 'SLOT_RESERVED'; end;
  return public.get_hardware_slot(v_id);
end;
$$;

create function public.cancel_hardware_slot(p_slot_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid(); s public.hardware_slot_bookings%rowtype;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bayready:owner:'||v_owner::text,0));
  select x.* into s from public.hardware_slot_bookings x where x.id=p_slot_id and x.owner_id=v_owner;
  if not found then raise exception 'SLOT_NOT_FOUND'; end if;
  perform 1 from public.bookable_bays b where b.id=s.bay_id for update;
  perform 1 from public.hardware_controls c where c.bay_id=s.bay_id for update;
  select x.* into s from public.hardware_slot_bookings x where x.id=s.id for update;
  if s.status in ('scheduled','active','blocked') then
    if s.hardware_reservation_id is null then
      update public.hardware_slot_bookings set status='cancelled',billing_stopped_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp() where id=s.id;
    else
      update public.hardware_slot_bookings set status='cancel_requested',billing_waived=true,billing_stopped_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp() where id=s.id;
      perform public.request_hardware_release(s.hardware_reservation_id);
      perform public._finish_hardware_slots(s.bay_id);
    end if;
  end if;
  return public.get_hardware_slot(s.id);
end;
$$;

-- Keep the older immediate/manual prototype compatible while preventing it
-- from bypassing the schedule exclusion constraint or scheduled plate checks.
alter function public.request_hardware_reservation(uuid,uuid,integer,uuid) rename to _request_immediate_hardware_reservation;
create function public.request_hardware_reservation(p_bay_id uuid,p_connector_id uuid,p_hold_minutes integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid(); v_result jsonb; r public.booking_reservations%rowtype; s public.hardware_slot_bookings%rowtype;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bayready:owner:'||v_owner::text,0));
  select x.* into s from public.hardware_slot_bookings x where x.owner_id=v_owner and x.idempotency_key=p_request_id;
  if found and s.source<>'immediate' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  perform 1 from public.bookable_bays b where b.id=p_bay_id for update;
  perform public._finish_hardware_slots(p_bay_id);
  v_result:=public._request_immediate_hardware_reservation(p_bay_id,p_connector_id,p_hold_minutes,p_request_id);
  select x.* into r from public.booking_reservations x where x.owner_id=v_owner and x.idempotency_key=p_request_id;
  if not exists(select 1 from public.hardware_slot_bookings x where x.hardware_reservation_id=r.id) then
    begin
      insert into public.hardware_slot_bookings(bay_id,connector_id,owner_id,starts_at,ends_at,source,idempotency_key,
        hardware_reservation_id,activated_at,status)
      values(r.bay_id,r.connector_id,r.owner_id,r.starts_at,r.expires_at,'immediate',r.idempotency_key,r.id,r.starts_at,
        case when r.status='held' then 'active' else 'expired' end);
    exception when exclusion_violation then raise exception 'SLOT_RESERVED'; end;
  end if;
  return v_result;
end;
$$;
alter function public.request_hardware_entry(uuid) rename to _request_manual_hardware_entry;
create function public.request_hardware_entry(p_reservation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if exists(select 1 from public.hardware_slot_bookings s where s.hardware_reservation_id=p_reservation_id
    and s.owner_id=auth.uid() and s.source='scheduled') then raise exception 'PLATE_AUTH_REQUIRED'; end if;
  return public._request_manual_hardware_entry(p_reservation_id);
end;
$$;

create function public.list_hardware_slot_work(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_slots jsonb; v_controls jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'INVALID_LIMIT'; end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',s.id,'bayId',s.bay_id,'lockId',b.ecurious_lock_id,'plateHash',s.plate_hash,
    'startsAt',s.starts_at,'endsAt',s.ends_at,'status',s.status,'hardwareReservationId',s.hardware_reservation_id,
    'activatedAt',s.activated_at,'protectionConfirmedAt',(select min(o.confirmed_at) from public.hardware_operations o
      where o.reservation_id=s.hardware_reservation_id and o.kind='protect' and o.status='confirmed'),
    'entryAuthorizedAt',s.entry_authorized_at,'arrivedAt',s.arrived_at,'departedAt',s.departed_at)),'[]'::jsonb)
    into v_slots from (select x.* from public.hardware_slot_bookings x where x.status in ('active','blocked','cancel_requested')
      and x.hardware_reservation_id is not null order by x.starts_at limit p_limit) s join public.bookable_bays b on b.id=s.bay_id;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('bayId',x.bay_id,'lockId',x.ecurious_lock_id,
    'phase',x.phase,'controlsEnabled',x.enabled,'interlocksConfirmed',x.interlocks_confirmed,
    'telemetryMaxAgeMs',x.telemetry_max_age_ms)),'[]'::jsonb) into v_controls
    from (select c.*,b.ecurious_lock_id from public.hardware_controls c join public.bookable_bays b on b.id=c.bay_id
      where b.integration_mode='ecurious' and b.enabled and c.enabled and c.interlocks_confirmed order by c.bay_id limit p_limit) x;
  return pg_catalog.jsonb_build_object('serverNow',pg_catalog.clock_timestamp(),'slots',v_slots,'controls',v_controls);
end;
$$;

create function public.record_hardware_bay_observation(p_bay_id uuid,p_observed_at timestamptz,p_barrier text,
  p_occupancy text,p_faulted boolean,p_access_mode text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.hardware_controls%rowtype; o public.hardware_operations%rowtype; s public.hardware_slot_bookings%rowtype;
  v_now timestamptz:=pg_catalog.clock_timestamp(); v_fresh boolean; v_access text;
begin
  perform 1 from public.bookable_bays b where b.id=p_bay_id for update;
  select x.* into c from public.hardware_controls x where x.bay_id=p_bay_id for update;
  if not found then raise exception 'HARDWARE_BAY_NOT_FOUND'; end if;
  v_access:=case when p_access_mode in ('disabled','specific-plates','any-plate') then p_access_mode else 'unknown' end;
  if p_observed_at=c.observed_at and (p_barrier,p_occupancy,coalesce(p_faulted,true),v_access)
      is distinct from (c.barrier,c.occupancy,c.faulted,c.access_mode) then
    update public.hardware_controls set observation_conflict=true,phase='blocked',reason='CONTRADICTORY_OBSERVATION' where bay_id=p_bay_id;
    update public.hardware_slot_bookings set billing_waived=true where hardware_reservation_id=c.reservation_id
      and status in ('active','blocked','cancel_requested');
    return public._hardware_workflow_json(p_bay_id,null);
  end if;
  v_fresh:=coalesce(p_observed_at<=v_now and p_observed_at>=v_now-pg_catalog.make_interval(secs=>c.telemetry_max_age_ms/1000.0)
    and (c.observed_at is null or p_observed_at>c.observed_at or p_observed_at=c.observed_at and not c.observation_conflict)
    and p_barrier in ('raised','lowered') and p_occupancy in ('vacant','occupied'),false);
  if p_observed_at is not null and p_observed_at<=v_now and (c.observed_at is null or p_observed_at>c.observed_at) then
    update public.hardware_controls set observed_at=p_observed_at,observation_conflict=false,
      barrier=case when p_barrier in ('raised','lowered') then p_barrier else 'unknown' end,
      occupancy=case when p_occupancy in ('vacant','occupied') then p_occupancy else 'unknown' end,
      faulted=coalesce(p_faulted,true),access_mode=v_access,updated_at=v_now where bay_id=p_bay_id;
  end if;
  select x.* into o from public.hardware_operations x where x.id=c.current_operation_id;
  select x.* into s from public.hardware_slot_bookings x where x.hardware_reservation_id=c.reservation_id
    and x.status in ('active','blocked','cancel_requested') for update;
  if s.id is not null and (not v_fresh or c.phase in ('blocked','uncertain')
    or o.status='uncertain' or p_faulted is distinct from false
    or o.kind='protect' and (p_barrier<>'raised' or v_access<>'disabled')) then
    update public.hardware_slot_bookings set billing_waived=true where id=s.id;
  end if;
  if not v_fresh then return public._hardware_workflow_json(p_bay_id,null); end if;
  if p_faulted is distinct from false or p_occupancy='occupied' then
    if s.id is not null and (p_faulted is distinct from false or p_occupancy='occupied' and s.entry_authorized_at is null) then
      update public.hardware_slot_bookings set billing_waived=true where id=s.id;
    end if;
    if c.reservation_id is null then
      update public.hardware_controls set phase='blocked',reason=case when p_faulted is distinct from false
        then 'HARDWARE_FAULT' else 'BAY_OCCUPIED' end where bay_id=p_bay_id;
    end if;
  end if;
  if s.id is not null and s.entry_authorized_at is not null and s.arrived_at is null
    and p_observed_at>s.entry_authorized_at and p_occupancy='occupied' and p_barrier='lowered' and p_faulted is false
    and c.phase='entry_open' then
    update public.hardware_slot_bookings set arrived_at=p_observed_at,billing_stopped_at=coalesce(billing_stopped_at,p_observed_at),updated_at=v_now where id=s.id;
  elsif s.id is not null and s.arrived_at is not null and s.departed_at is null and p_observed_at>s.arrived_at
    and p_occupancy='vacant' and p_barrier='lowered' and p_faulted is false then
    update public.hardware_slot_bookings set departed_at=p_observed_at,updated_at=v_now where id=s.id;
    update public.hardware_controls set release_requested=true,release_reason='expired',reason='DEPARTURE_CLEANUP_REQUESTED' where bay_id=p_bay_id;
    perform public._queue_hardware_operation(p_bay_id,'release');
  end if;
  if c.reservation_id is null and p_occupancy='vacant' and p_faulted is false
    and (o.id is null or o.status in ('confirmed','cancelled')) then
    if p_barrier='lowered' then
      update public.hardware_controls set phase='idle',reason=null,updated_at=v_now where bay_id=p_bay_id;
    elsif c.enabled and c.interlocks_confirmed then perform public._queue_idle_hardware_release(p_bay_id); end if;
  end if;
  return public._hardware_workflow_json(p_bay_id,null);
end;
$$;

create function public.authorize_hardware_plate_entry(p_slot_id uuid,p_plate_hash text,p_recognized_at timestamptz,p_event_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.hardware_slot_bookings%rowtype; c public.hardware_controls%rowtype; v_now timestamptz; v_protected_at timestamptz;
begin
  select x.* into s from public.hardware_slot_bookings x where x.id=p_slot_id;
  if not found then raise exception 'SLOT_NOT_FOUND'; end if;
  perform 1 from public.bookable_bays b where b.id=s.bay_id for update;
  select x.* into c from public.hardware_controls x where x.bay_id=s.bay_id for update;
  select x.* into s from public.hardware_slot_bookings x where x.id=p_slot_id for update;
  v_now:=pg_catalog.clock_timestamp();
  if p_plate_hash is null or p_plate_hash!~'^[0-9a-f]{64}$' or s.plate_hash is distinct from p_plate_hash
    or p_event_key is null or p_event_key!~'^[0-9a-f]{64}$' then raise exception 'PLATE_NOT_AUTHORIZED'; end if;
  if s.last_plate_event_key=p_event_key and s.entry_authorized_at is not null then return public._hardware_workflow_json(s.bay_id,s.owner_id); end if;
  if s.status<>'active' or c.reservation_id is distinct from s.hardware_reservation_id
    or c.release_requested or v_now<s.starts_at or v_now>=s.ends_at then raise exception 'HARDWARE_ENTRY_NOT_READY'; end if;
  if s.entry_authorized_at is not null then return public._hardware_workflow_json(s.bay_id,s.owner_id); end if;
  select min(o.confirmed_at) into v_protected_at from public.hardware_operations o
    where o.reservation_id=s.hardware_reservation_id and o.kind='protect' and o.status='confirmed';
  if p_recognized_at is null or p_recognized_at>v_now or p_recognized_at<v_now-interval '15 seconds'
    or v_protected_at is null or p_recognized_at<=v_protected_at
    or s.last_plate_event_at is not null and p_recognized_at<=s.last_plate_event_at
    or c.phase<>'protected' or not c.enabled or not c.interlocks_confirmed
    or c.observed_at is null or c.observed_at>v_now
    or c.observed_at<v_now-pg_catalog.make_interval(secs=>c.telemetry_max_age_ms/1000.0)
    or c.observation_conflict or c.barrier<>'raised' or c.occupancy<>'vacant' or c.faulted or c.access_mode<>'disabled'
    then raise exception 'HARDWARE_ENTRY_NOT_READY'; end if;
  update public.hardware_slot_bookings set entry_authorized_at=p_recognized_at,last_plate_event_at=p_recognized_at,
    last_plate_event_key=p_event_key,billing_stopped_at=coalesce(billing_stopped_at,p_recognized_at),updated_at=v_now where id=s.id;
  update public.hardware_controls set entry_requested=true,reason=null,updated_at=v_now where bay_id=s.bay_id;
  perform public._queue_hardware_operation(s.bay_id,'entry');
  return public._hardware_workflow_json(s.bay_id,s.owner_id);
end;
$$;

create function public.reconcile_hardware_slots()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_bay uuid; s public.hardware_slot_bookings%rowtype; c public.hardware_controls%rowtype;
  v_now timestamptz; v_res uuid; v_protected_at timestamptz; v_stop timestamptz;
  v_activated integer:=0; v_completed integer:=0; v_blocked integer:=0; v_expired integer:=0;
begin
  for v_bay in select distinct x.bay_id from public.hardware_slot_bookings x
    where x.status in ('scheduled','active','blocked','cancel_requested') order by x.bay_id loop
    perform 1 from public.bookable_bays b where b.id=v_bay for update skip locked;
    if not found then continue; end if;
    select x.* into c from public.hardware_controls x where x.bay_id=v_bay for update;
    v_completed:=v_completed+public._finish_hardware_slots(v_bay);
    v_now:=pg_catalog.clock_timestamp();
    -- Product assumption: an unused physical hold gets a 15-minute grace
    -- period after actual protection, bounded by the customer's window.
    for s in select x.* from public.hardware_slot_bookings x where x.bay_id=v_bay
      and x.hardware_reservation_id=c.reservation_id and x.status in ('active','blocked','cancel_requested') for update loop
      select min(o.confirmed_at) into v_protected_at from public.hardware_operations o
        where o.reservation_id=s.hardware_reservation_id and o.kind='protect' and o.status='confirmed';
      v_stop:=case when s.arrived_at is null and v_protected_at is not null
        then least(s.ends_at,v_protected_at+interval '15 minutes') else s.ends_at end;
      if v_now>=v_stop and not c.release_requested then
        update public.hardware_slot_bookings set billing_stopped_at=coalesce(billing_stopped_at,v_stop),updated_at=v_now where id=s.id;
        update public.hardware_controls set release_requested=true,
          release_reason=case when s.arrived_at is null then 'no_show' else 'expired' end,
          reason=case when s.arrived_at is null then 'NO_SHOW_RELEASE_REQUESTED' else 'SLOT_ENDED' end where bay_id=v_bay;
        perform public._queue_hardware_operation(v_bay,'release');
      end if;
    end loop;
    select x.* into c from public.hardware_controls x where x.bay_id=v_bay;
    for s in select x.* from public.hardware_slot_bookings x where x.bay_id=v_bay
      and x.hardware_reservation_id is null and x.status in ('scheduled','blocked')
      and x.starts_at<=v_now and x.ends_at>v_now order by x.starts_at for update loop
      if not c.enabled or not c.interlocks_confirmed or c.reservation_id is not null or c.phase<>'idle'
        or c.observation_conflict or c.observed_at is null or c.observed_at>v_now
        or c.observed_at<v_now-pg_catalog.make_interval(secs=>c.telemetry_max_age_ms/1000.0)
        or c.barrier<>'lowered' or c.occupancy<>'vacant' or c.faulted or c.access_mode<>'disabled'
        or not exists(select 1 from public.bookable_bays b where b.id=v_bay and b.enabled and b.integration_mode='ecurious')
        or not exists(select 1 from public.bay_connectors x where x.id=s.connector_id and x.bay_id=v_bay and x.enabled)
        or exists(select 1 from public.booking_reservations r where r.bay_id=v_bay and r.status='held') then
        update public.hardware_slot_bookings set status='blocked',billing_waived=true,updated_at=v_now where id=s.id;
        v_blocked:=v_blocked+1; continue;
      end if;
      insert into public.booking_reservations(bay_id,connector_id,owner_id,starts_at,expires_at,idempotency_key,created_at)
        values(v_bay,s.connector_id,s.owner_id,v_now,s.ends_at,s.activation_request_id,v_now) returning id into v_res;
      update public.hardware_controls set reservation_id=v_res,release_requested=false,release_reason=null,
        entry_requested=false,reason=null,updated_at=v_now where bay_id=v_bay;
      update public.hardware_slot_bookings set hardware_reservation_id=v_res,activated_at=v_now,status='active',updated_at=v_now where id=s.id;
      perform public._queue_hardware_operation(v_bay,'protect');
      v_activated:=v_activated+1;
      select x.* into c from public.hardware_controls x where x.bay_id=v_bay;
    end loop;
  end loop;
  perform public.reconcile_hardware_deadlines();
  return pg_catalog.jsonb_build_object('serverNow',pg_catalog.clock_timestamp(),'activated',v_activated,
    'completed',v_completed,'blocked',v_blocked,'expired',v_expired,'idleQueued',0);
end;
$$;

create or replace function public._guard_hardware_mapping()
returns trigger language plpgsql security definer set search_path='' as $$
declare c public.hardware_controls%rowtype;
begin
  select x.* into c from public.hardware_controls x where x.bay_id=old.id for update;
  if (new.integration_mode is distinct from old.integration_mode or new.ecurious_lock_id is distinct from old.ecurious_lock_id)
    and (c.reservation_id is not null or c.phase<>'idle' or exists(select 1 from public.hardware_slot_bookings s
      where s.bay_id=old.id and s.status in ('scheduled','active','blocked','cancel_requested'))) then
    raise exception 'HARDWARE_MAPPING_IN_USE';
  end if;
  return new;
end;
$$;

revoke all on function public._queue_idle_hardware_release(uuid),public._finish_hardware_slots(uuid),
  public._hardware_slot_json(uuid,uuid),public._request_immediate_hardware_reservation(uuid,uuid,integer,uuid),
  public._request_manual_hardware_entry(uuid) from public,anon,authenticated,service_role;
revoke all on function public.list_hardware_slots(uuid,timestamptz,timestamptz),public.list_my_hardware_slots(),public.get_hardware_slot(uuid),
  public.request_hardware_slot(uuid,uuid,timestamptz,timestamptz,uuid,text,text),public.cancel_hardware_slot(uuid),
  public.request_hardware_reservation(uuid,uuid,integer,uuid),public.request_hardware_entry(uuid) from public,anon;
grant execute on function public.list_hardware_slots(uuid,timestamptz,timestamptz),public.list_my_hardware_slots(),public.get_hardware_slot(uuid),
  public.request_hardware_slot(uuid,uuid,timestamptz,timestamptz,uuid,text,text),public.cancel_hardware_slot(uuid),
  public.request_hardware_reservation(uuid,uuid,integer,uuid),public.request_hardware_entry(uuid) to authenticated;
revoke all on function public.list_hardware_slot_work(integer),public.record_hardware_bay_observation(uuid,timestamptz,text,text,boolean,text),
  public.authorize_hardware_plate_entry(uuid,text,timestamptz,text),public.reconcile_hardware_slots() from public,anon,authenticated;
grant execute on function public.list_hardware_slot_work(integer),public.record_hardware_bay_observation(uuid,timestamptz,text,text,boolean,text),
  public.authorize_hardware_plate_entry(uuid,text,timestamptz,text),public.reconcile_hardware_slots() to service_role;
commit;
