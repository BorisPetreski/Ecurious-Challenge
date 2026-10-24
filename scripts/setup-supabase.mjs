import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const PROJECT_REF = 'omxqhwrfnyodmscmjfqm';
export const PROJECT_ORIGIN = `https://${PROJECT_REF}.supabase.co`;
const MANAGEMENT_ORIGIN = 'https://api.supabase.com';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSIONS = ['20261024120000', '20261024130000', '20261024140000', '20261024150000', '20261024160000', '20261024170000', '20261024180000', '20261024190000', '20261024200000', '20261024210000', '20261024220000', '20261024230000'];
const APP_TABLES = ['charging_locations', 'bookable_bays', 'bay_connectors', 'booking_reservations', 'directory_plug_reservations', 'directory_plug_extensions', 'hardware_controls', 'hardware_operations', 'hardware_slot_bookings', 'hardware_slot_extensions', 'privacy_erasure_requests'];
const sha256 = value => createHash('sha256').update(value).digest('hex');
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export class SetupError extends Error {
  constructor(message) { super(message); this.name = 'SetupError'; }
}

export function validateSetupEnvironment(env) {
  const token = env.SUPABASE_ACCESS_TOKEN?.trim();
  let url;
  try { url = new URL(env.SUPABASE_URL || PROJECT_ORIGIN); } catch { /* Fixed error below. */ }
  if (!url || url.origin !== PROJECT_ORIGIN || url.pathname !== '/' || url.username || url.password || url.search || url.hash) {
    throw new SetupError('Setup is restricted to the configured BayReady Supabase project origin.');
  }
  if (typeof token !== 'string' || !token || token.length > 8192 || /\s/.test(token)) {
    throw new SetupError('Add a valid SUPABASE_ACCESS_TOKEN to the backend .env before running setup.');
  }
  return { token };
}

export function createManagementClient(token, fetchImpl = globalThis.fetch) {
  return async (suffix, { method = 'GET', body } = {}) => {
    if (!['', '/config/auth', '/database/query', '/api-keys?reveal=true'].includes(suffix)) throw new SetupError('Unsupported setup management route.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetchImpl(`${MANAGEMENT_ORIGIN}/v1/projects/${PROJECT_REF}${suffix}`, {
        method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new SetupError(`Supabase setup request returned HTTP ${response.status}. No provider error body was printed. Inspect remote state before retrying a write.`);
      }
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body ?? []) {
        bytes += chunk.byteLength;
        if (bytes > 2 * 1024 * 1024) { controller.abort(); throw new SetupError('Supabase setup response exceeded its size bound. Inspect remote state before retrying.'); }
        chunks.push(chunk);
      }
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
        throw new SetupError('Supabase setup returned an unreadable result. Inspect remote state before retrying.');
      }
    } catch (error) {
      if (error instanceof SetupError) throw error;
      throw new SetupError('Supabase setup connection failed or timed out. A write may already have committed; inspect remote state before retrying.');
    } finally { clearTimeout(timeout); }
  };
}

export async function loadSetupMigrations(directory = resolve(ROOT, 'supabase/migrations')) {
  const files = (await readdir(directory)).filter(file => file.endsWith('.sql')).sort();
  const migrations = [];
  for (const file of files) {
    const match = /^(\d{14})_([a-z0-9_]+)\.sql$/.exec(file);
    if (!match || !VERSIONS.includes(match[1]) || migrations.some(item => item.version === match[1])) {
      throw new SetupError('The migration directory contains an unexpected or duplicate migration version.');
    }
    const source = await readFile(resolve(directory, file), 'utf8');
    const begins = [...source.matchAll(/^[ \t]*begin;[ \t]*$/gim)];
    const commits = [...source.matchAll(/^[ \t]*commit;[ \t]*$/gim)];
    if (begins.length !== 1 || commits.length !== 1 || commits[0].index <= begins[0].index) {
      throw new SetupError('Each setup migration must have exactly one outer BEGIN/COMMIT pair.');
    }
    const body = source.slice(0, begins[0].index) + source.slice(begins[0].index + begins[0][0].length, commits[0].index) + source.slice(commits[0].index + commits[0][0].length);
    if (/^[ \t]*(?:begin|commit|rollback);[ \t]*$/im.test(body)) throw new SetupError('Nested migration transaction boundaries are unsupported.');
    migrations.push({ version: match[1], name: match[2], checksum: sha256(source), body });
  }
  if (!migrations.length || migrations.some((item, index) => item.version !== VERSIONS[index])) throw new SetupError('Setup migrations must form the expected ordered prefix.');
  return migrations;
}

async function query(client, sql, readOnly = true) {
  const result = await client('/database/query', { method: 'POST', body: { query: sql, read_only: readOnly } });
  if (!Array.isArray(result)) throw new SetupError('The management query result was not a row array.');
  return result;
}

export async function inspectSetup(client, migrations) {
  const project = await client('');
  if (!record(project) || (project.ref ?? project.id) !== PROJECT_REF) throw new SetupError('The management response did not identify the authorized project.');
  const [auth, objects, extensions] = await Promise.all([
    client('/config/auth'),
    query(client, `select table_schema,table_name from information_schema.tables where table_schema in ('public','supabase_migrations') and table_name in (${[...APP_TABLES, 'schema_migrations', 'bayready_checksums'].map(literal).join(',')}) order by table_schema,table_name`),
    query(client, "select e.extname,n.nspname as schema from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid=e.extnamespace where e.extname='btree_gist'"),
  ]);
  if (!record(auth) || typeof auth.external_anonymous_users_enabled !== 'boolean' || typeof auth.disable_signup !== 'boolean' ||
    typeof auth.security_manual_linking_enabled !== 'boolean' || typeof auth.external_email_enabled !== 'boolean' || typeof auth.mailer_autoconfirm !== 'boolean' ||
    !objects.every(row => record(row) && ['public', 'supabase_migrations'].includes(row.table_schema) && typeof row.table_name === 'string') ||
    !extensions.every(row => record(row) && row.extname === 'btree_gist' && typeof row.schema === 'string')) {
    throw new SetupError('The remote setup metadata shape was invalid.');
  }
  if (extensions.some(row => row.schema !== 'extensions')) throw new SetupError('The existing btree_gist extension is outside the reviewed schema. Reconcile it before applying migrations.');
  const names = objects.map(row => `${row.table_schema}.${row.table_name}`);
  const hasHistory = names.includes('supabase_migrations.schema_migrations');
  const hasChecksums = names.includes('supabase_migrations.bayready_checksums');
  const history = hasHistory ? await query(client, 'select version from supabase_migrations.schema_migrations order by version') : [];
  const checksums = hasChecksums ? await query(client, 'select version,sha256 from supabase_migrations.bayready_checksums order by version') : [];
  if (history.length > VERSIONS.length || !history.every(row => record(row) && /^\d{14}$/.test(row.version)) ||
    checksums.length > VERSIONS.length || !checksums.every(row => record(row) && /^\d{14}$/.test(row.version) && /^[0-9a-f]{64}$/.test(row.sha256))) {
    throw new SetupError('The remote migration history is not an expected bounded history.');
  }
  const versions = history.map(row => row.version);
  if (versions.some((version, index) => version !== migrations[index]?.version) ||
    checksums.length !== versions.length || checksums.some((row, index) => row.version !== versions[index] || row.sha256 !== migrations[index]?.checksum)) {
    throw new SetupError('Migration history or checksums differ from this checkout. No migration will be repeated or adopted automatically.');
  }
  if (!versions.length && names.some(name => name.startsWith('public.'))) throw new SetupError('Application tables exist without verified migration history; manual reconciliation is required.');
  return {
    inspectedAt: new Date().toISOString(), projectRef: PROJECT_REF, projectVerified: true,
    projectStatus: typeof project.status === 'string' && /^[A-Z_]+$/.test(project.status) ? project.status : 'unknown',
    anonymousSignInsEnabled: auth.external_anonymous_users_enabled, signupsDisabled: auth.disable_signup,
    manualIdentityLinkingEnabled: auth.security_manual_linking_enabled,
    emailProviderEnabled: auth.external_email_enabled, emailConfirmationRequired: !auth.mailer_autoconfirm,
    rangeExtension: extensions.length ? 'btree_gist in extensions' : 'btree_gist not installed',
    schemaObjects: names, migrationVersions: versions,
    pendingVersions: migrations.slice(versions.length).map(item => item.version),
  };
}

export function buildSetupTransaction(migrations, inspection) {
  if (migrations.length !== VERSIONS.length) throw new SetupError('All twelve reviewed migrations must be present before hosted apply.');
  const pending = migrations.slice(inspection.migrationVersions.length);
  const expectedVersions = literal(JSON.stringify(inspection.migrationVersions));
  const appNames = APP_TABLES.map(literal).join(',');
  const pieces = [
    "begin; set local lock_timeout='10s'; set local statement_timeout='90s';",
    "select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bayready:hosted-setup:v1',0));",
    'create schema if not exists supabase_migrations;',
    'create table if not exists supabase_migrations.schema_migrations(version text primary key,statements text[],name text);',
    "create table if not exists supabase_migrations.bayready_checksums(version text primary key references supabase_migrations.schema_migrations(version),sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),applied_at timestamptz not null default pg_catalog.clock_timestamp());",
    'alter table supabase_migrations.bayready_checksums enable row level security;',
    'revoke all on table supabase_migrations.bayready_checksums from public,anon,authenticated;',
    `do $bayready_guard$ begin
      if (select coalesce(pg_catalog.jsonb_agg(version order by version),'[]'::jsonb) from supabase_migrations.schema_migrations) <> ${expectedVersions}::jsonb then raise exception 'BAYREADY_HISTORY_CHANGED'; end if;
      if (select pg_catalog.count(*) from supabase_migrations.bayready_checksums) <> ${inspection.migrationVersions.length} then raise exception 'BAYREADY_CHECKSUM_HISTORY_CHANGED'; end if;
      ${!inspection.migrationVersions.length ? `if exists(select 1 from information_schema.tables where table_schema='public' and table_name in (${appNames})) then raise exception 'BAYREADY_UNTRACKED_SCHEMA'; end if;` : ''}
      ${migrations.slice(0, inspection.migrationVersions.length).map(item => `if not exists(select 1 from supabase_migrations.bayready_checksums where version=${literal(item.version)} and sha256=${literal(item.checksum)}) then raise exception 'BAYREADY_CHECKSUM_CHANGED'; end if;`).join('\n')}
    end $bayready_guard$;`,
  ];
  for (const migration of pending) {
    const tag = `$bayready_${migration.version}$`;
    if (migration.body.includes(tag)) throw new SetupError('A migration conflicts with its safe SQL delimiter.');
    pieces.push(migration.body,
      `insert into supabase_migrations.schema_migrations(version,name,statements) values(${literal(migration.version)},${literal(migration.name)},array[${tag}${migration.body}${tag}]);`,
      `insert into supabase_migrations.bayready_checksums(version,sha256) values(${literal(migration.version)},${literal(migration.checksum)});`);
  }
  pieces.push("notify pgrst,'reload schema'; commit; select version from supabase_migrations.schema_migrations order by version;");
  return pieces.join('\n');
}

function serverKey(value) {
  if (typeof value !== 'string') return false;
  if (/^sb_secret_[A-Za-z0-9_-]{10,}$/.test(value)) return true;
  try {
    const parts = value.split('.');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    return parts.length === 3 && claims.role === 'service_role' && claims.ref === PROJECT_REF;
  } catch { return false; }
}

async function saveBackendKey(client, env, path = resolve(ROOT, '.env')) {
  if (serverKey(env.SUPABASE_SECRET_KEY) || serverKey(env.SUPABASE_SERVICE_ROLE_KEY)) return false;
  const keys = await client('/api-keys?reveal=true');
  if (!Array.isArray(keys)) throw new SetupError('The authorized backend key listing was invalid.');
  const selected = keys.find(item => record(item) && /^sb_secret_/.test(item.api_key) && serverKey(item.api_key)) ??
    keys.find(item => record(item) && serverKey(item.api_key));
  if (!selected) throw new SetupError('No existing backend secret/service-role project key could be retrieved. No key was created.');
  const previousStat = await lstat(path);
  if (!previousStat.isFile() || previousStat.isSymbolicLink()) throw new SetupError('The backend .env must be a regular file before saving a retrieved key.');
  const previous = await readFile(path, 'utf8');
  const name = selected.api_key.startsWith('sb_secret_') ? 'SUPABASE_SECRET_KEY' : 'SUPABASE_SERVICE_ROLE_KEY';
  const lines = previous.split(/\r?\n/).filter(line => !new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(line));
  while (lines.at(-1) === '') lines.pop();
  const updated = [...lines, `${name}=${selected.api_key}`, ''].join('\n');
  const temporary = resolve(dirname(path), `.env.setup-${randomUUID()}`);
  try {
    await writeFile(temporary, updated, { mode: 0o600, flag: 'wx' });
    if (sha256(await readFile(path, 'utf8')) !== sha256(previous)) throw new SetupError('The backend .env changed during setup; its contents were not overwritten.');
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => undefined); }
  return true;
}

export async function verifyHostedGuest(env, fetchImpl) {
  const publicKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || env.SUPABASE_API_KEY;
  const backendKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (typeof publicKey !== 'string' || !publicKey || serverKey(publicKey) || !serverKey(backendKey)) {
    throw new SetupError('Guest verification requires separate public and private project keys.');
  }
  const request = async (path, { key = publicKey, token, body, method = 'POST' } = {}) => {
    const response = await fetchImpl(`${PROJECT_ORIGIN}${path}`, {
      method, headers: { apikey: key, Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(15_000),
    }).catch(() => { throw new SetupError('The guest verification outcome could not be read. No error body or token was printed.'); });
    if (!response.ok) {
      await response.body?.cancel();
      throw new SetupError(`Guest verification returned HTTP ${response.status}. No error body or token was printed.`);
    }
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body ?? []) {
      bytes += chunk.byteLength;
      if (bytes > 1024 * 1024) throw new SetupError('Guest verification exceeded its response bound.');
      chunks.push(chunk);
    }
    if (!bytes) return null;
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
      throw new SetupError('Guest verification returned an unreadable result.');
    }
  };
  let createdId = null;
  let verified = false;
  let deleted = false;
  let privateAccessDenied = 0;
  try {
    const auth = await request('/auth/v1/signup', { body: { data: {}, gotrue_meta_security: {} } });
    if (auth?.user?.is_anonymous === true && typeof auth.user.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(auth.user.id)) createdId = auth.user.id;
    if (!createdId || typeof auth.access_token !== 'string') throw new SetupError('A new anonymous guest session was not verified.');
    const token = auth.access_token;
    const registered = await request('/rest/v1/rpc/list_bay_availability', { token, body: {} });
    const directory = await request('/rest/v1/rpc/list_directory_holds', { token, body: { p_station_ids: [] } });
    const hardware = await request('/rest/v1/rpc/list_hardware_workflows', { token, body: {} });
    const calendar = await request('/rest/v1/rpc/list_my_hardware_slots', { token, body: {} });
    if (!record(registered) || !Array.isArray(registered.bays) || !record(directory) || !Array.isArray(directory.holds) || !Array.isArray(directory.myBookings) ||
      !record(hardware) || !Array.isArray(hardware.workflows) || !record(calendar) || !Array.isArray(calendar.slots)) {
      throw new SetupError('Authenticated guest RPC responses were not verified.');
    }
    const work = await request('/rest/v1/rpc/list_hardware_slot_work', {
      key: backendKey, token: backendKey.startsWith('sb_secret_') ? undefined : backendKey, body: { p_limit: 1 },
    });
    if (!record(work) || !Array.isArray(work.controls) || !Array.isArray(work.slots) || work.controls.length || work.slots.length) {
      throw new SetupError('The private read-only work RPC did not verify the expected unenrolled hardware state.');
    }
    for (const [path, method, body] of [
      ['/rest/v1/hardware_controls?select=bay_id&limit=1', 'GET', undefined],
      ['/rest/v1/hardware_operations?select=id&limit=1', 'GET', undefined],
      ['/rest/v1/hardware_slot_extensions?select=request_id&limit=1', 'GET', undefined],
      ['/rest/v1/directory_plug_extensions?select=request_id&limit=1', 'GET', undefined],
      ['/rest/v1/rpc/list_hardware_slot_work', 'POST', { p_limit: 1 }],
    ]) {
      const denied = await fetchImpl(`${PROJECT_ORIGIN}${path}`, {
        method, headers: { apikey: publicKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(15_000),
      }).catch(() => { throw new SetupError('Guest private-access verification could not be completed.'); });
      await denied.body?.cancel();
      if (![401, 403].includes(denied.status)) throw new SetupError('A guest private-access denial was not verified; inspect permissions before deployment.');
      privateAccessDenied++;
    }
    verified = true;
  } finally {
    if (createdId) {
      await request(`/auth/v1/admin/users/${createdId}`, {
        key: backendKey, token: backendKey.startsWith('sb_secret_') ? undefined : backendKey,
        method: 'DELETE', body: { should_soft_delete: false },
      });
      deleted = true;
    }
  }
  return {
    anonymousGuestVerified: verified, authenticatedReadRpcsVerified: verified ? 4 : 0,
    workerReadRpcVerified: verified, hardwareWorkEmpty: verified,
    guestPrivateAccessDenialsVerified: privateAccessDenied, testGuestDeleted: deleted, emailSentBySetup: false,
  };
}

export async function waitForAuthSetup(readInspection, before, pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))) {
  // A successful PATCH can become visible after a short metadata delay. Only
  // repeat reads: a failed request or an exhausted window never repeats writes.
  for (const delay of [0, 250, 500, 1000, 2000, 3000, 5000]) {
    if (delay) await pause(delay);
    const after = await readInspection();
    if (after.emailProviderEnabled !== before.emailProviderEnabled || after.emailConfirmationRequired !== before.emailConfirmationRequired) {
      throw new SetupError('Existing email settings changed during Auth setup. Inspect remote state before continuing.');
    }
    if (after.anonymousSignInsEnabled && !after.signupsDisabled && after.manualIdentityLinkingEnabled) return after;
  }
  throw new SetupError('The requested Auth flags were not verified within the bounded read window. Inspect remote state before retrying a write.');
}

export async function setupSupabase({ mode = '--inspect', env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!['--inspect', '--apply'].includes(mode)) throw new SetupError('Use --inspect or --apply. Hosted apply requires the reviewed local database checks to have passed.');
  const { token } = validateSetupEnvironment(env);
  const client = createManagementClient(token, fetchImpl);
  const migrations = await loadSetupMigrations();
  const before = await inspectSetup(client, migrations);
  if (mode === '--inspect') return { ...before, mutated: false };
  // Authorization is explicit in --apply. History/DDL/checksums commit together;
  // transport errors are never automatically retried because commit may occur.
  if (before.projectStatus !== 'ACTIVE_HEALTHY') throw new SetupError('The authorized project is not healthy; hosted setup was not applied.');
  await query(client, buildSetupTransaction(migrations, before), false);
  let after = await inspectSetup(client, migrations);
  if (after.pendingVersions.length) throw new SetupError('Hosted schema verification still reports pending migrations.');
  if (!after.anonymousSignInsEnabled || after.signupsDisabled || !after.manualIdentityLinkingEnabled) {
    await client('/config/auth', { method: 'PATCH', body: { external_anonymous_users_enabled: true, security_manual_linking_enabled: true, disable_signup: false } });
    after = await waitForAuthSetup(() => inspectSetup(client, migrations), before);
  }
  const backendKeySaved = await saveBackendKey(client, env);
  const stored = parseEnv(await readFile(resolve(ROOT, '.env'), 'utf8'));
  const smoke = await verifyHostedGuest({ ...env, ...stored }, fetchImpl);
  return { ...after, mutated: true, backendKeySaved, ...smoke, hardwareEnrolled: false, hardwareActivatedBySetup: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 3) throw new SetupError('Use --inspect or --apply without extra arguments.');
    console.log(JSON.stringify(await setupSupabase({ mode: process.argv[2] ?? '--inspect' }), null, 2));
  } catch (error) {
    console.error(error instanceof SetupError ? error.message : 'Supabase setup failed. Inspect remote state; no secret or provider error body was printed.');
    process.exitCode = 1;
  }
}
