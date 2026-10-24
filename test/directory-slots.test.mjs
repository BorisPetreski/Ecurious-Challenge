import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { buildDirectorySlotGroups, directoryGroupStatus, directorySlotKey, directorySlotOrdinal, directorySlotPage } from '../mobile/src/lib/directory-slots.ts';

const digest = async value => createHash('sha256').update(value).digest('hex');
const source = connectors => ({ id: 42, connectors });

test('merges equivalent groups and derives order-independent keys with one digest per group', async () => {
  const calls = [];
  const left = await buildDirectorySlotGroups(source([{ type: 'CCS', power: 150, count: 2 }, { type: 'Typ2', power: 22, count: 1 }, { type: 'CCS', power: 150, count: 2 }]), async value => { calls.push(value); return digest(value); });
  const right = await buildDirectorySlotGroups(source([{ type: 'Typ2', power: 22, count: 1 }, { type: 'CCS', power: 150, count: 4 }]), digest);
  assert.deepEqual(left, right);
  assert.equal(calls.length, 2);
  const ccs = left.find(group => group.type === 'CCS');
  const expected = createHash('sha256').update(JSON.stringify(['bayready-directory-v1', 42, 'CCS', 150])).digest('hex').slice(0, 56) + '00000004';
  assert.equal(directorySlotKey(ccs, 4), expected);
  assert.equal(directorySlotOrdinal(ccs, expected), 4);
});

test('stable virtual keys survive count growth while invalid ordinals and other stations do not match', async () => {
  const [group] = await buildDirectorySlotGroups(source([{ type: 'CCS', power: 150, count: 4 }]), digest);
  const [grown] = await buildDirectorySlotGroups(source([{ type: 'CCS', power: 150, count: 6 }]), digest);
  const [other] = await buildDirectorySlotGroups({ id: 43, connectors: [{ type: 'CCS', power: 150, count: 4 }] }, digest);
  assert.equal(directorySlotKey(group, 1), directorySlotKey(grown, 1));
  assert.equal(directorySlotOrdinal(other, directorySlotKey(group, 1)), null);
  assert.throws(() => directorySlotKey(group, 0));
  assert.throws(() => directorySlotKey(group, 5));
  assert.equal(directorySlotOrdinal(group, group.prefix + '00000005'), null);
});

test('absence means app-unreserved only after a fresh read, never physical vacancy', async () => {
  const [group] = await buildDirectorySlotGroups(source([{ type: 'CCS', power: 150, count: 4 }]), digest);
  assert.deepEqual(directoryGroupStatus(group, [], false), { total: 4, reserved: null, unreserved: null });
  assert.deepEqual(directoryGroupStatus(group, [], true), { total: 4, reserved: 0, unreserved: 4 });
  const hold = { stationId: 42, slotKey: directorySlotKey(group, 2), reservedUntil: '2000-01-01T00:00:00Z', isMine: false, myReservationId: null };
  assert.deepEqual(directoryGroupStatus(group, [hold, hold], true), { total: 4, reserved: 1, unreserved: 3 });
  assert.deepEqual(directoryGroupStatus(group, [hold], false), { total: 4, reserved: null, unreserved: null });
});

test('changed inventory leaves an owned orphan hold identifiable for cancellation', async () => {
  const [original] = await buildDirectorySlotGroups(source([{ type: 'CCS', power: 150, count: 4 }]), digest);
  const [reduced] = await buildDirectorySlotGroups(source([{ type: 'CCS', power: 150, count: 2 }]), digest);
  const key = directorySlotKey(original, 4);
  assert.equal(directorySlotOrdinal(reduced, key), null);
  assert.equal(key.length, 64);
  assert.equal(directoryGroupStatus(reduced, [{ stationId: 42, slotKey: key, reservedUntil: '2030-01-01T00:00:00Z', isMine: true, myReservationId: 'fictional-reservation' }], true).unreserved, 2);
});

test('pages app-unreserved ordinals without renumbering held slots', async () => {
  const [group] = await buildDirectorySlotGroups(source([{ type: 'CCS', power: 150, count: 30 }]), digest);
  const holds = [1, 3].map(ordinal => ({ stationId: 42, slotKey: directorySlotKey(group, ordinal), reservedUntil: '2030-01-01T00:00:00Z', isMine: false, myReservationId: null }));
  assert.deepEqual(directorySlotPage(group, holds, { fresh: true, showReserved: false, page: 0, pageSize: 3 }), { ordinals: [2, 4, 5], total: 28 });
  assert.deepEqual(directorySlotPage(group, holds, { fresh: true, showReserved: true, page: 0, pageSize: 3 }), { ordinals: [1, 2, 3], total: 30 });
  assert.deepEqual(directorySlotPage(group, holds, { fresh: false, showReserved: false, page: 0, pageSize: 3 }), { ordinals: [1, 2, 3], total: 30 });
});
