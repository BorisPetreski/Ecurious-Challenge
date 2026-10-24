import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalDirectoryStationIds, isDirectoryHoldSnapshot, isDirectoryReservation,
  isDirectorySlotKey, isDirectoryStationId,
} from '../mobile/src/lib/directory-booking-contract.ts';

const id = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const slot = 'a'.repeat(64);
const hold = { stationId: 123, slotKey: slot, reservedUntil: '2026-10-24T12:10:00Z', isMine: false, myReservationId: null };
const snapshot = { serverNow: '2026-10-24T12:00:00Z', holds: [hold] };
const reservation = { id, stationId: 123, slotKey: slot, status: 'held', createdAt: snapshot.serverNow, expiresAt: hold.reservedUntil };

test('directory station scope is bounded, sorted and deduplicated without changing numeric identities', () => {
  assert.deepEqual(canonicalDirectoryStationIds([456, 123, 456]), [123, 456]);
  assert.deepEqual(canonicalDirectoryStationIds([]), []);
  assert.deepEqual(canonicalDirectoryStationIds([Number.MAX_SAFE_INTEGER]), [Number.MAX_SAFE_INTEGER]);
  for (const input of [null, {}, ['123'], [0], [-1], [1.5], [Infinity], [Number.MAX_SAFE_INTEGER + 1], Array(501).fill(123)]) {
    assert.equal(canonicalDirectoryStationIds(input), null);
  }
  assert.equal(isDirectoryStationId(123), true);
  assert.equal(isDirectoryStationId('123'), false);
});

test('directory virtual identities accept only canonical opaque SHA256-sized keys', () => {
  assert.equal(isDirectorySlotKey(slot), true);
  for (const key of ['a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), ` ${slot}`, null]) {
    assert.equal(isDirectorySlotKey(key), false);
  }
});

test('a complete directory hold snapshot may contain no holds, without claiming physical availability', () => {
  assert.equal(isDirectoryHoldSnapshot(snapshot, [123]), true);
  assert.equal(isDirectoryHoldSnapshot({ ...snapshot, holds: [] }, []), true);
  assert.equal(isDirectoryHoldSnapshot({ serverNow: snapshot.serverNow }), false);
  assert.equal(isDirectoryHoldSnapshot({ ...snapshot, serverNow: 'invalid' }), false);
});

test('owned orphan holds remain visible but another user cannot leak outside the queried scope', () => {
  assert.equal(isDirectoryHoldSnapshot(snapshot, []), false);
  assert.equal(isDirectoryHoldSnapshot({ ...snapshot, holds: [{ ...hold, isMine: true, myReservationId: id }] }, []), true);
  for (const patch of [{ isMine: true }, { myReservationId: id }, { isMine: true, myReservationId: 'invalid' }]) {
    assert.equal(isDirectoryHoldSnapshot({ ...snapshot, holds: [{ ...hold, ...patch }] }, [123]), false);
  }
});

test('directory snapshots reject duplicate slot allocations and duplicate owned reservation IDs', () => {
  assert.equal(isDirectoryHoldSnapshot({ ...snapshot, holds: [hold, hold] }), false);
  const own = { ...hold, isMine: true, myReservationId: id };
  assert.equal(isDirectoryHoldSnapshot({ ...snapshot, holds: [own, { ...own, slotKey: 'b'.repeat(64) }] }), false);
  assert.equal(isDirectoryHoldSnapshot({ ...snapshot, holds: [own, { ...own, slotKey: 'b'.repeat(64), myReservationId: otherId }] }), true);
  assert.equal(isDirectoryHoldSnapshot({ ...snapshot, holds: [hold, { ...hold, stationId: 456 }] }), true);
});

test('only server-active, correctly typed holds are accepted as reserved observations', () => {
  for (const patch of [
    { stationId: '123' }, { stationId: 0 }, { slotKey: 'not-opaque' }, { isMine: 'yes' },
    { reservedUntil: null }, { reservedUntil: snapshot.serverNow }, { reservedUntil: '2026-10-24T11:59:59Z' },
  ]) assert.equal(isDirectoryHoldSnapshot({ ...snapshot, holds: [{ ...hold, ...patch }] }), false);
});

test('reserve and cancel results require exact slot identity, supported state and a finite positive hold interval', () => {
  for (const status of ['held', 'cancelled', 'expired']) assert.equal(isDirectoryReservation({ ...reservation, status }), true);
  for (const patch of [
    { id: 'invalid' }, { stationId: -1 }, { stationId: Number.MAX_SAFE_INTEGER + 1 },
    { slotKey: 'a'.repeat(63) }, { status: 'available' }, { createdAt: 'invalid' },
    { expiresAt: reservation.createdAt }, { expiresAt: '2026-10-24T11:59:59Z' },
  ]) assert.equal(isDirectoryReservation({ ...reservation, ...patch }), false);
});
