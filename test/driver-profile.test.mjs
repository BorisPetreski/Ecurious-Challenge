import test from 'node:test';
import assert from 'node:assert/strict';

import { parseDriverProfile, validateProfileInput } from '../mobile/src/lib/driver-profile.ts';

const input = {
  name: ' Example Driver ',
  email: ' DRIVER@EXAMPLE.COM ',
  phone: '+49 (151) 234-56789',
  licensePlate: ' demo-42 ',
  connectorType: 'CCS',
  paymentMethod: 'mock-card',
};

test('local driver preferences normalize contact details and plate without verifying them', () => {
  const result = validateProfileInput(input);
  assert.equal(result.valid, true);
  assert.deepEqual(result.value, {
    name: 'Example Driver', email: 'driver@example.com', phone: '+4915123456789',
    licensePlate: 'DEMO-42', connectorType: 'CCS', paymentMethod: 'mock-card',
  });
});

test('Unicode letters and numbers are supported in plates while punctuation and controls are rejected', () => {
  assert.equal(validateProfileInput({ ...input, licensePlate: 'м-ää 42' }).value.licensePlate, 'М-ÄÄ 42');
  for (const plate of ['A', '--------', 'AB/123', 'AB\n123', 'AB_123', 'A'.repeat(16), `AB${'-'.repeat(19)}`]) {
    assert.equal(validateProfileInput({ ...input, licensePlate: plate }).valid, false);
  }
  assert.equal(validateProfileInput({ ...input, licensePlate: 'AB-CD-EF-GH-IJ-12345' }).valid, true);
});

test('phone normalization requires an international country code and 7 to 15 digits', () => {
  for (const phone of ['+1234567', '+123456789012345', '+49 151 23456789']) {
    assert.equal(validateProfileInput({ ...input, phone }).valid, true);
  }
  for (const phone of ['123456789', '+123456', '+1234567890123456', '+01234567', '+49 CALL ME', '+49\n15123456789']) {
    assert.equal(validateProfileInput({ ...input, phone }).valid, false);
  }
});

test('required profile fields reject invalid types, control characters, and unsupported selections', () => {
  for (const patch of [
    { name: '' }, { name: 'A'.repeat(101) }, { name: 'Example\u0000Driver' },
    { email: 'driver-at-example.com' }, { email: 'driver@example' },
    { email: `${'a'.repeat(249)}@x.com` }, { phone: 4915123456789 },
    { connectorType: 'Other' }, { paymentMethod: 'real-card' },
  ]) assert.equal(validateProfileInput({ ...input, ...patch }).valid, false);
  const missing = validateProfileInput(null);
  assert.equal(missing.valid, false);
  assert.equal(Object.keys(missing.errors).length, 6);
});

test('stored profile restoration requires supported version, valid details, and an exact UTC timestamp', () => {
  const profile = { version: 1, ...validateProfileInput(input).value, updatedAt: '2026-10-24T12:00:00.000Z' };
  assert.deepEqual(parseDriverProfile(JSON.parse(JSON.stringify(profile))), profile);
  for (const patch of [
    { version: 2 }, { updatedAt: 'yesterday' }, { updatedAt: '2026-02-30T12:00:00.000Z' },
    { updatedAt: '2026-10-24T14:00:00+02:00' }, { licensePlate: '' },
  ]) assert.equal(parseDriverProfile({ ...profile, ...patch }), null);
  assert.equal(parseDriverProfile([]), null);
});

test('saved profile contains only local preference fields and fits one native secure-storage value', () => {
  const maximum = validateProfileInput({
    ...input, name: '𐐀'.repeat(100), email: `${'𐐀'.repeat(248)}@x.com`,
    phone: '+123456789012345', licensePlate: '𐐀'.repeat(15),
    cardNumber: 'fictional-extra-field', cvv: 'fictional-extra-field',
  });
  assert.equal(maximum.valid, true);
  assert.equal('cardNumber' in maximum.value, false);
  assert.equal('cvv' in maximum.value, false);
  const profile = { version: 1, ...maximum.value, updatedAt: '2026-10-24T12:00:00.000Z' };
  assert.ok(Buffer.byteLength(JSON.stringify(profile), 'utf8') < 2048);
  assert.notEqual(parseDriverProfile(profile), null);
});
