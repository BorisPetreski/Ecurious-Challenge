import test from 'node:test';
import assert from 'node:assert/strict';
import { isBookingReservation, isBookingSnapshot } from '../mobile/src/lib/booking-contract.ts';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const connector = { id: uuid(111), label: 'A1 CCS', type: 'CCS', powerKw: 150, enabled: true };
const bay = { id: uuid(1), label: 'Bay A1', locationId: uuid(100), locationLabel: 'Fictional demo location',
  goingelectricId: null, latitude: 52.52, longitude: 13.405, mode: 'demo', lockId: null,
  connectors: [connector], availability: 'unreserved', reservedUntil: null, isMine: false, myReservationId: null, myConnectorId: null };
const snapshot = bays => ({ serverNow: '2026-10-24T10:00:00.000Z', bays });

test('booking contracts preserve location grouping and independent connector identity', () => {
  assert.equal(isBookingSnapshot(snapshot([bay, { ...bay, id: uuid(2), label: 'Bay A2', connectors: [{ ...connector, id: uuid(121) }] }])), true);
  for (const changed of [
    { ...bay, locationId: undefined }, { ...bay, connectors: undefined },
    { ...bay, longitude: null }, { ...bay, connectors: [{ ...connector, powerKw: 0 }] },
    { ...bay, connectors: [connector, connector] },
  ]) assert.equal(isBookingSnapshot(snapshot([changed])), false);
  assert.equal(isBookingSnapshot(snapshot([bay, { ...bay, id: uuid(2), connectors: [connector] }])), false);
  assert.equal(isBookingSnapshot(snapshot([bay, { ...bay, id: uuid(2), latitude: 48, connectors: [] }])), false);
  assert.equal(isBookingSnapshot(snapshot([{ ...bay, connectors: [{ ...connector, type: 'UNKNOWN', enabled: false, powerKw: 0 }] }])), true);
});

test('owner recovery requires a connector belonging to that held bay and hides other owner IDs', () => {
  const held = { ...bay, availability: 'reserved', reservedUntil: '2026-10-24T10:10:00.000Z', isMine: true,
    myReservationId: uuid(900), myConnectorId: connector.id };
  assert.equal(isBookingSnapshot(snapshot([held])), true);
  assert.equal(isBookingSnapshot(snapshot([{ ...held, myConnectorId: uuid(999) }])), false);
  assert.equal(isBookingSnapshot(snapshot([{ ...held, isMine: false }])), false);
  assert.equal(isBookingSnapshot(snapshot([{ ...held, isMine: false, myReservationId: null, myConnectorId: null }])), true);
  assert.equal(isBookingSnapshot(snapshot([{ ...held, availability: 'unreserved' }])), false);
});

test('reservation acknowledgements identify the exact connector, bay and deadline', () => {
  const held = { id: uuid(900), bayId: bay.id, connectorId: connector.id, status: 'held',
    createdAt: '2026-10-24T10:00:00.000Z', expiresAt: '2026-10-24T10:10:00.000Z' };
  assert.equal(isBookingReservation(held), true);
  assert.equal(isBookingReservation({ ...held, connectorId: undefined }), false);
  assert.equal(isBookingReservation({ ...held, expiresAt: held.createdAt }), false);
});
