-- BayReady booking inventory and short, immediate-arrival demo holds.
-- This is app booking state, never evidence of physical vacancy or charging.
-- No GoingElectric directory catalog, plates, or camera captures are stored.

begin;

create table public.bookable_bays (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  goingelectric_id bigint check (goingelectric_id > 0),
  label text not null check (pg_catalog.char_length(pg_catalog.btrim(label)) between 1 and 120),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  integration_mode text not null default 'demo' check (integration_mode in ('demo', 'ecurious')),
  ecurious_lock_id text unique,
  enabled boolean not null default false,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint bay_coordinates_pair check ((latitude is null) = (longitude is null)),
  constraint bay_hardware_mapping check (
    (integration_mode = 'demo' and ecurious_lock_id is null)
    or (integration_mode = 'ecurious' and ecurious_lock_id is not null and pg_catalog.char_length(pg_catalog.btrim(ecurious_lock_id)) > 0)
  )
);

comment on table public.bookable_bays is
  'Operator-approved app inventory only. Coordinates must be fictional/demo or operator-provided, not a copied directory catalog. An explicit GoingElectric ID does not establish physical vacancy.';
comment on column public.bookable_bays.goingelectric_id is
  'Optional operator-confirmed directory mapping; never populated by automatically importing search results.';
comment on column public.bookable_bays.enabled is
  'Controls inventory visibility. Real Ecurious booking remains disabled in reserve_bay even when an operator enables a hardware row.';

create table public.booking_reservations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  bay_id uuid not null references public.bookable_bays(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete cascade,
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'held' check (status in ('held', 'cancelled', 'expired')),
  idempotency_key uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint reservation_hold_interval check (
    expires_at > starts_at and expires_at <= starts_at + interval '30 minutes'
  ),
  constraint reservation_owner_request_unique unique (owner_id, idempotency_key)
);

-- Expired rows are reconciled while holding the bay lock before a new insert.
-- This index is a second line of defence against two simultaneous active holds.
create unique index booking_reservations_one_held_per_bay
  on public.booking_reservations (bay_id) where status = 'held';
create index booking_reservations_owner_created
  on public.booking_reservations (owner_id, created_at desc);

comment on table public.booking_reservations is
  'App-level short holds only. Expiry ends a booking, not physical occupancy; it must never trigger a barrier command. Cancelled/expired records retain idempotency history.';

alter table public.bookable_bays enable row level security;
alter table public.booking_reservations enable row level security;

-- Phones access curated RPC results, never table rows or another holder's ID.
-- Anonymous Auth sessions use the authenticated database role after sign-in.
revoke all on table public.bookable_bays, public.booking_reservations from public, anon, authenticated;

create function public.list_bay_availability()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_bays jsonb;
begin
  if v_owner is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', b.id,
        'label', b.label,
        'goingelectricId', b.goingelectric_id,
        'latitude', b.latitude,
        'longitude', b.longitude,
        'mode', b.integration_mode,
        'lockId', b.ecurious_lock_id,
        'availability', case when r.id is null then 'unreserved' else 'reserved' end,
        'reservedUntil', r.expires_at,
        'isMine', coalesce(r.owner_id = v_owner, false),
        'myReservationId', case when r.owner_id = v_owner then r.id else null end
      ) order by b.label, b.id
    ),
    '[]'::jsonb
  ) into v_bays
  from public.bookable_bays b
  left join public.booking_reservations r
    on r.bay_id = b.id and r.status = 'held' and r.expires_at > v_now
  where b.enabled;

  return pg_catalog.jsonb_build_object('serverNow', v_now, 'bays', v_bays);
end;
$$;

comment on function public.list_bay_availability() is
  'Enabled app inventory and non-expired booking holds, not live charging/occupancy. Reveals a reservation ID only to its owner. Database time governs expiry.';

create function public.reserve_bay(
  p_bay_id uuid,
  p_hold_minutes integer default 10,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_now timestamptz;
  v_bay public.bookable_bays%rowtype;
  v_existing public.booking_reservations%rowtype;
  v_reservation public.booking_reservations%rowtype;
  v_has_existing boolean;
begin
  if v_owner is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_hold_minutes is null or p_hold_minutes < 1 or p_hold_minutes > 30 then
    raise exception using errcode = '22023', message = 'INVALID_HOLD';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'REQUEST_ID_REQUIRED';
  end if;

  -- Serializes same-user retries even when they target different bays.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bayready:owner:' || v_owner::text, 0)
  );

  select r.* into v_existing
  from public.booking_reservations r
  where r.owner_id = v_owner and r.idempotency_key = p_request_id;
  v_has_existing := found;

  if v_has_existing and (
    v_existing.bay_id is distinct from p_bay_id
    or v_existing.expires_at - v_existing.starts_at <> pg_catalog.make_interval(mins => p_hold_minutes)
  ) then
    raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
  end if;

  -- Every competing reserve/cancel locks the bay first. Never hold a booking
  -- row lock while waiting for the bay lock; that would allow a deadlock.
  select b.* into v_bay from public.bookable_bays b
  where b.id = p_bay_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'BAY_NOT_FOUND';
  end if;
  v_now := pg_catalog.clock_timestamp();

  update public.booking_reservations
  set status = 'expired'
  where bay_id = p_bay_id and status = 'held' and expires_at <= v_now;

  -- A repeated request never extends a deadline or creates a replacement hold.
  -- Return its original result even if the hold is now cancelled/expired or
  -- the operator subsequently disabled this inventory item.
  if v_has_existing then
    select r.* into v_reservation from public.booking_reservations r
    where r.id = v_existing.id;
  else
    if not v_bay.enabled then
      raise exception using errcode = 'P0001', message = 'BAY_DISABLED';
    end if;
    if v_bay.integration_mode <> 'demo' then
      raise exception using errcode = 'P0001', message = 'BAY_NOT_BOOKABLE';
    end if;
    if exists (
      select 1 from public.booking_reservations r
      where r.bay_id = p_bay_id and r.status = 'held'
    ) then
      raise exception using errcode = 'P0001', message = 'BAY_RESERVED';
    end if;

    insert into public.booking_reservations
      (bay_id, owner_id, starts_at, expires_at, idempotency_key, created_at)
    values (
      p_bay_id, v_owner, v_now,
      v_now + pg_catalog.make_interval(mins => p_hold_minutes),
      p_request_id, v_now
    ) returning * into v_reservation;
  end if;

  return pg_catalog.jsonb_build_object(
    'id', v_reservation.id,
    'bayId', v_reservation.bay_id,
    'status', v_reservation.status,
    'startsAt', v_reservation.starts_at,
    'createdAt', v_reservation.created_at,
    'expiresAt', v_reservation.expires_at
  );
end;
$$;

comment on function public.reserve_bay(uuid, integer, uuid) is
  'Atomic immediate-arrival demo hold (1..30 minutes). Request UUID is required for safe retries. Hardware integration modes are rejected; no barrier or whitelist command is sent.';

create function public.cancel_reservation(p_reservation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_now timestamptz;
  v_reservation public.booking_reservations%rowtype;
begin
  if v_owner is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bayready:owner:' || v_owner::text, 0)
  );
  select r.* into v_reservation from public.booking_reservations r
  where r.id = p_reservation_id and r.owner_id = v_owner;
  if not found then
    -- Same response for an unknown reservation and somebody else's booking.
    raise exception using errcode = 'P0001', message = 'RESERVATION_NOT_FOUND';
  end if;

  perform 1 from public.bookable_bays b
  where b.id = v_reservation.bay_id for update;
  v_now := pg_catalog.clock_timestamp();

  update public.booking_reservations
  set status = case when expires_at <= v_now then 'expired' else 'cancelled' end
  where id = p_reservation_id and owner_id = v_owner and status = 'held'
  returning * into v_reservation;

  if not found then
    select r.* into v_reservation from public.booking_reservations r
    where r.id = p_reservation_id and r.owner_id = v_owner;
  end if;

  return pg_catalog.jsonb_build_object(
    'id', v_reservation.id,
    'bayId', v_reservation.bay_id,
    'status', v_reservation.status,
    'startsAt', v_reservation.starts_at,
    'createdAt', v_reservation.created_at,
    'expiresAt', v_reservation.expires_at
  );
end;
$$;

comment on function public.cancel_reservation(uuid) is
  'Idempotently cancels the caller''s app hold, or reports expiry. Does not prove vacancy and never moves hardware.';

-- Function EXECUTE defaults to PUBLIC in PostgreSQL; remove it explicitly.
revoke all on function public.list_bay_availability() from public, anon;
revoke all on function public.reserve_bay(uuid, integer, uuid) from public, anon;
revoke all on function public.cancel_reservation(uuid) from public, anon;
grant execute on function public.list_bay_availability() to authenticated;
grant execute on function public.reserve_bay(uuid, integer, uuid) to authenticated;
grant execute on function public.cancel_reservation(uuid) to authenticated;

-- Fictional location, deliberately not linked to any public directory station.
-- Only this demo item is initially enabled. Operator/hardware mappings are
-- created by an administrator after on-site confirmation, never by a phone.
insert into public.bookable_bays
  (id, label, latitude, longitude, integration_mode, enabled)
values
  ('00000000-0000-4000-8000-000000000001', 'Fictional Berlin demo bay', 52.52, 13.405, 'demo', true);

commit;
