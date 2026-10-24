-- Public-directory options are software allocations only. No physical device,
-- directory catalog, raw plate, payment processor or charge is involved.
begin;

alter table public.directory_plug_reservations
  add column booking_mode text not null default 'legacy' check (booking_mode in ('legacy','now','scheduled')),
  add column starts_at timestamptz,
  add column protection_starts_at timestamptz,
  add column initial_expires_at timestamptz,
  add column reservation_fee_cents integer not null default 0 check (reservation_fee_cents between 0 and 1200),
  add column payment_status text not null default 'not_required' check (payment_status in ('not_required','mock_paid')),
  add column extension_minutes integer not null default 0 check (extension_minutes between 0 and 110 and extension_minutes % 10 = 0);
update public.directory_plug_reservations
set starts_at=created_at,protection_starts_at=created_at,initial_expires_at=expires_at;
alter table public.directory_plug_reservations
  alter column starts_at set not null,alter column protection_starts_at set not null,alter column initial_expires_at set not null,
  drop constraint directory_hold_interval,
  add constraint directory_booking_interval check (
    pg_catalog.isfinite(starts_at) and pg_catalog.isfinite(protection_starts_at) and pg_catalog.isfinite(expires_at)
    and initial_expires_at>starts_at and initial_expires_at<=starts_at+interval '30 minutes'
    and expires_at=initial_expires_at+pg_catalog.make_interval(mins=>extension_minutes)
    and expires_at<=starts_at+interval '140 minutes'
    and (booking_mode='legacy' or initial_expires_at=starts_at+interval '10 minutes' and expires_at<=starts_at+interval '120 minutes')
    and protection_starts_at<=starts_at and protection_starts_at>=starts_at-interval '10 minutes'
  );
-- Existing allocations keep their original bounds; new scheduled allocations
-- also exclude the ten-minute software lead-in. Adjacent half-open windows fit.
drop index public.directory_plug_one_held_slot;
alter table public.directory_plug_reservations add constraint directory_booking_no_overlap
  exclude using gist (station_id with =,slot_key with =,
    pg_catalog.tstzrange(protection_starts_at,expires_at,'[)') with &&) where (status='held');

create table public.directory_plug_extensions (
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  reservation_id uuid not null references public.directory_plug_reservations(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(owner_id,request_id)
);
alter table public.directory_plug_extensions enable row level security;
revoke all on public.directory_plug_extensions from public,anon,authenticated;
comment on table public.directory_plug_extensions is
  'Private idempotency ledger for ten-minute software extensions, each carrying a mock EUR 1 fee. No actual payment or directory catalog.';

create function public._directory_booking_json(p_id uuid)
returns jsonb language sql security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'id',r.id,'stationId',r.station_id,'slotKey',r.slot_key,'status',r.status,
    'createdAt',r.created_at,'expiresAt',r.expires_at,'bookingMode',r.booking_mode,
    'startsAt',r.starts_at,'protectionStartsAt',r.protection_starts_at,
    'reservationFeeCents',r.reservation_fee_cents,'paymentStatus',r.payment_status,'extensionMinutes',r.extension_minutes
  ) from public.directory_plug_reservations r where r.id=p_id
$$;
revoke all on function public._directory_booking_json(uuid) from public,anon,authenticated;

create or replace function public.list_directory_holds(p_station_ids bigint[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid(); v_now timestamptz:=pg_catalog.clock_timestamp(); v_holds jsonb; v_mine jsonb;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if p_station_ids is null or pg_catalog.cardinality(p_station_ids)>500
    or coalesce(pg_catalog.array_ndims(p_station_ids),1)>1
    or exists(select 1 from pg_catalog.unnest(p_station_ids) x(id) where x.id is null or x.id<1 or x.id>9007199254740991)
    then raise exception using errcode='22023',message='INVALID_STATIONS'; end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'stationId',r.station_id,'slotKey',r.slot_key,'reservedUntil',r.expires_at,'isMine',r.owner_id=v_owner,
    'myReservationId',case when r.owner_id=v_owner then r.id else null end
  ) order by r.station_id,r.slot_key),'[]'::jsonb) into v_holds
  from public.directory_plug_reservations r where r.status='held' and r.expires_at>v_now and r.protection_starts_at<=v_now
    and (r.station_id=any(p_station_ids) or r.owner_id=v_owner);
  select coalesce(pg_catalog.jsonb_agg(public._directory_booking_json(r.id) order by r.starts_at,r.id),'[]'::jsonb)
    into v_mine from public.directory_plug_reservations r where r.owner_id=v_owner and r.status='held' and r.expires_at>v_now;
  return pg_catalog.jsonb_build_object('serverNow',v_now,'holds',v_holds,'myBookings',v_mine);
end;
$$;

create function public.reserve_directory_booking(
  p_station_id bigint,p_slot_key text,p_booking_mode text,p_starts_at timestamptz,p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid(); v_now timestamptz; v_start timestamptz; v_protection timestamptz;
  v_existing public.directory_plug_reservations%rowtype; v_id uuid; v_has_existing boolean;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if p_station_id is null or p_station_id<1 or p_station_id>9007199254740991 then raise exception 'INVALID_STATION'; end if;
  if p_slot_key is null or p_slot_key!~'^[0-9a-f]{64}$' then raise exception 'INVALID_SLOT'; end if;
  if p_booking_mode is null or p_booking_mode not in ('now','scheduled') then raise exception 'INVALID_BOOKING_MODE'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
  if p_booking_mode='now' and p_starts_at is not null
    or p_booking_mode='scheduled' and (p_starts_at is null or not pg_catalog.isfinite(p_starts_at)) then raise exception 'INVALID_SCHEDULE'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bayready:owner:'||v_owner::text,0));
  select r.* into v_existing from public.directory_plug_reservations r where r.owner_id=v_owner and r.idempotency_key=p_request_id;
  v_has_existing:=found;
  if v_has_existing and (v_existing.station_id is distinct from p_station_id or v_existing.slot_key is distinct from p_slot_key
    or v_existing.booking_mode is distinct from p_booking_mode
    or p_booking_mode='scheduled' and v_existing.starts_at is distinct from p_starts_at) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bayready:directory-slot:'||p_station_id::text||':'||p_slot_key,0));
  v_now:=pg_catalog.clock_timestamp();
  update public.directory_plug_reservations set status='expired'
    where station_id=p_station_id and slot_key=p_slot_key and status='held' and expires_at<=v_now;
  if v_has_existing then return public._directory_booking_json(v_existing.id); end if;
  v_start:=case when p_booking_mode='now' then v_now else p_starts_at end;
  if v_start<v_now or v_start>v_now+interval '7 days' then raise exception 'INVALID_SCHEDULE'; end if;
  v_protection:=case when p_booking_mode='scheduled' then v_start-interval '10 minutes' else v_start end;
  if exists(select 1 from public.directory_plug_reservations r where r.station_id=p_station_id and r.slot_key=p_slot_key
    and r.status='held' and pg_catalog.tstzrange(r.protection_starts_at,r.expires_at,'[)')&&pg_catalog.tstzrange(v_protection,v_start+interval '10 minutes','[)'))
    then raise exception 'PLUG_RESERVED'; end if;
  insert into public.directory_plug_reservations(station_id,slot_key,owner_id,created_at,starts_at,protection_starts_at,
    expires_at,initial_expires_at,idempotency_key,booking_mode,reservation_fee_cents,payment_status)
  values(p_station_id,p_slot_key,v_owner,v_now,v_start,v_protection,v_start+interval '10 minutes',v_start+interval '10 minutes',
    p_request_id,p_booking_mode,case when p_booking_mode='scheduled' then 100 else 0 end,
    case when p_booking_mode='scheduled' then 'mock_paid' else 'not_required' end) returning id into v_id;
  return public._directory_booking_json(v_id);
end;
$$;

-- Preserve the old function signature; the public product now has a fixed
-- free ten-minute Now option rather than legacy variable free durations.
create or replace function public.reserve_directory_plug(p_station_id bigint,p_slot_key text,p_hold_minutes integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_hold_minutes is distinct from 10 then raise exception 'INVALID_HOLD'; end if;
  return public.reserve_directory_booking(p_station_id,p_slot_key,'now',null,p_request_id);
end;
$$;

create function public.extend_directory_booking(p_reservation_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid(); v_now timestamptz; r public.directory_plug_reservations%rowtype;
  e public.directory_plug_extensions%rowtype; v_has_extension boolean;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bayready:owner:'||v_owner::text,0));
  select x.* into e from public.directory_plug_extensions x where x.owner_id=v_owner and x.request_id=p_request_id;
  v_has_extension:=found;
  if v_has_extension and e.reservation_id is distinct from p_reservation_id then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  select x.* into r from public.directory_plug_reservations x where x.id=p_reservation_id and x.owner_id=v_owner;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bayready:directory-slot:'||r.station_id::text||':'||r.slot_key,0));
  if v_has_extension then return public._directory_booking_json(r.id); end if;
  v_now:=pg_catalog.clock_timestamp();
  if r.status<>'held' or r.expires_at<=v_now then raise exception 'BOOKING_NOT_ACTIVE'; end if;
  if r.extension_minutes>=110 then raise exception 'EXTENSION_LIMIT'; end if;
  update public.directory_plug_reservations set status='expired'
    where station_id=r.station_id and slot_key=r.slot_key and status='held' and expires_at<=v_now;
  if exists(select 1 from public.directory_plug_reservations x where x.station_id=r.station_id and x.slot_key=r.slot_key and x.id<>r.id
    and x.status='held' and pg_catalog.tstzrange(x.protection_starts_at,x.expires_at,'[)')&&pg_catalog.tstzrange(r.protection_starts_at,r.expires_at+interval '10 minutes','[)'))
    then raise exception 'PLUG_RESERVED'; end if;
  update public.directory_plug_reservations set expires_at=expires_at+interval '10 minutes',extension_minutes=extension_minutes+10,
    reservation_fee_cents=reservation_fee_cents+100,payment_status='mock_paid' where id=r.id returning * into r;
  insert into public.directory_plug_extensions(owner_id,request_id,reservation_id,expires_at) values(v_owner,p_request_id,r.id,r.expires_at);
  return public._directory_booking_json(r.id);
end;
$$;

create or replace function public.cancel_directory_hold(p_reservation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid(); r public.directory_plug_reservations%rowtype; v_now timestamptz;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bayready:owner:'||v_owner::text,0));
  select x.* into r from public.directory_plug_reservations x where x.id=p_reservation_id and x.owner_id=v_owner;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bayready:directory-slot:'||r.station_id::text||':'||r.slot_key,0));
  v_now:=pg_catalog.clock_timestamp();
  update public.directory_plug_reservations set status=case when expires_at<=v_now then 'expired' else 'cancelled' end
    where id=r.id and status='held';
  return public._directory_booking_json(r.id);
end;
$$;

revoke all on function public.reserve_directory_booking(bigint,text,text,timestamptz,uuid) from public,anon;
revoke all on function public.extend_directory_booking(uuid,uuid) from public,anon;
grant execute on function public.reserve_directory_booking(bigint,text,text,timestamptz,uuid) to authenticated;
grant execute on function public.extend_directory_booking(uuid,uuid) to authenticated;
comment on function public.reserve_directory_booking(bigint,text,text,timestamptz,uuid) is
  'App-only Now: ten minutes free; scheduled: ten minutes after arrival with a ten-minute software lead-in and mock EUR 1 fee. No real charge, vacancy guarantee, operator booking or hardware command.';
comment on function public.extend_directory_booking(uuid,uuid) is
  'Owner-only atomic extra ten minutes for mock EUR 1. Request UUID deduplicates retries; a conflicting next booking refuses the extension. At most eleven extensions.';
notify pgrst,'reload schema';
commit;
