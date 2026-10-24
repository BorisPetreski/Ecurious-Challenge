import assert from 'node:assert/strict';
import test from 'node:test';

import { groupRegisteredLocations, matchingConnectors } from '../mobile/src/lib/map-inventory.ts';

const connector = (id, type, powerKw, enabled = true) => ({ id, label: id, type, powerKw, enabled });
const bay = (id, connectors, overrides = {}) => ({
  id, label: id, locationId: 'location-1', locationLabel: 'Demo location',
  latitude: 52.52, longitude: 13.405, goingelectricId: null,
  availability: 'unreserved', connectors, ...overrides,
});
const inventory = [
  bay('A1', [connector('A1-CCS', 'CCS', 150), connector('A1-Type2', 'Typ2', 22)]),
  bay('A2', [connector('A2-CCS', 'CCS', 150)]),
  bay('A3', [connector('A3-Type2', 'Typ2', 22)]),
];

test('groups one location without counting two plugs as two vehicle spaces', () => {
  const locations = groupRegisteredLocations(inventory);
  assert.equal(locations.length, 1);
  assert.equal(locations[0].unreservedBayCount, 3);
  assert.equal(locations[0].connectorCount, 4);
});

test('applies connector and power preference to individual inventory', () => {
  const ccs = groupRegisteredLocations(inventory, { connectorType: 'CCS', minPower: 50 });
  assert.equal(ccs[0].unreservedBayCount, 2);
  assert.equal(ccs[0].connectorCount, 2);
  assert.deepEqual(ccs[0].bays.map(value => value.id), ['A1', 'A2']);
  assert.deepEqual(groupRegisteredLocations(inventory, { connectorType: 'CHAdeMO' }), []);
  assert.deepEqual(groupRegisteredLocations(inventory, { connectorType: 'Typ2', minPower: 50 }), []);
});

test('a reservation removes the whole bay while another bay keeps the location visible', () => {
  const bays = inventory.map(value => value.id === 'A1' ? { ...value, availability: 'reserved' } : value);
  const locations = groupRegisteredLocations(bays);
  assert.equal(locations[0].unreservedBayCount, 2);
  assert.equal(locations[0].connectorCount, 2);
  const withReserved = groupRegisteredLocations(bays, { showReserved: true });
  assert.equal(withReserved[0].unreservedBayCount, 2);
  assert.equal(withReserved[0].connectorCount, 4);
});

test('disabled connectors cannot make a bay bookable and faults stay opt-in', () => {
  const disabled = bay('disabled', [connector('broken', 'CCS', 150, false)]);
  assert.deepEqual(groupRegisteredLocations([disabled]), []);
  assert.equal(matchingConnectors(disabled, {}, { includeDisabled: true })[0].enabled, false);
  const fault = bay('fault', [connector('one', 'CCS', 50)], { goingelectricId: 42 });
  assert.deepEqual(groupRegisteredLocations([fault], { reportedFaultIds: new Set([42]) }), []);
  assert.equal(groupRegisteredLocations([fault], { reportedFaultIds: new Set([42]), includeFaults: true })[0].bays.length, 1);
});
