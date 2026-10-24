-- A supervised bench does not autonomously lower an unallocated arm.
-- Customer cleanup and every previously issued dispatch remain unchanged.
begin;
create or replace function public._queue_idle_hardware_release(p_bay_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.hardware_controls%rowtype; o public.hardware_operations%rowtype; v_id uuid;
begin
  select x.* into c from public.hardware_controls x where x.bay_id=p_bay_id for update;
  if not found or c.reservation_id is not null then raise exception 'HARDWARE_NOT_IDLE'; end if;
  if c.supervised_test_enabled and exists(
    select 1 from public.bookable_bays b join public.bay_connectors x on x.bay_id=b.id
    where b.id=p_bay_id and b.integration_mode='ecurious' and b.ecurious_lock_id='lock-0002'
      and b.enabled and x.enabled and x.connector_type='BARRIER_TEST' and x.power_kw=0
  ) then
    return null; -- No autonomous idle command; no operation/phase/evidence reset.
  end if;
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
comment on function public._queue_idle_hardware_release(uuid) is
  'Normal durable idle lowering is unchanged. Explicit supervised lock-0002 barrier-only enrollment suppresses new autonomous idle commands; existing ledger rows/dispatches and customer cleanup are never cancelled or freed here.';
notify pgrst,'reload schema';
commit;
