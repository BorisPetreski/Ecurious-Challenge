import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PROJECT_REF, SetupError, createManagementClient, inspectSetup,
  loadSetupMigrations, validateSetupEnvironment,
} from './setup-supabase.mjs';

// These are application inventory IDs for the user-selected real barrier.
// No public charger, coordinates, directory mapping or electrical rating is invented.
export const BARRIER_TEST = Object.freeze({
  lockId: 'lock-0002',
  locationId: 'b2a00000-0000-4000-8000-000000000002',
  bayId: 'b2a00000-0000-4000-8000-000000000102',
  connectorId: 'b2a00000-0000-4000-8000-000000000202',
  locationLabel: 'Ecurious barrier-only test',
  bayLabel: 'Ecurious barrier-only test · lock-0002',
  connectorLabel: 'Barrier test interface · no charger',
});
const REQUIRED_VERSION = '20261024220000';
const literal = value => `'${String(value).replaceAll("'", "''")}'`;

export function parseEnrollmentArguments(args) {
  let mode = '--preview';
  let selectedMode = false;
  let lockId;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (['--preview', '--apply'].includes(argument) && !selectedMode) {
      mode = argument;
      selectedMode = true;
    } else if (argument === '--lock-id' && lockId === undefined) {
      lockId = args[++index];
    } else {
      throw new SetupError('Use --lock-id lock-0002 with optional --preview or --apply.');
    }
  }
  if (lockId !== BARRIER_TEST.lockId) throw new SetupError('This enrollment command is restricted to the explicitly selected lock-0002.');
  return { mode, lockId };
}

export function enrollmentStateQuery() {
  const t = BARRIER_TEST;
  return `with facts as (
    select
      exists(select 1 from public.charging_locations l where l.id=${literal(t.locationId)}::uuid) as location_exists,
      exists(select 1 from public.bookable_bays b where b.id=${literal(t.bayId)}::uuid) as bay_exists,
      exists(select 1 from public.bay_connectors x where x.id=${literal(t.connectorId)}::uuid) as connector_exists,
      exists(select 1 from public.hardware_controls c where c.bay_id=${literal(t.bayId)}::uuid) as control_exists,
      exists(select 1 from public.charging_locations l where l.id=${literal(t.locationId)}::uuid
        and l.label=${literal(t.locationLabel)} and l.goingelectric_id is null and l.latitude is null and l.longitude is null) as location_exact,
      exists(select 1 from public.bookable_bays b where b.id=${literal(t.bayId)}::uuid
        and b.location_id=${literal(t.locationId)}::uuid and b.label=${literal(t.bayLabel)} and b.integration_mode='ecurious'
        and b.ecurious_lock_id=${literal(t.lockId)} and b.enabled) as bay_exact,
      exists(select 1 from public.bay_connectors x where x.id=${literal(t.connectorId)}::uuid
        and x.bay_id=${literal(t.bayId)}::uuid and x.label=${literal(t.connectorLabel)}
        and x.connector_type='BARRIER_TEST' and x.power_kw=0 and x.enabled) as connector_exact,
      exists(select 1 from public.hardware_controls c where c.bay_id=${literal(t.bayId)}::uuid
        and not c.enabled and not c.interlocks_confirmed and c.telemetry_max_age_ms=5000
        and c.phase='idle' and c.reservation_id is null and c.current_operation_id is null
        and not c.release_requested and not c.entry_requested) as control_exact_disabled,
      exists(select 1 from public.charging_locations l where l.label=${literal(t.locationLabel)} and l.id<>${literal(t.locationId)}::uuid)
        or exists(select 1 from public.bookable_bays b where b.ecurious_lock_id=${literal(t.lockId)} and b.id<>${literal(t.bayId)}::uuid)
        or exists(select 1 from public.bookable_bays b where b.location_id=${literal(t.locationId)}::uuid and b.id<>${literal(t.bayId)}::uuid)
        or exists(select 1 from public.bay_connectors x where x.bay_id=${literal(t.bayId)}::uuid and x.id<>${literal(t.connectorId)}::uuid)
        as conflicting_inventory,
      exists(select 1 from public.booking_reservations r where r.bay_id=${literal(t.bayId)}::uuid and r.status='held')
        or exists(select 1 from public.hardware_slot_bookings s where s.bay_id=${literal(t.bayId)}::uuid
          and s.status in ('scheduled','active','blocked','cancel_requested'))
        or exists(select 1 from public.hardware_operations o where o.bay_id=${literal(t.bayId)}::uuid
          and o.status in ('queued','claimed','dispatching','acknowledged','uncertain')) as active_or_unresolved
  ), decision as (
    select *,case
      when conflicting_inventory then 'CONFLICTING_INVENTORY'
      when active_or_unresolved then 'ACTIVE_OR_UNRESOLVED'
      when control_exists and not control_exact_disabled then 'CONTROL_NOT_DISABLED_OR_IDLE'
      when (location_exists and not location_exact) or (bay_exists and not bay_exact)
        or (connector_exists and not connector_exact) then 'EXISTING_SETUP_DIFFERS'
      when not location_exists and not bay_exists and not connector_exists and not control_exists then 'CREATE_DISABLED_TEST'
      when location_exact and bay_exact and connector_exact and control_exact_disabled then 'REUSE_DISABLED_TEST'
      else 'PARTIAL_ENROLLMENT'
    end as decision from facts
  ) select decision,case when decision='CREATE_DISABLED_TEST' then 'create'
      when decision='REUSE_DISABLED_TEST' then 'reuse' else 'refuse' end as action,
    location_exists,bay_exists,connector_exists,control_exists,conflicting_inventory,active_or_unresolved,control_exact_disabled
    from decision`;
}

export function buildEnrollmentTransaction(migrations) {
  if (migrations.length !== 11 || migrations.at(-1)?.version !== REQUIRED_VERSION) {
    throw new SetupError('All eleven reviewed migrations are required for barrier-test enrollment.');
  }
  const t = BARRIER_TEST;
  const versions = literal(JSON.stringify(migrations.map(item => item.version)));
  const checksums = migrations.map(item => `if not exists(select 1 from supabase_migrations.bayready_checksums
    where version=${literal(item.version)} and sha256=${literal(item.checksum)}) then raise exception 'TEST_ENROLLMENT_CHECKSUM_CHANGED'; end if;`).join('\n');
  return `begin;
    set local lock_timeout='5s'; set local statement_timeout='20s';
    select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bayready:enroll-barrier-test:lock-0002:v1',0));
    lock table supabase_migrations.schema_migrations,supabase_migrations.bayready_checksums in share mode;
    lock table public.charging_locations,public.bookable_bays,public.bay_connectors,public.hardware_controls,
      public.hardware_operations,public.booking_reservations,public.hardware_slot_bookings in share row exclusive mode;
    do $enroll_barrier_test$
    declare state jsonb;
    begin
      if (select coalesce(pg_catalog.jsonb_agg(version order by version),'[]'::jsonb) from supabase_migrations.schema_migrations)<>${versions}::jsonb
        or (select pg_catalog.count(*) from supabase_migrations.bayready_checksums)<>11 then raise exception 'TEST_ENROLLMENT_HISTORY_CHANGED'; end if;
      ${checksums}
      select pg_catalog.to_jsonb(x) into state from (${enrollmentStateQuery()}) x;
      if state->>'action'='refuse' then raise exception 'TEST_ENROLLMENT_REFUSED'; end if;
      if state->>'action'='create' then
        insert into public.charging_locations(id,label,goingelectric_id,latitude,longitude)
          values(${literal(t.locationId)}::uuid,${literal(t.locationLabel)},null,null,null);
        insert into public.bookable_bays(id,location_id,label,integration_mode,ecurious_lock_id,enabled)
          values(${literal(t.bayId)}::uuid,${literal(t.locationId)}::uuid,${literal(t.bayLabel)},'ecurious',${literal(t.lockId)},true);
        insert into public.bay_connectors(id,bay_id,label,connector_type,power_kw,enabled)
          values(${literal(t.connectorId)}::uuid,${literal(t.bayId)}::uuid,${literal(t.connectorLabel)},'BARRIER_TEST',0,true);
        insert into public.hardware_controls(bay_id,enabled,interlocks_confirmed,telemetry_max_age_ms)
          values(${literal(t.bayId)}::uuid,false,false,5000);
      end if;
    end;
    $enroll_barrier_test$;
    commit;
    ${enrollmentStateQuery()};`;
}

function projectState(rows) {
  const state = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  const decisions = ['CONFLICTING_INVENTORY', 'ACTIVE_OR_UNRESOLVED', 'CONTROL_NOT_DISABLED_OR_IDLE',
    'EXISTING_SETUP_DIFFERS', 'CREATE_DISABLED_TEST', 'REUSE_DISABLED_TEST', 'PARTIAL_ENROLLMENT'];
  const flags = ['location_exists', 'bay_exists', 'connector_exists', 'control_exists',
    'conflicting_inventory', 'active_or_unresolved', 'control_exact_disabled'];
  if (!state || !['create', 'reuse', 'refuse'].includes(state.action) || !decisions.includes(state.decision) ||
    !flags.every(key => typeof state[key] === 'boolean') ||
    state.action === 'create' && (state.decision !== 'CREATE_DISABLED_TEST' || flags.some(key => state[key])) ||
    state.action === 'reuse' && (state.decision !== 'REUSE_DISABLED_TEST' ||
      !flags.slice(0, 4).every(key => state[key]) || !state.control_exact_disabled || state.conflicting_inventory || state.active_or_unresolved) ||
    state.action === 'refuse' && ['CREATE_DISABLED_TEST', 'REUSE_DISABLED_TEST'].includes(state.decision)) {
    throw new SetupError('The enrollment state response was invalid; no provider body was printed.');
  }
  return { action: state.action, decision: state.decision };
}

export async function enrollHardwareTest({ args = [], env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const { mode } = parseEnrollmentArguments(args);
  const { token } = validateSetupEnvironment(env);
  const client = createManagementClient(token, fetchImpl);
  const migrations = await loadSetupMigrations();
  const inspection = await inspectSetup(client, migrations);
  const summary = {
    inspectedAt: inspection.inspectedAt, projectRef: PROJECT_REF, lockId: BARRIER_TEST.lockId, mode,
    locationId: BARRIER_TEST.locationId, bayId: BARRIER_TEST.bayId, connectorId: BARRIER_TEST.connectorId,
    interfaceType: 'BARRIER_TEST', powerKw: 0, requestedControlsEnabled: false, requestedInterlocksConfirmed: false,
    providerCommandsSent: false, backendActivationChanged: false,
  };
  const schemaReady = migrations.length === 11 && migrations.at(-1)?.version === REQUIRED_VERSION &&
    inspection.pendingVersions.length === 0 && inspection.projectStatus === 'ACTIVE_HEALTHY';
  if (!schemaReady) {
    if (mode === '--apply') throw new SetupError('Barrier-test enrollment requires all eleven exact hosted migrations and a healthy project.');
    return { ...summary, ready: false, mutated: false, decision: 'SCHEMA_NOT_READY', pendingVersions: inspection.pendingVersions };
  }
  const read = () => client('/database/query', { method: 'POST', body: { read_only: true, query: enrollmentStateQuery() } });
  const before = projectState(await read());
  if (mode === '--preview') return { ...summary, ...before, ready: before.action !== 'refuse', mutated: false };
  if (before.action === 'refuse') throw new SetupError(`Barrier-test enrollment refused: ${before.decision}. Existing setup was not changed.`);
  // Reuse is already fully verified by the read-only state query. No write is needed.
  if (before.action === 'reuse') return { ...summary, ...before, ready: true, mutated: false, controlsEnabled: false, interlocksConfirmed: false };
  await client('/database/query', { method: 'POST', body: { read_only: false, query: buildEnrollmentTransaction(migrations) } });
  const after = projectState(await read());
  if (after.action !== 'reuse') throw new SetupError('Disabled test enrollment could not be verified. Inspect state before another write.');
  return { ...summary, ready: true, mutated: true, action: 'enrolled-or-reused', decision: 'REUSE_DISABLED_TEST', controlsEnabled: false, interlocksConfirmed: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await enrollHardwareTest({ args: process.argv.slice(2) }), null, 2));
  } catch (error) {
    console.error(error instanceof SetupError ? error.message : 'Barrier-test enrollment failed. Inspect state; no secret or provider error body was printed.');
    process.exitCode = 1;
  }
}
