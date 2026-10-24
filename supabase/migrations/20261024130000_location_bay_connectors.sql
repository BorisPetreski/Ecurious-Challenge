-- An operator-approved location contains physical bays; one bay can have
-- multiple selectable plugs. A hold always occupies the whole physical bay.
-- Directory connector counts are never expanded into invented bookable bays.

begin;

create table public.charging_locations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  label text not null check (pg_catalog.char_length(pg_catalog.btrim(label)) between 1 and 120),
  goingelectric_id bigint check (goingelectric_id > 0),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint location_coordinates_pair check ((latitude is null) = (longitude is null))
);
comment on table public.charging_locations is
  'Operator-approved location metadata, not a copied GoingElectric catalog. Coordinates are fictional/demo or operator-provided; directory mappings require explicit confirmation.';

alter table public.bookable_bays add column location_id uuid
  references public.charging_locations(id) on delete restrict;

-- Preserve the original demo coordinates and optional mapping during upgrade.
insert into public.charging_locations (id, label, goingelectric_id, latitude, longitude)
select '00000000-0000-4000-8000-000000000100', 'Fictional Berlin demo location',
  b.goingelectric_id, b.latitude, b.longitude
from public.bookable_bays b where b.id = '00000000-0000-4000-8000-000000000001';
update public.bookable_bays
set location_id = '00000000-0000-4000-8000-000000000100', label = 'Demo bay A1'
where id = '00000000-0000-4000-8000-000000000001';

-- Legacy operator inventory gets its own location without guessing which
-- rows share a site. All existing labels, coordinates, mappings and IDs survive.
do $$
declare
  v_bay public.bookable_bays%rowtype;
  v_location_id uuid;
begin
  for v_bay in select b.* from public.bookable_bays b where b.location_id is null loop
    v_location_id := pg_catalog.gen_random_uuid();
    insert into public.charging_locations (id, label, goingelectric_id, latitude, longitude, created_at)
    values (v_location_id, v_bay.label, v_bay.goingelectric_id, v_bay.latitude, v_bay.longitude, v_bay.created_at);
    update public.bookable_bays set location_id = v_location_id where id = v_bay.id;
  end loop;
end;
$$;

alter table public.bookable_bays alter column location_id set not null;
-- Location metadata now has one authority, rather than drifting copies per bay.
alter table public.bookable_bays drop column goingelectric_id, drop column latitude, drop column longitude;
create index bookable_bays_location on public.bookable_bays(location_id);

insert into public.bookable_bays (id, location_id, label, integration_mode, enabled) values
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000100', 'Demo bay A2', 'demo', true),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000100', 'Demo bay A3', 'demo', true);

create table public.bay_connectors (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  bay_id uuid not null references public.bookable_bays(id) on delete cascade,
  label text not null check (pg_catalog.char_length(pg_catalog.btrim(label)) between 1 and 120),
  connector_type text not null check (pg_catalog.char_length(pg_catalog.btrim(connector_type)) between 1 and 40),
  power_kw numeric not null check (power_kw between 0 and 2000),
  enabled boolean not null default false,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint connector_verified_power check (not enabled or power_kw > 0),
  constraint connector_identity_bay unique (id, bay_id)
);
create index bay_connectors_bay on public.bay_connectors(bay_id);
comment on table public.bay_connectors is
  'Explicit operator-registered plugs on one physical bay. Different plugs on the same bay cannot be booked independently. Disabled UNKNOWN/0kW rows preserve legacy holds without inventing the selected plug.';

insert into public.bay_connectors (id, bay_id, label, connector_type, power_kw, enabled) values
  ('00000000-0000-4000-8000-000000000111', '00000000-0000-4000-8000-000000000001', 'A1 CCS', 'CCS', 150, true),
  ('00000000-0000-4000-8000-000000000112', '00000000-0000-4000-8000-000000000001', 'A1 Type 2', 'Typ2', 22, true),
  ('00000000-0000-4000-8000-000000000121', '00000000-0000-4000-8000-000000000002', 'A2 CCS', 'CCS', 150, true),
  ('00000000-0000-4000-8000-000000000131', '00000000-0000-4000-8000-000000000003', 'A3 Type 2', 'Typ2', 22, true);

alter table public.booking_reservations add column connector_id uuid;
do $$
declare
  v_bay_id uuid;
  v_connector_id uuid;
begin
  for v_bay_id in select distinct r.bay_id from public.booking_reservations r loop
    v_connector_id := pg_catalog.gen_random_uuid();
    insert into public.bay_connectors (id, bay_id, label, connector_type, power_kw, enabled)
    values (v_connector_id, v_bay_id, 'Legacy hold — connector not recorded', 'UNKNOWN', 0, false);
    update public.booking_reservations set connector_id = v_connector_id where bay_id = v_bay_id;
  end loop;
end;
$$;
alter table public.booking_reservations alter column connector_id set not null;
alter table public.booking_reservations add constraint reservation_connector_matches_bay
  foreign key (connector_id, bay_id) references public.bay_connectors(id, bay_id) on delete restrict;
comment on column public.booking_reservations.connector_id is
  'Selected plug; the unique held-per-bay index still reserves the entire physical parking bay.';

alter table public.charging_locations enable row level security;
alter table public.bay_connectors enable row level security;
revoke all on table public.charging_locations, public.bay_connectors from public, anon, authenticated;

create or replace function public.list_bay_availability()
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

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', b.id,
    'label', b.label,
    'locationId', l.id,
    'locationLabel', l.label,
    'goingelectricId', l.goingelectric_id,
    'latitude', l.latitude,
    'longitude', l.longitude,
    'mode', b.integration_mode,
    'lockId', b.ecurious_lock_id,
    'connectors', c.items,
    'availability', case when r.id is null then 'unreserved' else 'reserved' end,
    'reservedUntil', r.expires_at,
    'isMine', coalesce(r.owner_id = v_owner, false),
    'myReservationId', case when r.owner_id = v_owner then r.id else null end,
    'myConnectorId', case when r.owner_id = v_owner then r.connector_id else null end
  ) order by l.label, l.id, b.label, b.id), '[]'::jsonb) into v_bays
  from public.bookable_bays b
  join public.charging_locations l on l.id = b.location_id
  left join public.booking_reservations r
    on r.bay_id = b.id and r.status = 'held' and r.expires_at > v_now
  left join lateral (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', x.id, 'label', x.label, 'type', x.connector_type,
      'powerKw', x.power_kw, 'enabled', x.enabled
    ) order by x.label, x.id), '[]'::jsonb) as items
    from public.bay_connectors x where x.bay_id = b.id
  ) c on true
  where b.enabled;

  return pg_catalog.jsonb_build_object('serverNow', v_now, 'bays', v_bays);
end;
$$;

-- Avoid an overloaded PostgREST RPC with ambiguous default arguments.
drop function public.reserve_bay(uuid, integer, uuid);
create function public.reserve_bay(
  p_bay_id uuid,
  p_hold_minutes integer default 10,
  p_request_id uuid default null,
  p_connector_id uuid default null
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
  if p_connector_id is null then
    raise exception using errcode = '22023', message = 'CONNECTOR_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bayready:owner:' || v_owner::text, 0)
  );
  select r.* into v_existing from public.booking_reservations r
  where r.owner_id = v_owner and r.idempotency_key = p_request_id;
  v_has_existing := found;
  if v_has_existing and (
    v_existing.bay_id is distinct from p_bay_id
    or v_existing.connector_id is distinct from p_connector_id
    or v_existing.expires_at - v_existing.starts_at <> pg_catalog.make_interval(mins => p_hold_minutes)
  ) then
    raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
  end if;

  -- This lock is shared by every plug on a physical bay. The unique held-per-
  -- bay index remains unchanged as a second defence against double booking.
  select b.* into v_bay from public.bookable_bays b where b.id = p_bay_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'BAY_NOT_FOUND';
  end if;
  v_now := pg_catalog.clock_timestamp();
  update public.booking_reservations set status = 'expired'
  where bay_id = p_bay_id and status = 'held' and expires_at <= v_now;

  if v_has_existing then
    -- Preserve history even if an operator disabled the bay or selected plug.
    select r.* into v_reservation from public.booking_reservations r where r.id = v_existing.id;
  else
    if not v_bay.enabled then
      raise exception using errcode = 'P0001', message = 'BAY_DISABLED';
    end if;
    if v_bay.integration_mode <> 'demo' then
      raise exception using errcode = 'P0001', message = 'BAY_NOT_BOOKABLE';
    end if;
    perform 1 from public.bay_connectors c
    where c.id = p_connector_id and c.bay_id = p_bay_id and c.enabled for share;
    if not found then
      raise exception using errcode = 'P0001', message = 'CONNECTOR_NOT_AVAILABLE';
    end if;
    if exists (select 1 from public.booking_reservations r where r.bay_id = p_bay_id and r.status = 'held') then
      raise exception using errcode = 'P0001', message = 'BAY_RESERVED';
    end if;

    insert into public.booking_reservations
      (bay_id, connector_id, owner_id, starts_at, expires_at, idempotency_key, created_at)
    values (p_bay_id, p_connector_id, v_owner, v_now,
      v_now + pg_catalog.make_interval(mins => p_hold_minutes), p_request_id, v_now)
    returning * into v_reservation;
  end if;

  return pg_catalog.jsonb_build_object(
    'id', v_reservation.id, 'bayId', v_reservation.bay_id,
    'connectorId', v_reservation.connector_id, 'status', v_reservation.status,
    'startsAt', v_reservation.starts_at, 'createdAt', v_reservation.created_at,
    'expiresAt', v_reservation.expires_at
  );
end;
$$;
comment on function public.reserve_bay(uuid, integer, uuid, uuid) is
  'Atomic demo hold for one selected enabled plug and its entire physical bay. Retry identity includes bay, plug and duration. Real hardware writes remain disabled.';

create or replace function public.cancel_reservation(p_reservation_id uuid)
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
    raise exception using errcode = 'P0001', message = 'RESERVATION_NOT_FOUND';
  end if;
  perform 1 from public.bookable_bays b where b.id = v_reservation.bay_id for update;
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
    'id', v_reservation.id, 'bayId', v_reservation.bay_id,
    'connectorId', v_reservation.connector_id, 'status', v_reservation.status,
    'startsAt', v_reservation.starts_at, 'createdAt', v_reservation.created_at,
    'expiresAt', v_reservation.expires_at
  );
end;
$$;

revoke all on function public.list_bay_availability() from public, anon;
revoke all on function public.reserve_bay(uuid, integer, uuid, uuid) from public, anon;
revoke all on function public.cancel_reservation(uuid) from public, anon;
grant execute on function public.list_bay_availability() to authenticated;
grant execute on function public.reserve_bay(uuid, integer, uuid, uuid) to authenticated;
grant execute on function public.cancel_reservation(uuid) to authenticated;

commit;
