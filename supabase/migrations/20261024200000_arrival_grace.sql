-- Arrival and an unused protection deadline are separate facts. Future
-- bookings do not operate hardware before T-10; unused Scheduled holds end
-- at T+10, extended explicitly. A trusted matched scan exits unused timeout.
begin;
alter table public.hardware_slot_bookings add column protection_deadline_at timestamptz;
update public.hardware_slot_bookings set protection_deadline_at=least(ends_at,
  starts_at+interval '10 minutes'+pg_catalog.make_interval(mins=>extension_count*10));
alter table public.hardware_slot_bookings alter column protection_deadline_at set not null,
  add constraint hardware_protection_deadline check(pg_catalog.isfinite(protection_deadline_at)
    and protection_deadline_at>starts_at and protection_deadline_at<=ends_at);
alter table public.hardware_slot_bookings drop constraint hardware_slot_no_overlap;
alter table public.hardware_slot_bookings add constraint hardware_slot_no_overlap exclude using gist
  (bay_id with =,pg_catalog.tstzrange(protection_starts_at,protection_deadline_at,'[)') with &&)
  where(status in ('scheduled','active','blocked','cancel_requested'));

create function public._hardware_slot_deadline(p_slot_id uuid)
returns timestamptz language sql security definer set search_path='' as $$
  select s.protection_deadline_at from public.hardware_slot_bookings s where s.id=p_slot_id
$$;
revoke all on function public._hardware_slot_deadline(uuid) from public,anon,authenticated,service_role;

-- Replace definitions in the same transaction, preserving signatures, owners
-- and grants. Exact expected fragments make an unexpected prior schema fail.
do $$ declare d text; begin
  d:=pg_catalog.pg_get_functiondef('public._hardware_slot_option_defaults()'::regprocedure);
  if pg_catalog.strpos(d,'return new;')=0 then raise exception 'ARRIVAL_DEFAULTS_UPGRADE_REQUIRED'; end if;
  execute pg_catalog.replace(d,'return new;',
    'new.protection_deadline_at:=coalesce(new.protection_deadline_at,new.ends_at); return new;');

  d:=pg_catalog.pg_get_functiondef('public.request_hardware_slot(uuid,uuid,timestamptz,timestamptz,uuid,text,text,text)'::regprocedure);
  if pg_catalog.strpos(d,'v_end:=case when p_booking_mode=''now'' then v_now+interval ''10 minutes'' else p_ends_at end;')=0 then
    raise exception 'ARRIVAL_REQUEST_UPGRADE_REQUIRED'; end if;
  d:=pg_catalog.replace(d,'v_now:=pg_catalog.clock_timestamp();',
    'v_now:=pg_catalog.clock_timestamp();
    if p_ends_at-p_starts_at is distinct from interval ''10 minutes'' then raise exception ''INVALID_WINDOW''; end if;');
  d:=pg_catalog.replace(d,'v_end:=case when p_booking_mode=''now'' then v_now+interval ''10 minutes'' else p_ends_at end;',
    'v_end:=v_start+interval ''10 minutes'';');
  execute d;

  d:=pg_catalog.pg_get_functiondef('public._hardware_slot_json(uuid,uuid)'::regprocedure);
  if pg_catalog.strpos(d,'''bookingMode'',s.booking_mode')=0 then raise exception 'ARRIVAL_PROJECTION_UPGRADE_REQUIRED'; end if;
  execute pg_catalog.replace(d,'''bookingMode'',s.booking_mode',
    '''protectionDeadlineAt'',s.protection_deadline_at,''bookingMode'',s.booking_mode');

  d:=pg_catalog.pg_get_functiondef('public._directory_booking_json(uuid)'::regprocedure);
  if pg_catalog.strpos(d,'''expiresAt'',r.expires_at')=0 then raise exception 'DIRECTORY_DEADLINE_UPGRADE_REQUIRED'; end if;
  execute pg_catalog.replace(d,'''expiresAt'',r.expires_at',
    '''expiresAt'',r.expires_at,''protectionDeadlineAt'',r.expires_at');

  d:=pg_catalog.pg_get_functiondef('public.list_hardware_slot_work(integer)'::regprocedure);
  if pg_catalog.strpos(d,'''entryAuthorizedAt'',s.entry_authorized_at')=0 then raise exception 'ARRIVAL_WORK_UPGRADE_REQUIRED'; end if;
  execute pg_catalog.replace(d,'''entryAuthorizedAt'',s.entry_authorized_at',
    '''protectionDeadlineAt'',s.protection_deadline_at,''entryAuthorizedAt'',s.entry_authorized_at');

  d:=pg_catalog.pg_get_functiondef('public._finish_hardware_slots(uuid)'::regprocedure);
  if pg_catalog.strpos(d,'and ends_at<=pg_catalog.clock_timestamp()')=0 then raise exception 'ARRIVAL_EXPIRY_UPGRADE_REQUIRED'; end if;
  execute pg_catalog.replace(d,'and ends_at<=pg_catalog.clock_timestamp()',
    'and protection_deadline_at<=pg_catalog.clock_timestamp()');

  d:=pg_catalog.pg_get_functiondef('public.request_hardware_slot_extension(uuid,uuid)'::regprocedure);
  if pg_catalog.strpos(d,'s.booking_mode<>''now'' or')=0 then raise exception 'ARRIVAL_EXTENSION_UPGRADE_REQUIRED'; end if;
  d:=pg_catalog.replace(d,'s.booking_mode<>''now'' or','s.entry_authorized_at is not null or');
  d:=pg_catalog.replace(d,'s.ends_at<=pg_catalog.clock_timestamp()',
    'public._hardware_slot_deadline(s.id)<=pg_catalog.clock_timestamp()');
  d:=pg_catalog.replace(d,'set ends_at=v_end,extension_count=extension_count+1,',
    'set ends_at=v_end,protection_deadline_at=protection_deadline_at+interval ''10 minutes'',extension_count=extension_count+1,');
  d:=pg_catalog.replace(d,'set expires_at=v_end where id=s.hardware_reservation_id',
    'set expires_at=s.protection_deadline_at+interval ''10 minutes'' where id=s.hardware_reservation_id');
  execute d;

  d:=pg_catalog.pg_get_functiondef('public.authorize_hardware_plate_entry(uuid,text,timestamptz,text)'::regprocedure);
  if pg_catalog.strpos(d,'(case when s.booking_mode=''now'' then s.ends_at else least(s.ends_at,s.starts_at+interval ''10 minutes'') end)')=0 then
    raise exception 'ARRIVAL_AUTHORIZATION_UPGRADE_REQUIRED'; end if;
  d:=pg_catalog.replace(d,'v_now>=s.ends_at','v_now>=public._hardware_slot_deadline(s.id)');
  d:=pg_catalog.replace(d,
    '(case when s.booking_mode=''now'' then s.ends_at else least(s.ends_at,s.starts_at+interval ''10 minutes'') end)',
    'public._hardware_slot_deadline(s.id)');
  execute d;

  d:=pg_catalog.pg_get_functiondef('public.reconcile_hardware_slots()'::regprocedure);
  if pg_catalog.strpos(d,'v_stop:=case when s.arrived_at is null and s.booking_mode=''scheduled''')=0 then
    raise exception 'ARRIVAL_SCHEDULER_UPGRADE_REQUIRED'; end if;
  d:=pg_catalog.replace(d,
    'v_stop:=case when s.arrived_at is null and s.booking_mode=''scheduled''
        then least(s.ends_at,s.starts_at+interval ''10 minutes'') else s.ends_at end;',
    'v_stop:=public._hardware_slot_deadline(s.id);');
  d:=pg_catalog.replace(d,'if v_now>=v_stop and not c.release_requested then',
    'if s.entry_authorized_at is null and v_now>=v_stop and not c.release_requested then');
  d:=pg_catalog.replace(d,'s.arrived_at is null','s.entry_authorized_at is null');
  d:=pg_catalog.replace(d,'x.ends_at>v_now','x.protection_deadline_at>v_now');
  d:=pg_catalog.replace(d,'z.ends_at','z.protection_deadline_at');
  d:=pg_catalog.replace(d,'s.ends_at','s.protection_deadline_at');
  execute d;

  d:=pg_catalog.pg_get_functiondef('public.list_hardware_booking_alternatives(uuid)'::regprocedure);
  d:=pg_catalog.replace(d,'s.ends_at','s.protection_deadline_at');
  d:=pg_catalog.replace(d,'z.ends_at','z.protection_deadline_at');
  execute d;
end; $$;

-- A matched recognition is accepted arrival authorization, independently of
-- physical occupancy. It must not be silently expired by the older allocation
-- timer while the vehicle is entering. Sensor occupied -> later vacant or an
-- explicit owner/operator cleanup ends that session instead.
create or replace function public.reconcile_hardware_deadlines()
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.hardware_controls%rowtype; v_count integer:=0;
begin
  for c in select x.* from public.hardware_controls x join public.booking_reservations r on r.id=x.reservation_id
    left join public.hardware_slot_bookings s on s.hardware_reservation_id=r.id
    where not x.release_requested and r.status='held' and s.entry_authorized_at is null
      and coalesce(public._hardware_slot_deadline(s.id),r.expires_at)<=pg_catalog.clock_timestamp()
    for update of x skip locked loop
    if not exists(select 1 from public.booking_reservations r
      left join public.hardware_slot_bookings s on s.hardware_reservation_id=r.id
      where r.id=c.reservation_id and r.status='held' and s.entry_authorized_at is null
        and coalesce(public._hardware_slot_deadline(s.id),r.expires_at)<=pg_catalog.clock_timestamp()) then continue; end if;
    update public.hardware_controls set release_requested=true,
      release_reason=case when entry_requested then 'expired' else 'no_show' end,
      reason=case when entry_requested then 'HOLD_EXPIRED' else 'NO_SHOW_RELEASE_REQUESTED' end where bay_id=c.bay_id;
    perform public._queue_hardware_operation(c.bay_id,'release');
    v_count:=v_count+1;
  end loop;
  return pg_catalog.jsonb_build_object('serverNow',pg_catalog.clock_timestamp(),'changed',v_count);
end;
$$;
comment on column public.hardware_slot_bookings.protection_deadline_at is
  'Unused-hold cutoff, distinct from planned arrival starts_at and historical ends_at. New scheduled arrival T protects at T-10 and times out at T+10, plus paid minutes. Trusted accepted entry exits automatic unused timeout; sensor facts still determine parked arrival/departure.';
comment on function public.request_hardware_slot_extension(uuid,uuid) is
  'Owner-only idempotent +10 minutes/+EUR1 mock for Now or Scheduled before deadline and before accepted plate entry; whole physical interval and physical expiry update atomically.';
comment on function public.authorize_hardware_plate_entry(uuid,text,timestamptz,text) is
  'Trusted private matching-recognition consumer; fresh event and DB clock must precede authoritative protection deadline. Accepted matching entry is not sensor-confirmed parking and prevents automatic unused-hold expiry.';
notify pgrst,'reload schema';
commit;
