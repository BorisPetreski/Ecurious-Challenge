-- An application intent is not proof of current hardware availability.
-- Slow/unknown telemetry must wait, not be misreported as a full location.
-- Dispatch, confirmation, occupancy, ownership and quarantine guards stay put.
begin;
create or replace function public.reconcile_hardware_slots()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_bay uuid; s public.hardware_slot_bookings%rowtype; c public.hardware_controls%rowtype;
  candidate record; v_now timestamptz; v_res uuid; v_stop timestamptz; v_target uuid; v_connector uuid;
  v_activated integer:=0; v_completed integer:=0; v_blocked integer:=0;
  v_ok boolean; v_unallocated boolean; v_known_occupied boolean; v_wait boolean;
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
      v_stop:=public._hardware_slot_deadline(s.id);
      if s.entry_authorized_at is null and v_now>=v_stop and not c.release_requested then
        update public.hardware_slot_bookings set billing_stopped_at=coalesce(billing_stopped_at,v_stop),updated_at=v_now where id=s.id;
        update public.hardware_controls set release_requested=true,
          release_reason=case when s.entry_authorized_at is null then 'no_show' else 'expired' end,
          reason=case when s.entry_authorized_at is null then 'NO_SHOW_RELEASE_REQUESTED' else 'SLOT_ENDED' end where bay_id=v_bay;
        perform public._queue_hardware_operation(v_bay,'release');
      end if;
    end loop;
    for s in select x.* from public.hardware_slot_bookings x where x.bay_id=v_bay
      and x.hardware_reservation_id is null and x.status in ('scheduled','blocked')
      and x.protection_starts_at<=v_now and x.protection_deadline_at>v_now order by x.protection_starts_at for update loop
      v_target:=null; v_connector:=null; v_wait:=false;
      -- Preserve an original bay's dispatch quarantine without reassignment.
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
        if not found then v_wait:=true; continue; end if;
        select x.* into c from public.hardware_controls x where x.bay_id=candidate.id for update skip locked;
        if not found then
          if exists(select 1 from public.hardware_controls x where x.bay_id=candidate.id) then v_wait:=true; end if;
          continue;
        end if;
        v_unallocated:=c.reservation_id is null
          and not exists(select 1 from public.booking_reservations r where r.bay_id=candidate.id and r.status='held')
          and not exists(select 1 from public.hardware_slot_bookings z where z.bay_id=candidate.id and z.id<>s.id
            and z.status in ('scheduled','active','blocked','cancel_requested')
            and pg_catalog.tstzrange(z.protection_starts_at,z.protection_deadline_at,'[)')
              &&pg_catalog.tstzrange(s.protection_starts_at,s.protection_deadline_at,'[)'));
        v_known_occupied:=coalesce(not c.observation_conflict and c.observed_at is not null and c.observed_at<=v_now
          and c.observed_at>=v_now-pg_catalog.make_interval(secs=>c.telemetry_max_age_ms/1000.0)
          and c.occupancy='occupied',false);
        -- Stale, missing, contradictory or otherwise unsafe observations do
        -- not prove a free space, but also do not prove LOCATION_FULL.
        if v_unallocated and not v_known_occupied then v_wait:=true; end if;
        v_ok:=c.enabled and c.interlocks_confirmed and c.reservation_id is null and c.phase='idle'
          and not c.observation_conflict and c.observed_at is not null and c.observed_at<=v_now
          and c.observed_at>=v_now-pg_catalog.make_interval(secs=>c.telemetry_max_age_ms/1000.0)
          and c.barrier='lowered' and c.occupancy='vacant' and not c.faulted and c.access_mode='disabled'
          and v_unallocated
          and not exists(select 1 from public.hardware_operations o where o.bay_id=candidate.id
            and o.status in ('queued','claimed','dispatching','acknowledged','uncertain'));
        if not v_ok then continue; end if;
        begin
          update public.hardware_slot_bookings set bay_id=candidate.id,connector_id=candidate.connector_id where id=s.id;
          v_target:=candidate.id; v_connector:=candidate.connector_id;
        exception when exclusion_violation then v_wait:=true; continue; end;
        exit;
      end loop;
      if v_target is null then
        if v_wait then
          update public.hardware_slot_bookings set status='scheduled',failure_reason=null,updated_at=v_now where id=s.id;
        else
          update public.hardware_slot_bookings set status='cancelled',failure_reason='LOCATION_FULL',billing_waived=true,
            payment_status=case when reservation_fee_cents>0 then 'mock_refunded' else 'free' end,
            billing_stopped_at=v_now,updated_at=v_now where id=s.id;
        end if;
        v_blocked:=v_blocked+1; continue;
      end if;
      insert into public.booking_reservations(bay_id,connector_id,owner_id,starts_at,expires_at,idempotency_key,created_at)
        values(v_target,v_connector,s.owner_id,v_now,s.protection_deadline_at,s.activation_request_id,v_now) returning id into v_res;
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
comment on function public.reconcile_hardware_slots() is
  'Queues protection only after unchanged fresh/safe/ownership guards. Unactivated intent waits until its existing deadline when compatible capacity is unknown; fresh known occupied/allocated full capacity retains the cancellation/mock-refund path. No guard reset, stale motion, real payment or provider call.';
notify pgrst,'reload schema';
commit;
