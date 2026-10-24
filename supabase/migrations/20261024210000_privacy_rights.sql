-- Practical owner access and erasure intake, not a legal-compliance claim.
-- Requests do not cancel reservations, move barriers, delete Auth users or
-- erase data. Fulfillment/retention needs an operator-reviewed policy.
begin;

create table public.privacy_erasure_requests (
  id uuid not null unique default pg_catalog.gen_random_uuid(),
  owner_id uuid primary key references auth.users(id) on delete restrict,
  status text not null default 'pending_review' check (status='pending_review'),
  requested_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table public.privacy_erasure_requests enable row level security;
revoke all on public.privacy_erasure_requests from public,anon,authenticated;
comment on table public.privacy_erasure_requests is
  'Private owner erasure intake only. One idempotent pending request per account; no automatic deletion, cancellation, payment refund, hardware movement or Auth deletion. Operator fulfillment, response/contact and retention policy remain required.';

create function public._privacy_request_json(p_owner uuid)
returns jsonb language sql security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'id',q.id,'status',q.status,'requestedAt',q.requested_at,'updatedAt',q.updated_at,
    'hasActiveHardwareBookings',
      exists(select 1 from public.hardware_controls c
        join public.booking_reservations r on r.id=c.reservation_id where r.owner_id=p_owner)
      or exists(select 1 from public.hardware_slot_bookings s where s.owner_id=p_owner
        and s.status in ('active','blocked','cancel_requested') and s.hardware_reservation_id is not null),
    'notice','Your request is pending review. Your data has not been deleted. Active hardware allocations must complete safe cleanup before erasure; upcoming bookings and required records need operator review.'
  ) from public.privacy_erasure_requests q where q.owner_id=p_owner
$$;
revoke all on function public._privacy_request_json(uuid) from public,anon,authenticated,service_role;

create function public.get_my_privacy_request()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid();
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  return public._privacy_request_json(v_owner);
end;
$$;

create function public.request_my_data_erasure()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid();
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  -- Unique owner plus ON CONFLICT makes concurrent retries idempotent without
  -- changing the original request time or acquiring physical-control locks.
  insert into public.privacy_erasure_requests(owner_id) values(v_owner)
    on conflict(owner_id) do nothing;
  return public._privacy_request_json(v_owner);
end;
$$;

create function public.export_my_bayready_data()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid(); v_directory jsonb; v_directory_extensions jsonb;
  v_reservations jsonb; v_hardware jsonb; v_hardware_extensions jsonb;
begin
  if v_owner is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  -- Explicit projections prevent future private columns from silently joining
  -- an export. No caller-supplied owner ID, plate hash, camera event key,
  -- dispatch token, credential, raw plate, or image appears in this response.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',r.id,'stationId',r.station_id,'slotKey',r.slot_key,'status',r.status,
    'requestId',r.idempotency_key,'createdAt',r.created_at,'startsAt',r.starts_at,
    'protectionStartsAt',r.protection_starts_at,'initialExpiresAt',r.initial_expires_at,
    'expiresAt',r.expires_at,'bookingMode',r.booking_mode,
    'reservationFeeCents',r.reservation_fee_cents,'paymentStatus',r.payment_status,
    'extensionMinutes',r.extension_minutes
  ) order by r.created_at,r.id),'[]'::jsonb) into v_directory
  from public.directory_plug_reservations r where r.owner_id=v_owner;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'requestId',e.request_id,'reservationId',e.reservation_id,'expiresAt',e.expires_at,'createdAt',e.created_at
  ) order by e.created_at,e.request_id),'[]'::jsonb) into v_directory_extensions
  from public.directory_plug_extensions e join public.directory_plug_reservations r on r.id=e.reservation_id
  where e.owner_id=v_owner and r.owner_id=v_owner;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',r.id,'bayId',r.bay_id,'connectorId',r.connector_id,'status',r.status,
    'startsAt',r.starts_at,'expiresAt',r.expires_at,'requestId',r.idempotency_key,'createdAt',r.created_at
  ) order by r.created_at,r.id),'[]'::jsonb) into v_reservations
  from public.booking_reservations r where r.owner_id=v_owner;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',s.id,'bayId',s.bay_id,'connectorId',s.connector_id,'status',s.status,'source',s.source,
    'requestId',s.idempotency_key,'startsAt',s.starts_at,'endsAt',s.ends_at,
    'protectionStartsAt',s.protection_starts_at,'protectionDeadlineAt',s.protection_deadline_at,
    'requestedBayId',s.requested_bay_id,'requestedConnectorId',s.requested_connector_id,
    'requestedStartsAt',s.requested_starts_at,'requestedEndsAt',s.requested_ends_at,
    'maskedPlate',s.masked_plate,'hardwareReservationId',s.hardware_reservation_id,
    'activatedAt',s.activated_at,'entryAuthorizedAt',s.entry_authorized_at,
    'arrivedAt',s.arrived_at,'departedAt',s.departed_at,'lastPlateEventAt',s.last_plate_event_at,
    'billingWaived',s.billing_waived,'billingStoppedAt',s.billing_stopped_at,
    'bookingMode',s.booking_mode,'reservationFeeCents',s.reservation_fee_cents,
    'paymentStatus',s.payment_status,'extensionCount',s.extension_count,'failureReason',s.failure_reason,
    'createdAt',s.created_at,'updatedAt',s.updated_at
  ) order by s.created_at,s.id),'[]'::jsonb) into v_hardware
  from public.hardware_slot_bookings s where s.owner_id=v_owner;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'requestId',e.request_id,'slotId',e.slot_id,'endsAt',e.ends_at,'createdAt',e.created_at
  ) order by e.created_at,e.request_id),'[]'::jsonb) into v_hardware_extensions
  from public.hardware_slot_extensions e join public.hardware_slot_bookings s on s.id=e.slot_id
  where e.owner_id=v_owner and s.owner_id=v_owner;

  return pg_catalog.jsonb_build_object('schemaVersion',1,'generatedAt',pg_catalog.clock_timestamp(),'ownerId',v_owner,
    'directoryReservations',v_directory,'directoryExtensions',v_directory_extensions,
    'bayReservations',v_reservations,'hardwareBookings',v_hardware,'hardwareExtensions',v_hardware_extensions,
    'erasureRequest',public._privacy_request_json(v_owner));
end;
$$;

revoke all on function public.export_my_bayready_data(),public.request_my_data_erasure(),public.get_my_privacy_request()
  from public,anon;
grant execute on function public.export_my_bayready_data(),public.request_my_data_erasure(),public.get_my_privacy_request()
  to authenticated;
comment on function public.export_my_bayready_data() is
  'Owner-scoped BayReady booking/extension history and erasure intake. No raw plates, fingerprints, event keys, images or worker credentials. Auth account email and the device-local profile are separate sources; provider-held data and other access requests require operator handling.';
comment on function public.request_my_data_erasure() is
  'Records idempotent pending-review request only; does not erase data, remove Auth identity, cancel bookings or touch physical safety guards. Operator fulfillment and retention policy are still required.';
notify pgrst,'reload schema';
commit;
