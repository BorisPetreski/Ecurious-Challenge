-- App-only holds on deterministic virtual choices derived on the phone from
-- a direct directory response. No directory catalog or physical bay is created.
-- Unreserved means no active BayReady hold; physical occupancy stays unknown.

begin;

create table public.directory_plug_reservations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  station_id bigint not null check (station_id between 1 and 9007199254740991),
  slot_key text not null check (slot_key ~ '^[0-9a-f]{64}$'),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'held' check (status in ('held', 'cancelled', 'expired')),
  idempotency_key uuid not null,
  constraint directory_hold_interval check (
    expires_at > created_at and expires_at <= created_at + interval '30 minutes'
  ),
  constraint directory_owner_request_unique unique (owner_id, idempotency_key)
);
create unique index directory_plug_one_held_slot
  on public.directory_plug_reservations(station_id, slot_key) where status = 'held';
create index directory_plug_owner_created
  on public.directory_plug_reservations(owner_id, created_at desc);
comment on table public.directory_plug_reservations is
  'Software-only holds on opaque directory-listed choices, not verified physical plugs or Ecurious bays. Stores reference IDs and booking state only; no names, coordinates, connector metadata, plates, or images. Catalog authenticity and capacity are not validated by this database.';

alter table public.directory_plug_reservations enable row level security;
revoke all on table public.directory_plug_reservations from public, anon, authenticated;

create function public.list_directory_holds(p_station_ids bigint[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_holds jsonb;
begin
  if v_owner is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_station_ids is null or pg_catalog.cardinality(p_station_ids) > 500
    or coalesce(pg_catalog.array_ndims(p_station_ids), 1) > 1
    or exists (select 1 from pg_catalog.unnest(p_station_ids) s(id)
      where s.id is null or s.id < 1 or s.id > 9007199254740991)
  then
    raise exception using errcode = '22023', message = 'INVALID_STATIONS';
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'stationId', r.station_id,
    'slotKey', r.slot_key,
    'reservedUntil', r.expires_at,
    'isMine', r.owner_id = v_owner,
    'myReservationId', case when r.owner_id = v_owner then r.id else null end
  ) order by r.station_id, r.slot_key), '[]'::jsonb) into v_holds
  from public.directory_plug_reservations r
  where r.status = 'held' and r.expires_at > v_now
    and (r.station_id = any(p_station_ids) or r.owner_id = v_owner);

  return pg_catalog.jsonb_build_object('serverNow', v_now, 'holds', v_holds);
end;
$$;
comment on function public.list_directory_holds(bigint[]) is
  'Active app holds for up to 500 requested stations, plus every caller-owned active hold for cancellation recovery. Empty input still restores owned holds. No missing slot is a claim of physical vacancy.';

create function public.reserve_directory_plug(
  p_station_id bigint,
  p_slot_key text,
  p_hold_minutes integer,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_now timestamptz;
  v_existing public.directory_plug_reservations%rowtype;
  v_reservation public.directory_plug_reservations%rowtype;
  v_has_existing boolean;
begin
  if v_owner is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_station_id is null or p_station_id < 1 or p_station_id > 9007199254740991 then
    raise exception using errcode = '22023', message = 'INVALID_STATION';
  end if;
  if p_slot_key is null or p_slot_key !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'INVALID_SLOT';
  end if;
  if p_hold_minutes is null or p_hold_minutes < 1 or p_hold_minutes > 30 then
    raise exception using errcode = '22023', message = 'INVALID_HOLD';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'REQUEST_ID_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bayready:owner:' || v_owner::text, 0)
  );
  select r.* into v_existing from public.directory_plug_reservations r
  where r.owner_id = v_owner and r.idempotency_key = p_request_id;
  v_has_existing := found;
  if v_has_existing and (
    v_existing.station_id is distinct from p_station_id
    or v_existing.slot_key is distinct from p_slot_key
    or v_existing.expires_at - v_existing.created_at <> pg_catalog.make_interval(mins => p_hold_minutes)
  ) then
    raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
  end if;

  -- No inventory row needs to be provisioned just to lock an unreserved slot.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'bayready:directory-slot:' || p_station_id::text || ':' || p_slot_key, 0
  ));
  v_now := pg_catalog.clock_timestamp();
  update public.directory_plug_reservations set status = 'expired'
  where station_id = p_station_id and slot_key = p_slot_key
    and status = 'held' and expires_at <= v_now;

  if v_has_existing then
    select r.* into v_reservation from public.directory_plug_reservations r
    where r.id = v_existing.id;
  else
    if exists (select 1 from public.directory_plug_reservations r
      where r.station_id = p_station_id and r.slot_key = p_slot_key and r.status = 'held') then
      raise exception using errcode = 'P0001', message = 'PLUG_RESERVED';
    end if;
    insert into public.directory_plug_reservations
      (station_id, slot_key, owner_id, created_at, expires_at, idempotency_key)
    values (p_station_id, p_slot_key, v_owner, v_now,
      v_now + pg_catalog.make_interval(mins => p_hold_minutes), p_request_id)
    returning * into v_reservation;
  end if;

  return pg_catalog.jsonb_build_object(
    'id', v_reservation.id, 'stationId', v_reservation.station_id,
    'slotKey', v_reservation.slot_key, 'status', v_reservation.status,
    'createdAt', v_reservation.created_at, 'expiresAt', v_reservation.expires_at
  );
end;
$$;
comment on function public.reserve_directory_plug(bigint, text, integer, uuid) is
  'Atomic app-only hold on a client-derived virtual slot. Input references are bounded but not checked against the directory. No physical bay, charging system, whitelist, or barrier is controlled.';

create function public.cancel_directory_hold(p_reservation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_now timestamptz;
  v_reservation public.directory_plug_reservations%rowtype;
begin
  if v_owner is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bayready:owner:' || v_owner::text, 0)
  );
  select r.* into v_reservation from public.directory_plug_reservations r
  where r.id = p_reservation_id and r.owner_id = v_owner;
  if not found then
    raise exception using errcode = 'P0001', message = 'RESERVATION_NOT_FOUND';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'bayready:directory-slot:' || v_reservation.station_id::text || ':' || v_reservation.slot_key, 0
  ));
  v_now := pg_catalog.clock_timestamp();
  update public.directory_plug_reservations
  set status = case when expires_at <= v_now then 'expired' else 'cancelled' end
  where id = p_reservation_id and owner_id = v_owner and status = 'held'
  returning * into v_reservation;
  if not found then
    select r.* into v_reservation from public.directory_plug_reservations r
    where r.id = p_reservation_id and r.owner_id = v_owner;
  end if;

  return pg_catalog.jsonb_build_object(
    'id', v_reservation.id, 'stationId', v_reservation.station_id,
    'slotKey', v_reservation.slot_key, 'status', v_reservation.status,
    'createdAt', v_reservation.created_at, 'expiresAt', v_reservation.expires_at
  );
end;
$$;

revoke all on function public.list_directory_holds(bigint[]) from public, anon;
revoke all on function public.reserve_directory_plug(bigint, text, integer, uuid) from public, anon;
revoke all on function public.cancel_directory_hold(uuid) from public, anon;
grant execute on function public.list_directory_holds(bigint[]) to authenticated;
grant execute on function public.reserve_directory_plug(bigint, text, integer, uuid) to authenticated;
grant execute on function public.cancel_directory_hold(uuid) to authenticated;

commit;
