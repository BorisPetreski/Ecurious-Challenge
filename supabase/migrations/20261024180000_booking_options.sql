-- Fixed mock booking options. No real payment, enrollment or device request.
begin;
alter table public.booking_reservations drop constraint reservation_hold_interval;
alter table public.booking_reservations add constraint reservation_hold_interval
  check(expires_at>starts_at and expires_at<=starts_at+interval '130 minutes');
alter table public.hardware_slot_bookings
  add column booking_mode text not null default 'scheduled' check(booking_mode in ('now','scheduled')),
  add column protection_starts_at timestamptz,
  add column requested_bay_id uuid references public.bookable_bays(id) on delete restrict,
  add column requested_connector_id uuid references public.bay_connectors(id) on delete restrict,
  add column requested_starts_at timestamptz,
  add column requested_ends_at timestamptz,
  add column reservation_fee_cents integer not null default 100 check(reservation_fee_cents between 0 and 1200),
  add column payment_status text not null default 'mock_paid' check(payment_status in ('free','mock_paid','mock_refunded')),
  add column extension_count integer not null default 0 check(extension_count between 0 and 11),
  add column failure_reason text check(failure_reason in ('LOCATION_FULL'));
-- Grandfather existing physical intervals: do not retroactively expand or
-- cancel an already admitted allocation. New scheduled bookings reserve lead-in.
update public.hardware_slot_bookings set protection_starts_at=starts_at,requested_bay_id=bay_id,
  requested_connector_id=connector_id,requested_starts_at=starts_at,requested_ends_at=ends_at,
  booking_mode=case when source='immediate' then 'now' else 'scheduled' end,
  reservation_fee_cents=case when source='immediate' then 0 else 100 end,
  payment_status=case when source='immediate' then 'free' when billing_waived then 'mock_refunded' else 'mock_paid' end;
alter table public.hardware_slot_bookings alter column protection_starts_at set not null,
  alter column requested_bay_id set not null,alter column requested_connector_id set not null,
  alter column requested_starts_at set not null,alter column requested_ends_at set not null,
  add constraint protection_before_arrival check(protection_starts_at<=starts_at and protection_starts_at>=starts_at-interval '10 minutes'),
  add constraint requested_connector_matches_bay foreign key(requested_connector_id,requested_bay_id)
    references public.bay_connectors(id,bay_id) on delete restrict;
alter table public.hardware_slot_bookings drop constraint hardware_slot_no_overlap;
alter table public.hardware_slot_bookings add constraint hardware_slot_no_overlap exclude using gist
  (bay_id with =,pg_catalog.tstzrange(protection_starts_at,ends_at,'[)') with &&)
  where(status in ('scheduled','active','blocked','cancel_requested'));

create table public.hardware_slot_extensions (
  owner_id uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  slot_id uuid not null references public.hardware_slot_bookings(id) on delete restrict,
  ends_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(owner_id,request_id)
);
alter table public.hardware_slot_extensions enable row level security;
revoke all on public.hardware_slot_extensions from public,anon,authenticated;

create function public._hardware_slot_option_defaults()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  new.protection_starts_at:=coalesce(new.protection_starts_at,new.starts_at);
  new.requested_bay_id:=coalesce(new.requested_bay_id,new.bay_id);
  new.requested_connector_id:=coalesce(new.requested_connector_id,new.connector_id);
  new.requested_starts_at:=coalesce(new.requested_starts_at,new.starts_at);
  new.requested_ends_at:=coalesce(new.requested_ends_at,new.ends_at);
  if new.source='immediate' then
    new.booking_mode:='now'; new.reservation_fee_cents:=0; new.payment_status:='free';
  end if;
  return new;
end;
$$;
create trigger hardware_slot_option_defaults before insert on public.hardware_slot_bookings
  for each row execute function public._hardware_slot_option_defaults();

alter function public._hardware_slot_json(uuid,uuid) rename to _hardware_slot_legacy_json;
create function public._hardware_slot_json(p_id uuid,p_owner uuid)
returns jsonb language sql security definer set search_path='' as $$
  select public._hardware_slot_legacy_json(s.id,p_owner)||pg_catalog.jsonb_build_object(
    'bookingMode',s.booking_mode,'protectionStartsAt',s.protection_starts_at,
    'reservationFeeCents',case when s.owner_id=p_owner then s.reservation_fee_cents else null end,
    'paymentStatus',case when s.owner_id=p_owner then s.payment_status else null end,
    'requestedBayId',case when s.owner_id=p_owner then s.requested_bay_id else null end,
    'requestedConnectorId',case when s.owner_id=p_owner then s.requested_connector_id else null end,
    'extensionCount',case when s.owner_id=p_owner then s.extension_count else null end,
    'failureReason',case when s.owner_id=p_owner then s.failure_reason else null end)
  from public.hardware_slot_bookings s where s.id=p_id
$$;

drop function public.request_hardware_slot(uuid,uuid,timestamptz,timestamptz,uuid,text,text);
create function public.request_hardware_slot(p_bay_id uuid,p_connector_id uuid,p_starts_at timestamptz,
  p_ends_at timestamptz,p_request_id uuid,p_plate_hash text,p_masked_plate text,p_booking_mode text default 'scheduled')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid(); v_now timestamptz; s public.hardware_slot_bookings%rowtype;
  b public.bookable_bays%rowtype; c public.hardware_controls%rowtype; v_id uuid; v_start timestamptz; v_end timestamptz;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
  if p_connector_id is null then raise exception 'CONNECTOR_REQUIRED'; end if;
  if p_booking_mode is null or p_booking_mode not in ('now','scheduled') then raise exception 'INVALID_SLOT'; end if;
  if p_plate_hash is null or p_plate_hash!~'^[0-9a-f]{64}$' or p_masked_plate is null or p_masked_plate!~'^•••[A-Z0-9]{2}$' then
    raise exception 'INVALID_PLATE'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bayready:owner:'||v_owner::text,0));
  select x.* into s from public.hardware_slot_bookings x where x.owner_id=v_owner and x.idempotency_key=p_request_id;
  if found then
    if (s.requested_bay_id,s.requested_connector_id,s.requested_starts_at,s.requested_ends_at,s.plate_hash,s.masked_plate,s.booking_mode,s.source)
      is distinct from (p_bay_id,p_connector_id,p_starts_at,p_ends_at,p_plate_hash,p_masked_plate,p_booking_mode,'scheduled'::text) then
      raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return public.get_hardware_slot(s.id);
  end if;
  v_now:=pg_catalog.clock_timestamp();
  if p_starts_at is null or p_ends_at is null or not pg_catalog.isfinite(p_starts_at) or not pg_catalog.isfinite(p_ends_at)
    or p_starts_at<v_now-interval '60 seconds' or p_starts_at>v_now+interval '7 days'
    or p_ends_at<=v_now or p_ends_at<p_starts_at+interval '5 minutes' or p_ends_at>p_starts_at+interval '120 minutes'
    or p_booking_mode='now' and (p_starts_at>v_now+interval '60 seconds' or p_ends_at-p_starts_at<>interval '10 minutes') then
    raise exception 'INVALID_WINDOW'; end if;
  select x.* into b from public.bookable_bays x where x.id=p_bay_id for update;
  if not found or b.integration_mode<>'ecurious' then raise exception 'HARDWARE_BAY_NOT_FOUND'; end if;
  select x.* into c from public.hardware_controls x where x.bay_id=p_bay_id for update;
  if not found then raise exception 'HARDWARE_NOT_ENROLLED'; end if;
  if not b.enabled or not c.enabled or not c.interlocks_confirmed then raise exception 'HARDWARE_DISABLED'; end if;
  perform 1 from public.bay_connectors x where x.id=p_connector_id and x.bay_id=p_bay_id and x.enabled for share;
  if not found then raise exception 'CONNECTOR_NOT_AVAILABLE'; end if;
  perform public._finish_hardware_slots(p_bay_id);
  v_start:=case when p_booking_mode='now' then v_now else p_starts_at end;
  v_end:=case when p_booking_mode='now' then v_now+interval '10 minutes' else p_ends_at end;
  begin
    insert into public.hardware_slot_bookings(bay_id,connector_id,owner_id,starts_at,ends_at,idempotency_key,plate_hash,masked_plate,
      booking_mode,protection_starts_at,requested_bay_id,requested_connector_id,requested_starts_at,requested_ends_at,
      reservation_fee_cents,payment_status)
    values(p_bay_id,p_connector_id,v_owner,v_start,v_end,p_request_id,p_plate_hash,p_masked_plate,p_booking_mode,
      case when p_booking_mode='now' then v_start else v_start-interval '10 minutes' end,
      p_bay_id,p_connector_id,p_starts_at,p_ends_at,case when p_booking_mode='now' then 0 else 100 end,
      case when p_booking_mode='now' then 'free' else 'mock_paid' end) returning id into v_id;
  exception when exclusion_violation then raise exception 'SLOT_RESERVED'; end;
  return public.get_hardware_slot(v_id);
end;
$$;

create function public.request_hardware_slot_extension(p_slot_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid(); s public.hardware_slot_bookings%rowtype; e public.hardware_slot_extensions%rowtype;
  c public.hardware_controls%rowtype; v_end timestamptz;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bayready:owner:'||v_owner::text,0));
  select x.* into e from public.hardware_slot_extensions x where x.owner_id=v_owner and x.request_id=p_request_id;
  if found then
    if e.slot_id is distinct from p_slot_id then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return public.get_hardware_slot(p_slot_id);
  end if;
  select x.* into s from public.hardware_slot_bookings x where x.id=p_slot_id and x.owner_id=v_owner;
  if not found then raise exception 'SLOT_NOT_FOUND'; end if;
  perform 1 from public.bookable_bays b where b.id=s.bay_id for update;
  select x.* into c from public.hardware_controls x where x.bay_id=s.bay_id for update;
  select x.* into s from public.hardware_slot_bookings x where x.id=p_slot_id for update;
  if s.booking_mode<>'now' or s.status not in ('scheduled','active') or s.ends_at<=pg_catalog.clock_timestamp()
    or s.departed_at is not null or s.extension_count>=11
    or s.hardware_reservation_id is not null and (c.reservation_id is distinct from s.hardware_reservation_id or c.release_requested) then
    raise exception 'SLOT_NOT_EXTENDABLE'; end if;
  v_end:=s.ends_at+interval '10 minutes';
  if v_end>s.starts_at+interval '120 minutes' then raise exception 'SLOT_NOT_EXTENDABLE'; end if;
  begin
    update public.hardware_slot_bookings set ends_at=v_end,extension_count=extension_count+1,
      reservation_fee_cents=reservation_fee_cents+100,payment_status='mock_paid',updated_at=pg_catalog.clock_timestamp() where id=s.id;
  exception when exclusion_violation then raise exception 'SLOT_RESERVED'; end;
  update public.booking_reservations set expires_at=v_end where id=s.hardware_reservation_id and status='held';
  insert into public.hardware_slot_extensions(owner_id,request_id,slot_id,ends_at) values(v_owner,p_request_id,s.id,v_end);
  return public.get_hardware_slot(s.id);
end;
$$;

-- A deadline scan can wait behind an extension. Re-read the allocation after
-- the control lock is held, rather than releasing from the scan's old snapshot.
create or replace function public.reconcile_hardware_deadlines()
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.hardware_controls%rowtype; v_count integer:=0;
begin
  for c in select x.* from public.hardware_controls x join public.booking_reservations r on r.id=x.reservation_id
    where not x.release_requested and r.status='held' and r.expires_at<=pg_catalog.clock_timestamp()
    for update of x skip locked loop
    if not exists(select 1 from public.booking_reservations r where r.id=c.reservation_id and r.status='held'
      and r.expires_at<=pg_catalog.clock_timestamp()) then continue; end if;
    update public.hardware_controls set release_requested=true,
      release_reason=case when entry_requested then 'expired' else 'no_show' end,
      reason=case when entry_requested then 'HOLD_EXPIRED' else 'NO_SHOW_RELEASE_REQUESTED' end where bay_id=c.bay_id;
    perform public._queue_hardware_operation(c.bay_id,'release');
    v_count:=v_count+1;
  end loop;
  return pg_catalog.jsonb_build_object('serverNow',pg_catalog.clock_timestamp(),'changed',v_count);
end;
$$;

-- The new grace follows the actual chosen option, including paid extensions.
do $$ declare d text; begin
  d:=pg_catalog.pg_get_functiondef('public.authorize_hardware_plate_entry(uuid,text,timestamptz,text)'::regprocedure);
  d:=pg_catalog.replace(d,'v_now<s.starts_at','v_now<s.protection_starts_at');
  if pg_catalog.strpos(d,'least(s.ends_at,v_protected_at+interval ''15 minutes'')')=0 then raise exception 'OPTION_DEADLINE_UPGRADE_REQUIRED'; end if;
  d:=pg_catalog.replace(d,'least(s.ends_at,v_protected_at+interval ''15 minutes'')',
    '(case when s.booking_mode=''now'' then s.ends_at else least(s.ends_at,s.starts_at+interval ''10 minutes'') end)');
  execute d;
end; $$;

-- Replacement scheduler. Lock requested bay first, use SKIP LOCKED for any
-- alternate bay, then allocate and queue in the same transaction. Already
-- activated physical guards are never moved or cleared by fallback.
create or replace function public.reconcile_hardware_slots()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_bay uuid; s public.hardware_slot_bookings%rowtype; c public.hardware_controls%rowtype;
  candidate record; v_now timestamptz; v_res uuid; v_stop timestamptz; v_target uuid; v_connector uuid;
  v_activated integer:=0; v_completed integer:=0; v_blocked integer:=0; v_ok boolean;
begin
  for v_bay in select distinct x.bay_id from public.hardware_slot_bookings x
    where x.status in ('scheduled','active','blocked','cancel_requested') order by x.bay_id loop
    perform 1 from public.bookable_bays b where b.id=v_bay for update skip locked;
    if not found then continue; end if;
    select x.* into c from public.hardware_controls x where x.bay_id=v_bay for update;
    v_completed:=v_completed+public._finish_hardware_slots(v_bay);
    v_now:=pg_catalog.clock_timestamp();
    for s in select x.* from public.hardware_slot_bookings x where x.bay_id=v_bay
      and x.hardware_reservation_id=c.reservation_id and x.status in ('active','blocked','cancel_requested') for update loop
      v_stop:=case when s.arrived_at is null and s.booking_mode='scheduled'
        then least(s.ends_at,s.starts_at+interval '10 minutes') else s.ends_at end;
      if v_now>=v_stop and not c.release_requested then
        update public.hardware_slot_bookings set billing_stopped_at=coalesce(billing_stopped_at,v_stop),updated_at=v_now where id=s.id;
        update public.hardware_controls set release_requested=true,
          release_reason=case when s.arrived_at is null then 'no_show' else 'expired' end,
          reason=case when s.arrived_at is null then 'NO_SHOW_RELEASE_REQUESTED' else 'SLOT_ENDED' end where bay_id=v_bay;
        perform public._queue_hardware_operation(v_bay,'release');
      end if;
    end loop;
    for s in select x.* from public.hardware_slot_bookings x where x.bay_id=v_bay
      and x.hardware_reservation_id is null and x.status in ('scheduled','blocked')
      and x.protection_starts_at<=v_now and x.ends_at>v_now order by x.protection_starts_at for update loop
      v_target:=null; v_connector:=null;
      if exists(select 1 from public.hardware_operations o where o.bay_id=s.bay_id
        and o.status in ('dispatching','acknowledged','uncertain')) then
        update public.hardware_slot_bookings set status='blocked',billing_waived=true,updated_at=v_now where id=s.id;
        v_blocked:=v_blocked+1; continue;
      end if;
      for candidate in select b.id,b.location_id,x.id connector_id
        from public.bookable_bays b join public.bay_connectors x on x.bay_id=b.id
        join public.bay_connectors requested on requested.id=s.requested_connector_id
        join public.bookable_bays original on original.id=s.requested_bay_id
        where b.location_id=original.location_id and b.enabled and b.integration_mode='ecurious'
          and x.enabled and x.connector_type=requested.connector_type and x.power_kw>=requested.power_kw
        order by (b.id=s.bay_id) desc,b.id,x.power_kw,x.id loop
        perform 1 from public.bookable_bays b where b.id=candidate.id for update skip locked;
        if not found then continue; end if;
        select x.* into c from public.hardware_controls x where x.bay_id=candidate.id for update skip locked;
        if not found then continue; end if;
        v_ok:=c.enabled and c.interlocks_confirmed and c.reservation_id is null and c.phase='idle'
          and not c.observation_conflict and c.observed_at is not null and c.observed_at<=v_now
          and c.observed_at>=v_now-pg_catalog.make_interval(secs=>c.telemetry_max_age_ms/1000.0)
          and c.barrier='lowered' and c.occupancy='vacant' and not c.faulted and c.access_mode='disabled'
          and not exists(select 1 from public.booking_reservations r where r.bay_id=candidate.id and r.status='held')
          and not exists(select 1 from public.hardware_operations o where o.bay_id=candidate.id
            and o.status in ('queued','claimed','dispatching','acknowledged','uncertain'))
          and not exists(select 1 from public.hardware_slot_bookings z where z.bay_id=candidate.id and z.id<>s.id
            and z.status in ('scheduled','active','blocked','cancel_requested')
            and pg_catalog.tstzrange(z.protection_starts_at,z.ends_at,'[)')&&pg_catalog.tstzrange(s.protection_starts_at,s.ends_at,'[)'));
        if not v_ok then continue; end if;
        begin
          update public.hardware_slot_bookings set bay_id=candidate.id,connector_id=candidate.connector_id where id=s.id;
          v_target:=candidate.id; v_connector:=candidate.connector_id;
        exception when exclusion_violation then continue; end;
        exit;
      end loop;
      if v_target is null then
        update public.hardware_slot_bookings set status='cancelled',failure_reason='LOCATION_FULL',billing_waived=true,
          payment_status=case when reservation_fee_cents>0 then 'mock_refunded' else 'free' end,
          billing_stopped_at=v_now,updated_at=v_now where id=s.id;
        v_blocked:=v_blocked+1; continue;
      end if;
      insert into public.booking_reservations(bay_id,connector_id,owner_id,starts_at,expires_at,idempotency_key,created_at)
        values(v_target,v_connector,s.owner_id,v_now,s.ends_at,s.activation_request_id,v_now) returning id into v_res;
      update public.hardware_controls set reservation_id=v_res,release_requested=false,release_reason=null,
        entry_requested=false,reason=null,updated_at=v_now where bay_id=v_target;
      update public.hardware_slot_bookings set hardware_reservation_id=v_res,activated_at=v_now,status='active',updated_at=v_now where id=s.id;
      perform public._queue_hardware_operation(v_target,'protect');
      v_activated:=v_activated+1;
    end loop;
  end loop;
  perform public.reconcile_hardware_deadlines();
  return pg_catalog.jsonb_build_object('serverNow',pg_catalog.clock_timestamp(),'activated',v_activated,
    'completed',v_completed,'blocked',v_blocked,'expired',0,'idleQueued',0);
end;
$$;

create function public.list_hardware_booking_alternatives(p_slot_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.hardware_slot_bookings%rowtype; v_lat double precision; v_lon double precision;
  v_location uuid; v_items jsonb; v_now timestamptz:=pg_catalog.clock_timestamp();
begin
  select x.* into s from public.hardware_slot_bookings x where x.id=p_slot_id;
  if not found then raise exception 'SLOT_NOT_FOUND'; end if;
  select l.id,l.latitude,l.longitude into v_location,v_lat,v_lon from public.bookable_bays b
    join public.charging_locations l on l.id=b.location_id where b.id=s.requested_bay_id;
  if v_lat is null or v_lon is null or s.ends_at<=v_now then
    return pg_catalog.jsonb_build_object('serverNow',v_now,'alternatives','[]'::jsonb); end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('locationId',a.id,'label',a.label,
    'latitude',a.latitude,'longitude',a.longitude,'distanceKm',a.distance,'availableBays',a.bays,'connectorTypes',a.types)
    order by a.distance,a.id),'[]'::jsonb) into v_items from (
    select l.id,l.label,l.latitude,l.longitude,count(distinct b.id) bays,
      pg_catalog.jsonb_agg(distinct x.connector_type) types,
      6371*2*pg_catalog.asin(pg_catalog.sqrt(least(1.0,
        pg_catalog.power(pg_catalog.sin(pg_catalog.radians(l.latitude-v_lat)/2),2)
        +pg_catalog.cos(pg_catalog.radians(v_lat))*pg_catalog.cos(pg_catalog.radians(l.latitude))
        *pg_catalog.power(pg_catalog.sin(pg_catalog.radians(l.longitude-v_lon)/2),2)))) distance
    from public.charging_locations l join public.bookable_bays b on b.location_id=l.id
    join public.hardware_controls c on c.bay_id=b.id join public.bay_connectors x on x.bay_id=b.id
    join public.bay_connectors requested on requested.id=s.requested_connector_id
    where l.id<>v_location and l.latitude is not null and l.longitude is not null
      and b.enabled and b.integration_mode='ecurious' and x.enabled and x.connector_type=requested.connector_type
      and x.power_kw>=requested.power_kw and c.enabled and c.interlocks_confirmed and c.reservation_id is null
      and c.phase='idle' and not c.observation_conflict and c.observed_at<=v_now
      and c.observed_at>=v_now-pg_catalog.make_interval(secs=>c.telemetry_max_age_ms/1000.0)
      and c.barrier='lowered' and c.occupancy='vacant' and not c.faulted and c.access_mode='disabled'
      and not exists(select 1 from public.booking_reservations r where r.bay_id=b.id and r.status='held')
      and not exists(select 1 from public.hardware_operations o where o.bay_id=b.id
        and o.status in ('queued','claimed','dispatching','acknowledged','uncertain'))
      and not exists(select 1 from public.hardware_slot_bookings z where z.bay_id=b.id
        and z.status in ('scheduled','active','blocked','cancel_requested')
        and pg_catalog.tstzrange(z.protection_starts_at,z.ends_at,'[)')&&pg_catalog.tstzrange(s.protection_starts_at,s.ends_at,'[)'))
    group by l.id order by distance,l.id limit 3) a;
  return pg_catalog.jsonb_build_object('serverNow',v_now,'alternatives',v_items);
end;
$$;

revoke all on function public._hardware_slot_option_defaults(),public._hardware_slot_legacy_json(uuid,uuid),
  public._hardware_slot_json(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.request_hardware_slot(uuid,uuid,timestamptz,timestamptz,uuid,text,text,text),
  public.request_hardware_slot_extension(uuid,uuid) from public,anon;
grant execute on function public.request_hardware_slot(uuid,uuid,timestamptz,timestamptz,uuid,text,text,text),
  public.request_hardware_slot_extension(uuid,uuid) to authenticated;
revoke all on function public.list_hardware_booking_alternatives(uuid) from public,anon,authenticated;
grant execute on function public.list_hardware_booking_alternatives(uuid) to service_role;
commit;
