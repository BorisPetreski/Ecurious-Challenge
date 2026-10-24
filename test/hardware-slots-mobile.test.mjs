import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../mobile/package.json', import.meta.url));
const ts = require('typescript');
const source = await readFile(new URL('../mobile/src/lib/hardware-slots-api.ts', import.meta.url), 'utf8');
const fixtureKey = '__bayReadySlotMobileFixtures';
globalThis[fixtureKey] = new Map();
let nextId = 0;
const bayId = '11111111-1111-4111-8111-111111111111', connectorId = '22222222-2222-4222-8222-222222222222', slotId = '33333333-3333-4333-8333-333333333333', requestId = '44444444-4444-4444-8444-444444444444';
const startsAt = '2026-10-24T13:00:00.000Z', endsAt = '2026-10-24T13:10:00.000Z';
const policy = { currency: 'EUR', mock: true, nowFreeMinutes: 10, extensionMinutes: 10, extensionFeeCents: 100, scheduledFeeCents: 100, protectionLeadMinutes: 10 };
const quote = () => ({ ...policy, startsAt, endsAt, durationMinutes: 10, bookingMode: 'scheduled', fixedFeeCents: 100, maxChargeCents: 100 });
const ownSlot = () => ({ id: slotId, bayId, connectorId, startsAt, endsAt, status: 'scheduled', isMine: true, canCancel: true, maskedPlate: '•••42', arrivedAt: null, departedAt: null, activatedAt: null, mockFeeCents: 0 });
const snapshot = (slots = [ownSlot()]) => ({ serverNow: '2026-10-24T12:00:00.000Z', configured: true, slots, policy });

async function fixture() {
  const id = ++nextId;
  const f = { calls: [], authCalls: 0, timers: new Map(), fetchImpl: async () => Response.json(snapshot()), tokenImpl: async () => 'fictional-guest-token' };
  f.fetch = (...args) => { f.calls.push(args); return f.fetchImpl(...args); };
  f.getBookingAccessToken = async () => { f.authCalls++; return f.tokenImpl(); };
  f.setTimeout = callback => { const key = Symbol('timeout'); f.timers.set(key, callback); return key; };
  f.clearTimeout = key => f.timers.delete(key);
  globalThis[fixtureKey].set(id, f);
  const transformed = source.replace(/import\s*\{([^;]+?)\}\s*from\s*'([^']+)';/g, (statement, _bindings, name) => {
    if (name === 'expo-crypto') return `const randomUUID = () => '${requestId}';`;
    if (name === '@/lib/bookings-api') return 'const BOOKINGS_CONFIGURED = true; const { getBookingAccessToken } = fixture;';
    if (name === '@/lib/reservation-api') return "const API_BASE_URL = 'http://127.0.0.1:3000';";
    return statement;
  });
  const compiled = ts.transpileModule(transformed, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const code = `const fixture = globalThis.${fixtureKey}.get(${id});\nconst { fetch, setTimeout, clearTimeout } = fixture;\n${compiled}`;
  f.client = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  f.cleanup = () => globalThis[fixtureKey].delete(id);
  return f;
}

test('mock quote sends only UTC window fields and is bound to the reviewed window', async t => {
  const f = await fixture(); t.after(f.cleanup); f.fetchImpl = async () => Response.json(quote());
  assert.deepEqual(await f.client.fetchHardwareQuote(startsAt, endsAt), quote());
  assert.equal(f.calls[0][0], 'http://127.0.0.1:3000/api/hardware/quote');
  assert.deepEqual(JSON.parse(f.calls[0][1].body), { startsAt, endsAt, bookingMode: 'scheduled' });
  assert.equal(f.calls[0][1].headers.Authorization, undefined);
  assert.equal(f.authCalls, 0);
  f.fetchImpl = async () => Response.json({ ...quote(), endsAt: '2026-10-24T14:00:00.000Z' });
  await assert.rejects(f.client.fetchHardwareQuote(startsAt, endsAt), /does not match/);
});

test('disabled schedule GET needs no guest identity and enabled reads authenticate after 401', async t => {
  const disabled = await fixture(); t.after(disabled.cleanup);
  disabled.tokenImpl = async () => { throw new Error('Disabled public status must not create a guest session'); };
  disabled.fetchImpl = async () => Response.json({ ...snapshot([]), configured: false });
  assert.equal((await disabled.client.fetchHardwareSlots()).configured, false);
  assert.equal(disabled.authCalls, 0);
  assert.equal(disabled.calls[0][1].headers.Authorization, undefined);

  const enabled = await fixture(); t.after(enabled.cleanup);
  enabled.fetchImpl = async (_url, init) => init.headers.Authorization ? Response.json(snapshot()) : Response.json({ error: { code: 'AUTH_REQUIRED' } }, { status: 401 });
  assert.equal((await enabled.client.fetchHardwareSlots()).configured, true);
  assert.equal(enabled.authCalls, 1);
  assert.equal(enabled.calls.length, 2);
  assert.equal(enabled.calls[1][1].headers.Authorization, 'Bearer fictional-guest-token');
  await enabled.client.fetchHardwareSlots();
  assert.equal(enabled.calls.length, 3, 'Later enabled reads reuse the authenticated route, without retrying a write.');
});

test('hardware slot creation sends the minimum plate payload without contact or payment fields', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const result = await f.client.createHardwareSlot({ bayId, connectorId, startsAt, endsAt, licensePlate: 'M-DEMO-42', name: 'Fictional Driver', email: 'fictional@example.invalid', phone: '+4915112345678', paymentMethod: 'mock-card' });
  assert.equal(result.slots[0].status, 'scheduled');
  assert.deepEqual(JSON.parse(f.calls[0][1].body), { bayId, connectorId, startsAt, endsAt, licensePlate: 'M-DEMO-42', bookingMode: 'scheduled', requestId });
  assert.equal(f.calls[0][0], 'http://127.0.0.1:3000/api/hardware/slots');
  assert.equal(f.calls.length, 1);
});

test('per-bay schedule reads scope by registered ID and own cancellation sends only slot ID', async t => {
  const f = await fixture(); t.after(f.cleanup);
  await f.client.fetchHardwareSlots(undefined, bayId);
  assert.equal(new URL(f.calls[0][0]).searchParams.get('bayId'), bayId);
  await f.client.cancelHardwareSlot(slotId);
  assert.deepEqual(JSON.parse(f.calls[1][1].body), { slotId });
  await assert.rejects(f.client.fetchHardwareSlots(undefined, 'untrusted/path'), /registered/);
  assert.equal(f.calls.length, 2);
});

test('unknown time-slot writes are not automatically retried', async t => {
  const f = await fixture(); t.after(f.cleanup); f.fetchImpl = async () => { throw new Error('Controlled network failure'); };
  await assert.rejects(f.client.createHardwareSlot({ bayId, connectorId, startsAt, endsAt, licensePlate: 'M-DEMO-42' }), /outcome is unknown/);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0][1].method, 'POST');
});

test('slot projection rejects leaked owner data, duplicate IDs and invalid cancellation capability', async t => {
  const f = await fixture(); t.after(f.cleanup);
  assert.equal(f.client.isHardwareSlotSnapshot(snapshot()), true);
  const publicSlot = { ...ownSlot(), id: null, isMine: false, canCancel: false, maskedPlate: null, mockFeeCents: null };
  assert.equal(f.client.isHardwareSlotSnapshot(snapshot([publicSlot])), true);
  assert.equal(f.client.isHardwareSlotSnapshot(snapshot([{ ...publicSlot, maskedPlate: '•••42' }])), false);
  assert.equal(f.client.isHardwareSlotSnapshot(snapshot([{ ...publicSlot, canCancel: true }])), false);
  assert.equal(f.client.isHardwareSlotSnapshot(snapshot([ownSlot(), ownSlot()])), false);
  assert.equal(f.client.isHardwareSlotSnapshot(snapshot([{ ...ownSlot(), status: 'cancelled', canCancel: true }])), false);
  assert.equal(f.client.isHardwareSlotSnapshot(snapshot([{ ...ownSlot(), endsAt: startsAt }])), false);
});

test('quote validation keeps prototype currency/money bounds explicit', async t => {
  const f = await fixture(); t.after(f.cleanup);
  assert.equal(f.client.isHardwareQuote(quote()), true);
  assert.equal(f.client.isHardwareQuote({ ...quote(), mock: false }), false);
  assert.equal(f.client.isHardwareQuote({ ...quote(), currency: 'USD' }), false);
  assert.equal(f.client.isHardwareQuote({ ...quote(), maxChargeCents: 301 }), false);
  assert.equal(f.client.isHardwareQuote({ ...quote(), rateCentsPerMinute: -1 }), false);
  assert.equal(f.client.isHardwareQuote({ ...quote(), arrivalGraceMinutes: 15 }), true);
  assert.equal(f.client.isHardwareQuote({ ...quote(), arrivalGraceMinutes: 0 }), false);
  assert.equal(f.client.isHardwareQuote({ ...quote(), arrivalGraceMinutes: '15' }), false);
});

test('Reserve now quote accepts server-normalized time and extension sends one priced intent', async t => {
  const f = await fixture(); t.after(f.cleanup);
  f.fetchImpl = async () => Response.json({ ...quote(), bookingMode: 'now', startsAt: '2026-10-24T13:00:01.000Z', endsAt: '2026-10-24T13:10:01.000Z', durationMinutes: 10, fixedFeeCents: 0, maxChargeCents: 0 });
  assert.equal((await f.client.fetchHardwareQuote(startsAt, '2026-10-24T13:10:00.000Z', undefined, 'now')).fixedFeeCents, 0);
  f.fetchImpl = async () => Response.json(snapshot());
  await f.client.extendHardwareSlot(slotId);
  assert.equal(f.calls[1][0], 'http://127.0.0.1:3000/api/hardware/slots/extend');
  assert.deepEqual(JSON.parse(f.calls[1][1].body), { slotId, requestId });
  assert.equal(f.calls[1][1].headers.Authorization, 'Bearer fictional-guest-token');
});
