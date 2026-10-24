import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

// Only synthetic data enters this isolated PostgreSQL instance. This script
// never reads .env, connects to Supabase, publishes ports, or moves hardware.
const root = new URL('../', import.meta.url);
const ownerToken = randomUUID();
const containerName = `bayready-reservations-test-${process.pid}-${ownerToken.slice(0, 8)}`;
const ownerLabel = 'com.bayready.test.owner';
const image = 'postgres:17-alpine';
const bookingOptionsOnly = process.argv.includes('--booking-options-only');
const arrivalGraceOnly = process.argv.includes('--arrival-grace-only');
const multiCarOnly = process.argv.includes('--multi-car-only');
const privacyOnly = process.argv.includes('--privacy-only');
const barrierTestOnly = process.argv.includes('--barrier-test-only');
const waitForTelemetryOnly = process.argv.includes('--wait-for-telemetry-only');
const focusedOnly = bookingOptionsOnly || arrivalGraceOnly || multiCarOnly || privacyOnly || barrierTestOnly || waitForTelemetryOnly;
const activeChildren = new Set();
let interrupted = false;
let cleaningUp = false;

function interrupt() {
  interrupted = true;
  if (!cleaningUp) for (const child of activeChildren) child.kill('SIGTERM');
}
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);

function command(args, { input = '', marker, timeoutMs = 15000 } = {}) {
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  activeChildren.add(child);
  let stdout = '';
  let stderr = '';
  let spawnError;
  let timedOut = false;
  let ended = false;
  let markerFound = false;
  let resolveMarker;
  let rejectMarker;
  const markerSeen = marker && new Promise((resolve, reject) => {
    resolveMarker = resolve;
    rejectMarker = reject;
  });
  // A process may fail before its caller starts waiting for the marker.
  markerSeen?.catch(() => {});

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    rejectMarker?.(new Error('Database test command timed out.'));
  }, timeoutMs);

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    if (stdout.length > 1024 * 1024) child.kill('SIGTERM');
    if (marker && !markerFound && stdout.split(/\r?\n/).includes(marker)) {
      markerFound = true;
      resolveMarker();
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
    if (stderr.length > 1024 * 1024) child.kill('SIGTERM');
  });
  child.on('error', (error) => {
    spawnError = error;
    rejectMarker?.(error);
  });
  child.stdin.on('error', () => {}); // Early psql errors can close stdin first.
  child.stdin.end(input);

  const done = new Promise((resolve) => {
    child.on('close', (code, signal) => {
      ended = true;
      activeChildren.delete(child);
      clearTimeout(timer);
      if (marker && !markerFound) rejectMarker(new Error('The reservation client exited before acquiring its lock.'));
      resolve({ code, signal, stdout, stderr, spawnError, timedOut });
    });
  });
  return { done, markerSeen, get ended() { return ended; } };
}

function requireSuccess(result, description) {
  if (result.code === 0 && !result.spawnError && !result.timedOut) return result.stdout;
  const detail = result.spawnError?.message || result.stderr.trim() || `exit ${result.code}`;
  throw new Error(`${description}: ${detail}`);
}

async function docker(args, description, options) {
  return requireSuccess(await command(args, options).done, description);
}

function psql(sql, options = {}) {
  return command([
    'exec', '-i', containerName,
    'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq',
  ], { ...options, input: sql });
}

async function executeSql(sql, description) {
  return requireSuccess(await psql(sql).done, description);
}

function jsonResult(output) {
  const rows = output.split(/\r?\n/).filter((line) => line.startsWith('{'));
  assert.equal(rows.length, 1, 'Expected exactly one JSON result from the test client.');
  return JSON.parse(rows[0]);
}

function reservationSql({ owner, bay, request, connector, marker }) {
  // These values are fixed fictional UUIDs below, never external input.
  return `
    begin;
    set local role authenticated;
    set local "request.jwt.claim.sub" = '${owner}';
    select public.reserve_bay('${bay}', 10, '${request}', '${connector}');
    ${marker ? `select '${marker}'; select pg_catalog.pg_sleep(1);` : ''}
    commit;
  `;
}

async function runRaces() {
  const ownerA = '71111111-1111-4111-8111-111111111111';
  const ownerB = '72222222-2222-4222-8222-222222222222';
  const competingBay = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const retryBay = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  const requestA = '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  const requestB = '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  const retryRequest = '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
  const location = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa100';
  const competingConnectorA = '7ccccccc-cccc-4ccc-8ccc-ccccccccccc1';
  const competingConnectorB = '7ccccccc-cccc-4ccc-8ccc-ccccccccccc2';
  const retryConnector = '7ccccccc-cccc-4ccc-8ccc-ccccccccccc3';

  await executeSql(`
    insert into auth.users(id) values ('${ownerA}'), ('${ownerB}');
    insert into public.charging_locations(id, label) values ('${location}', 'Fictional race location');
    insert into public.bookable_bays(id, location_id, label, integration_mode, enabled) values
      ('${competingBay}', '${location}', 'Fictional race test bay', 'demo', true),
      ('${retryBay}', '${location}', 'Fictional idempotency test bay', 'demo', true);
    insert into public.bay_connectors(id, bay_id, label, connector_type, power_kw, enabled) values
      ('${competingConnectorA}', '${competingBay}', 'Race bay CCS', 'CCS', 150, true),
      ('${competingConnectorB}', '${competingBay}', 'Race bay Type 2', 'Typ2', 22, true),
      ('${retryConnector}', '${retryBay}', 'Retry bay CCS', 'CCS', 150, true);
  `, 'Create fictional race fixtures');

  const first = psql(reservationSql({
    owner: ownerA, bay: competingBay, request: requestA, connector: competingConnectorA, marker: 'BAYREADY_COMPETING_LOCK_HELD',
  }), { marker: 'BAYREADY_COMPETING_LOCK_HELD' });
  await first.markerSeen;
  assert.equal(first.ended, false, 'The first client must still hold its transaction lock.');
  const second = psql(reservationSql({ owner: ownerB, bay: competingBay, request: requestB, connector: competingConnectorB }));
  const [firstResult, secondResult] = await Promise.all([first.done, second.done]);
  const winningHold = jsonResult(requireSuccess(firstResult, 'First competing reservation'));
  assert.notEqual(secondResult.code, 0, 'The competing client must fail.');
  assert.match(secondResult.stderr, /BAY_RESERVED/, 'The competing client must receive BAY_RESERVED.');
  const competingRows = jsonResult(await executeSql(`
    select pg_catalog.jsonb_build_object(
      'count', pg_catalog.count(*),
      'held', pg_catalog.count(*) filter (where status = 'held'),
      'winner', pg_catalog.bool_and(owner_id = '${ownerA}'::uuid)
    ) from public.booking_reservations where bay_id = '${competingBay}';
  `, 'Verify competing reservation rows'));
  assert.deepEqual(competingRows, { count: 1, held: 1, winner: true });
  assert.equal(winningHold.status, 'held');
  assert.equal(winningHold.connectorId, competingConnectorA);
  console.log('PASS competing clients on different connectors: one bay hold; second request rejected');

  const original = psql(reservationSql({
    owner: ownerA, bay: retryBay, request: retryRequest, connector: retryConnector, marker: 'BAYREADY_RETRY_LOCK_HELD',
  }), { marker: 'BAYREADY_RETRY_LOCK_HELD' });
  await original.markerSeen;
  assert.equal(original.ended, false, 'The original request must still hold its transaction lock.');
  const retry = psql(reservationSql({ owner: ownerA, bay: retryBay, request: retryRequest, connector: retryConnector }));
  const [originalResult, retryResult] = await Promise.all([original.done, retry.done]);
  const originalHold = jsonResult(requireSuccess(originalResult, 'Original idempotent request'));
  const retriedHold = jsonResult(requireSuccess(retryResult, 'Concurrent idempotent retry'));
  assert.deepEqual(retriedHold, originalHold, 'Concurrent retry must preserve ID and every timestamp.');
  const retryRows = jsonResult(await executeSql(`
    select pg_catalog.jsonb_build_object(
      'count', pg_catalog.count(*),
      'held', pg_catalog.count(*) filter (where status = 'held')
    ) from public.booking_reservations where bay_id = '${retryBay}';
  `, 'Verify idempotent reservation rows'));
  assert.deepEqual(retryRows, { count: 1, held: 1 });
  console.log('PASS concurrent retry: same reservation and deadline; one row');
}

function directoryReservationSql({ owner, station, slot, request, marker, holdSeconds = 1 }) {
  return `
    begin;
    set local role authenticated;
    set local "request.jwt.claim.sub" = '${owner}';
    select public.reserve_directory_plug(${station}, '${slot}', 10, '${request}');
    ${marker ? `select '${marker}'; select pg_catalog.pg_sleep(${holdSeconds});` : ''}
    commit;
  `;
}

async function runDirectoryRaces() {
  const ownerA = '81111111-1111-4111-8111-111111111111';
  const ownerB = '82222222-2222-4222-8222-222222222222';
  const slotA = 'a'.repeat(64);
  const slotB = 'b'.repeat(64);
  const slotC = 'c'.repeat(64);
  const slotD = 'd'.repeat(64);
  const requestA = '8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  const requestB = '8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  const requestC = '8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
  const requestD = '8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4';
  const retryRequest = '8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5';
  await executeSql(`insert into auth.users(id) values ('${ownerA}'), ('${ownerB}');`, 'Create directory race guests');

  const first = psql(directoryReservationSql({
    owner: ownerA, station: 7001, slot: slotA, request: requestA, marker: 'DIRECTORY_SLOT_LOCK_HELD',
  }), { marker: 'DIRECTORY_SLOT_LOCK_HELD' });
  await first.markerSeen;
  assert.equal(first.ended, false);
  const second = psql(directoryReservationSql({ owner: ownerB, station: 7001, slot: slotA, request: requestB }));
  const [firstResult, secondResult] = await Promise.all([first.done, second.done]);
  const firstHold = jsonResult(requireSuccess(firstResult, 'First directory plug hold'));
  assert.notEqual(secondResult.code, 0);
  assert.match(secondResult.stderr, /PLUG_RESERVED/);
  const exclusiveRows = jsonResult(await executeSql(`
    select pg_catalog.jsonb_build_object('count',count(*),'held',count(*) filter (where status='held'))
    from public.directory_plug_reservations where station_id=7001 and slot_key='${slotA}';
  `, 'Verify directory slot exclusivity'));
  assert.deepEqual(exclusiveRows, { count: 1, held: 1 });
  console.log('PASS directory same-plug race: one hold; competing user rejected');

  const independentFirst = psql(directoryReservationSql({
    owner: ownerA, station: 7002, slot: slotB, request: requestC,
    marker: 'DIRECTORY_INDEPENDENT_LOCK_HELD', holdSeconds: 2,
  }), { marker: 'DIRECTORY_INDEPENDENT_LOCK_HELD' });
  await independentFirst.markerSeen;
  const independentSecond = psql(directoryReservationSql({ owner: ownerB, station: 7002, slot: slotC, request: requestD }));
  requireSuccess(await independentSecond.done, 'Independent directory plug');
  assert.equal(independentFirst.ended, false, 'An independent plug must commit while the first plug is still locked.');
  requireSuccess(await independentFirst.done, 'First independent directory plug');
  const independentRows = jsonResult(await executeSql(`
    select pg_catalog.jsonb_build_object('held',count(*) filter (where status='held'))
    from public.directory_plug_reservations where station_id=7002;
  `, 'Verify independent directory slots'));
  assert.deepEqual(independentRows, { held: 2 });
  console.log('PASS directory independent plugs: both users commit concurrently');

  const original = psql(directoryReservationSql({
    owner: ownerA, station: 7003, slot: slotD, request: retryRequest, marker: 'DIRECTORY_RETRY_LOCK_HELD',
  }), { marker: 'DIRECTORY_RETRY_LOCK_HELD' });
  await original.markerSeen;
  const retry = psql(directoryReservationSql({ owner: ownerA, station: 7003, slot: slotD, request: retryRequest }));
  const [originalResult, retryResult] = await Promise.all([original.done, retry.done]);
  const originalHold = jsonResult(requireSuccess(originalResult, 'Original directory request'));
  assert.deepEqual(jsonResult(requireSuccess(retryResult, 'Concurrent directory retry')), originalHold);
  const retryRows = jsonResult(await executeSql(`
    select pg_catalog.jsonb_build_object('count',count(*)) from public.directory_plug_reservations where station_id=7003;
  `, 'Verify directory retry count'));
  assert.deepEqual(retryRows, { count: 1 });
  console.log('PASS directory identical retry: one reservation and unchanged deadline');

  assert.match(firstHold.id, /^[0-9a-f-]{36}$/i);
  const cancellation = jsonResult(await executeSql(`
    begin;
    set local role authenticated;
    set local "request.jwt.claim.sub"='${ownerA}';
    select public.cancel_directory_hold('${firstHold.id}');
    commit;
  `, 'Cancel an owned directory hold'));
  assert.equal(cancellation.status, 'cancelled');
  const afterCancellation = jsonResult(await executeSql(`
    begin;
    set local role authenticated;
    set local "request.jwt.claim.sub"='${ownerB}';
    select public.list_directory_holds(array[7001]::bigint[]);
    commit;
  `, 'Read directory status after cancellation'));
  assert.equal(afterCancellation.holds.some(hold => hold.stationId === 7001), false);
  console.log('PASS directory owner cancellation: other users see the slot unreserved');
}

async function runHardwareRaces() {
  const ownerA='a1111111-1111-4111-8111-111111111111';
  const ownerB='a2222222-2222-4222-8222-222222222222';
  const location='a0000000-0000-4000-8000-000000000100';
  const bay='a0000000-0000-4000-8000-000000000001';
  const connectorA='a0000000-0000-4000-8000-000000000011';
  const connectorB='a0000000-0000-4000-8000-000000000012';
  const workerA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const workerB='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  await executeSql(`
    insert into auth.users(id) values('${ownerA}'),('${ownerB}');
    insert into public.charging_locations(id,label) values('${location}','Fictional workflow race location');
    insert into public.bookable_bays(id,location_id,label,integration_mode,ecurious_lock_id,enabled)
      values('${bay}','${location}','Fictional workflow race bay','ecurious','fictional-workflow-race-lock',true);
    insert into public.bay_connectors(id,bay_id,label,connector_type,power_kw,enabled) values
      ('${connectorA}','${bay}','Race CCS','CCS',150,true),('${connectorB}','${bay}','Race Type2','Typ2',22,true);
    insert into public.hardware_controls(bay_id,enabled,interlocks_confirmed) values('${bay}',true,true);
  `,'Create fictional hardware race fixture');

  const userSql=(owner,connector,request,marker)=>`
    begin; set local role authenticated; set local "request.jwt.claim.sub"='${owner}';
    select public.request_hardware_reservation('${bay}','${connector}',10,'${request}');
    ${marker ? `select '${marker}'; select pg_sleep(1);` : ''} commit;`;
  const first=psql(userSql(ownerA,connectorA,'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','HARDWARE_RESERVATION_LOCKED'),{marker:'HARDWARE_RESERVATION_LOCKED'});
  await first.markerSeen;
  const second=psql(userSql(ownerB,connectorB,'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'));
  const [firstResult,secondResult]=await Promise.all([first.done,second.done]);
  const workflow=jsonResult(requireSuccess(firstResult,'First hardware intent'));
  assert.notEqual(secondResult.code,0);
  assert.match(secondResult.stderr,/HARDWARE_UNAVAILABLE/);
  const operationId=workflow.operation.id;
  assert.match(operationId,/^[0-9a-f-]{36}$/i);
  const claimSql=(worker,marker)=>`
    begin; set local role service_role;
    select public.claim_hardware_operation('${worker}','${operationId}');
    ${marker ? `select '${marker}'; select pg_sleep(1);` : ''} commit;`;
  const firstClaim=psql(claimSql(workerA,'HARDWARE_CLAIM_LOCKED'),{marker:'HARDWARE_CLAIM_LOCKED'});
  await firstClaim.markerSeen;
  const secondClaim=psql(claimSql(workerB));
  const [claimedResult,unclaimedResult]=await Promise.all([firstClaim.done,secondClaim.done]);
  const claimed=jsonResult(requireSuccess(claimedResult,'First worker claim'));
  assert.equal(requireSuccess(unclaimedResult,'Competing worker claim').trim(),'');
  assert.match(claimed.claimToken,/^[0-9a-f-]{36}$/i);
  const dispatchSql=(marker)=>`
    begin; set local role service_role;
    select public.mark_hardware_dispatch('${operationId}','${claimed.claimToken}',clock_timestamp(),'lowered','vacant',false,'disabled');
    ${marker ? `select '${marker}'; select pg_sleep(1);` : ''} commit;`;
  const firstPermit=psql(dispatchSql('HARDWARE_DISPATCH_LOCKED'),{marker:'HARDWARE_DISPATCH_LOCKED'});
  await firstPermit.markerSeen;
  const secondPermit=psql(dispatchSql());
  const [permitResult,deniedResult]=await Promise.all([firstPermit.done,secondPermit.done]);
  assert.equal(jsonResult(requireSuccess(permitResult,'First dispatch permit')).status,'dispatching');
  assert.notEqual(deniedResult.code,0);
  assert.match(deniedResult.stderr,/HARDWARE_CLAIM_INVALID/);
  const rows=jsonResult(await executeSql(`
    select jsonb_build_object('holds',(select count(*) from public.booking_reservations where bay_id='${bay}' and status='held'),
      'operations',(select count(*) from public.hardware_operations where bay_id='${bay}'),
      'dispatches',(select count(*) from public.hardware_operations where bay_id='${bay}' and dispatched_at is not null));
  `,'Verify hardware admission/dispatch race rows'));
  assert.deepEqual(rows,{holds:1,operations:1,dispatches:1});
  console.log('PASS hardware races: one owner, one worker claim, one durable dispatch permit; no hardware called');
}

async function runHardwareSlotRaces() {
  // Reuse the registered fictional race bay. Scheduling an hour ahead must
  // not mutate its currently quarantined physical operation.
  const bay = 'a0000000-0000-4000-8000-000000000001';
  const ownerA = 'a1111111-1111-4111-8111-111111111111';
  const ownerB = 'a2222222-2222-4222-8222-222222222222';
  const connectorA = 'a0000000-0000-4000-8000-000000000011';
  const connectorB = 'a0000000-0000-4000-8000-000000000012';
  const firstStart = new Date(Date.now() + 3600_000).toISOString();
  const firstEnd = new Date(Date.parse(firstStart) + 10 * 60_000).toISOString();
  const request = 'accccccc-cccc-4ccc-8ccc-ccccccccccc1';
  const sql = (owner, connector, key, start, end, marker) => `
    begin; set local role authenticated; set local "request.jwt.claim.sub"='${owner}';
    select public.request_hardware_slot('${bay}','${connector}','${start}','${end}','${key}','${'a'.repeat(64)}','•••11');
    ${marker ? `select '${marker}'; select pg_sleep(1);` : ''} commit;`;
  const first = psql(sql(ownerA, connectorA, request, firstStart, firstEnd, 'SCHEDULE_LOCKED'), { marker: 'SCHEDULE_LOCKED' });
  await first.markerSeen;
  const competitor = psql(sql(ownerB, connectorB, 'accccccc-cccc-4ccc-8ccc-ccccccccccc2', firstStart, firstEnd));
  const [won, lost] = await Promise.all([first.done, competitor.done]);
  const original = jsonResult(requireSuccess(won, 'First scheduled reservation')).slot;
  assert.notEqual(lost.code, 0);
  assert.match(lost.stderr, /SLOT_RESERVED/);

  const nextStart = new Date(Date.parse(firstEnd) + 10 * 60_000).toISOString();
  const nextEnd = new Date(Date.parse(nextStart) + 10 * 60_000).toISOString();
  const retryKey = 'accccccc-cccc-4ccc-8ccc-ccccccccccc3';
  const retryFirst = psql(sql(ownerA, connectorA, retryKey, nextStart, nextEnd, 'SCHEDULE_RETRY_LOCKED'), { marker: 'SCHEDULE_RETRY_LOCKED' });
  await retryFirst.markerSeen;
  const retrySecond = psql(sql(ownerA, connectorA, retryKey, nextStart, nextEnd));
  const [one, two] = await Promise.all([retryFirst.done, retrySecond.done]);
  const bookingOne = jsonResult(requireSuccess(one, 'First scheduled retry')).slot;
  const bookingTwo = jsonResult(requireSuccess(two, 'Concurrent scheduled retry')).slot;
  assert.equal(bookingOne.id, bookingTwo.id);
  assert.equal(Date.parse(bookingOne.startsAt), Date.parse(nextStart));
  assert.equal(bookingOne.endsAt, bookingTwo.endsAt);
  assert.notEqual(bookingOne.id, original.id);
  const counts = jsonResult(await executeSql(`select jsonb_build_object(
    'scheduled',(select count(*) from public.hardware_slot_bookings where bay_id='${bay}' and source='scheduled'),
    'operations',(select count(*) from public.hardware_operations where bay_id='${bay}'));`, 'Verify schedule race rows'));
  assert.deepEqual(counts, { scheduled: 2, operations: 1 });
  console.log('PASS scheduled-slot races: whole-bay exclusion across plugs; identical retry preserves one window; no early operation');
}

async function runMultiCarRace() {
  const ownerA = 'e1111111-1111-4111-8111-111111111111';
  const ownerB = 'e2222222-2222-4222-8222-222222222222';
  const location = 'e0000000-0000-4000-8000-000000000100';
  const bay = 'e0000000-0000-4000-8000-000000000001';
  const connectorA = 'e0000000-0000-4000-8000-000000000011';
  const connectorB = 'e0000000-0000-4000-8000-000000000012';
  const startsAt = new Date(Date.now() + 3600_000).toISOString();
  const endsAt = new Date(Date.parse(startsAt) + 600_000).toISOString();
  await executeSql(`
    insert into auth.users(id) values ('${ownerA}'), ('${ownerB}');
    insert into public.charging_locations(id,label) values ('${location}','Fictional two-car race');
    insert into public.bookable_bays(id,location_id,label,integration_mode,ecurious_lock_id,enabled)
      values ('${bay}','${location}','Fictional shared parking bay','ecurious','fictional-two-car-race',true);
    insert into public.bay_connectors(id,bay_id,label,connector_type,power_kw,enabled) values
      ('${connectorA}','${bay}','Fictional CCS 1','CCS',150,true),
      ('${connectorB}','${bay}','Fictional CCS 2','CCS',150,true);
    insert into public.hardware_controls(bay_id,enabled,interlocks_confirmed) values ('${bay}',true,true);
  `, 'Create distinct fictional drivers and one two-connector bay');
  const request = (owner, connector, key, fingerprint, marker) => `
    begin;
    set local role authenticated;
    set local "request.jwt.claim.sub"='${owner}';
    select public.request_hardware_slot('${bay}','${connector}','${startsAt}','${endsAt}',
      '${key}','${fingerprint.repeat(64)}','•••${fingerprint === 'a' ? '11' : '22'}','scheduled');
    ${marker ? `select '${marker}'; select pg_catalog.pg_sleep(1);` : ''}
    commit;`;
  const first = psql(request(ownerA, connectorA, 'eeeeeeee-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'a', 'TWO_CAR_WINDOW_LOCKED'),
    { marker: 'TWO_CAR_WINDOW_LOCKED' });
  await first.markerSeen;
  assert.equal(first.ended, false, 'Driver A must still hold the transaction when driver B starts.');
  const second = psql(request(ownerB, connectorB, 'eeeeeeee-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'b'));
  const [won, lost] = await Promise.all([first.done, second.done]);
  const slotA = jsonResult(requireSuccess(won, 'Driver A scheduled booking')).slot;
  assert.notEqual(lost.code, 0, 'Driver B must lose the overlapping whole-bay race.');
  assert.match(lost.stderr, /SLOT_RESERVED/);
  const snapshot = jsonResult(await executeSql(`select jsonb_build_object(
    'slots',(select count(*) from public.hardware_slot_bookings where bay_id='${bay}'),
    'correctOwnerAndCar',(select bool_and(owner_id='${ownerA}'::uuid and plate_hash=repeat('a',64))
      from public.hardware_slot_bookings where bay_id='${bay}'),
    'physicalAllocations',(select count(*) from public.booking_reservations where bay_id='${bay}'),
    'operations',(select count(*) from public.hardware_operations where bay_id='${bay}'));`,
  'Verify two-car race and absence of early physical operations'));
  assert.deepEqual(snapshot, { slots: 1, correctOwnerAndCar: true, physicalAllocations: 0, operations: 0 });
  await executeSql(`begin; set local role authenticated; set local "request.jwt.claim.sub"='${ownerA}';
    select public.cancel_hardware_slot('${slotA.id}'); commit;`, 'Driver A cancels the unactivated future window');
  const slotB = jsonResult(await executeSql(request(ownerB, connectorB,
    'eeeeeeee-bbbb-4bbb-8bbb-bbbbbbbbbbb3', 'b'), 'Driver B books after owner cancellation')).slot;
  assert.equal(slotB.connectorId, connectorB);
  assert.notEqual(slotB.id, slotA.id);
  console.log('PASS two real PostgreSQL sessions: distinct drivers/cars compete across one bay’s plugs; one winner, no early hardware, next owner succeeds after cancellation');
}

let failure;
try {
  await docker(['image', 'inspect', image], `Cached Docker image ${image} is required; run docker pull ${image}`);
  await docker([
    'run', '--detach', '--rm', '--pull=never', '--network', 'none',
    '--tmpfs', '/var/lib/postgresql/data:rw',
    '--env', 'POSTGRES_HOST_AUTH_METHOD=trust',
    '--label', `${ownerLabel}=${ownerToken}`, '--name', containerName, image,
  ], 'Start isolated PostgreSQL');

  const readyDeadline = Date.now() + 10000;
  let ready = false;
  while (Date.now() < readyDeadline && !interrupted) {
    // initdb briefly starts a temporary server. Wait for the final postgres
    // process to become PID 1 before accepting readiness from pg_isready.
    const processName = await command(['exec', containerName, 'cat', '/proc/1/comm'], { timeoutMs: 2000 }).done;
    if (processName.code === 0 && processName.stdout.trim() === 'postgres') {
      const result = await command(['exec', containerName, 'pg_isready', '-U', 'postgres', '-d', 'postgres'], { timeoutMs: 2000 }).done;
      if (result.code === 0) { ready = true; break; }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Isolated PostgreSQL did not become ready.');
  if (interrupted) throw new Error('Database tests interrupted.');

  await executeSql(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema public, auth to anon, authenticated;
  `, 'Create local Supabase authentication shims');

  const migrationDirectory = new URL('supabase/migrations/', root);
  const migrations = (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql')).sort();
  assert.ok(migrations.length, 'No database migrations found.');
  for (const migration of migrations) {
    await executeSql(await readFile(new URL(migration, migrationDirectory), 'utf8'), `Apply ${migration}`);
    if (!focusedOnly && migration === '20261024120000_bayready_reservations.sql') {
      await executeSql(await readFile(new URL('supabase/tests/reservation_contract.sql', root), 'utf8'), 'Original reservation SQL contract assertions');
      await executeSql(await readFile(new URL('supabase/tests/pre_hierarchy_fixture.sql', root), 'utf8'), 'Seed fictional upgrade history');
    }
    if (!focusedOnly && migration === '20261024170000_plate_arrival_deadline.sql') {
      await executeSql(await readFile(new URL('supabase/tests/hardware_slots_contract.sql', root), 'utf8'), 'Original scheduled-slot lifecycle before option upgrade');
    }
    if (!focusedOnly && migration === '20261024140000_directory_plug_holds.sql') {
      await executeSql(await readFile(new URL('supabase/tests/directory_contract.sql', root), 'utf8'), 'Original variable-duration directory holds before option upgrade');
    }
    if (!arrivalGraceOnly && !multiCarOnly && !privacyOnly && !barrierTestOnly && !waitForTelemetryOnly && migration === '20261024180000_booking_options.sql') {
      await executeSql(await readFile(new URL('supabase/tests/booking_options_contract.sql', root), 'utf8'), 'Fixed-price booking options and safe physical fallback');
    }
    if (!focusedOnly && migration === '20261024190000_directory_booking_options.sql') {
      await executeSql(await readFile(new URL('supabase/tests/hardware_contract.sql', root), 'utf8'), 'Original durable hardware workflow contract');
    }
  }
  if (!bookingOptionsOnly && !multiCarOnly && !privacyOnly && !barrierTestOnly && !waitForTelemetryOnly) await executeSql(await readFile(new URL('supabase/tests/arrival_grace_contract.sql', root), 'utf8'), 'Arrival grace and accepted matching-entry retention');
  if (waitForTelemetryOnly || !focusedOnly) {
    await executeSql(await readFile(new URL('supabase/tests/wait_for_device_telemetry_contract.sql', root), 'utf8'),
      'Pending intents during unknown telemetry and unchanged fresh/full guards');
    console.log('PASS telemetry-wait SQL: stale intents stay pending; fresh safe activation/fallback and known-full refund preserved');
  }
  if (barrierTestOnly || !focusedOnly) {
    await executeSql(await readFile(new URL('supabase/tests/barrier_test_contract.sql', root), 'utf8'),
      'Barrier-only interface constraints, default-disabled enrollment and durable session');
    console.log('PASS barrier-test SQL: explicit0kW exception, real-power constraints and unchanged guarded lifecycle; no hardware called');
  }
  if (privacyOnly || !focusedOnly) {
    await executeSql(await readFile(new URL('supabase/tests/privacy_contract.sql', root), 'utf8'),
      'Owner-scoped export, idempotent erasure intake and unchanged physical/Auth state');
    console.log('PASS privacy SQL: owner-isolated exports, private permissions, idempotent review request; Auth and physical guards unchanged');
  }
  if (multiCarOnly || !focusedOnly) {
    await executeSql(await readFile(new URL('supabase/tests/multi_car_contract.sql', root), 'utf8'), 'Distinct drivers, plate matching, occupied-bay ownership and alternatives');
    console.log('PASS multi-car SQL: owner isolation, wrong/correct car, sensor departure, cleanup, fallback and mock refund');
    await runMultiCarRace();
  }
  if (!focusedOnly) await executeSql(await readFile(new URL('supabase/tests/directory_options_contract.sql', root), 'utf8'), 'Directory booking options');
  if (!focusedOnly) {
  await executeSql(
    await readFile(new URL('supabase/tests/hierarchy_contract.sql', root), 'utf8'),
    'Location, bay and connector SQL assertions',
  );
  console.log('PASS migrations, auth/permissions, ownership, cancellation, expiry, and validation');
  await runRaces();
  await runDirectoryRaces();
  await runHardwareRaces();
  await runHardwareSlotRaces();
  } else console.log('PASS migrations and focused booking contracts; no hardware called');
} catch (error) {
  failure = error;
} finally {
  cleaningUp = true;
  // The label prevents cleanup from removing any container we did not create.
  const inspect = await command([
    'inspect', '--format', `{{ index .Config.Labels "${ownerLabel}" }}`, containerName,
  ], { timeoutMs: 3000 }).done;
  if (inspect.code === 0 && inspect.stdout.trim() === ownerToken) {
    const cleanup = await command(['rm', '--force', containerName], { timeoutMs: 5000 }).done;
    if (cleanup.code !== 0) failure ??= new Error(`Could not remove test container ${containerName}.`);
  }
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}

if (failure || interrupted) {
  console.error(failure?.message || 'Database tests interrupted.');
  process.exitCode = interrupted ? 130 : 1;
} else {
  console.log('PASS isolated database removed; no hosted project changed');
}
