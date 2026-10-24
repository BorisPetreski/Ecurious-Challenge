import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileEnvironment } from '../scripts/mobile-environment.mjs';

test('Expo receives only the intended directory key and never the backend hardware key', () => {
  const original = { ECURIOUS_API_KEY: 'fictional-hardware-key', ELECTRIC_API_KEY: ' fictional-directory-key ', PORT: '3001' };
  const env = mobileEnvironment(original);
  assert.equal(env.EXPO_PUBLIC_GOINGELECTRIC_API_KEY, 'fictional-directory-key');
  assert.equal(env.PORT, '3001');
  assert.ok(!('ECURIOUS_API_KEY' in env));
  assert.ok(!('ELECTRIC_API_KEY' in env));
  assert.equal(original.ECURIOUS_API_KEY, 'fictional-hardware-key');
  assert.equal(mobileEnvironment({ GOINGELECTRIC_API_KEY: 'alternative' }).EXPO_PUBLIC_GOINGELECTRIC_API_KEY, 'alternative');
  assert.equal(mobileEnvironment({ EXPO_PUBLIC_GOINGELECTRIC_API_KEY: 'explicit', ELECTRIC_API_KEY: 'fallback' }).EXPO_PUBLIC_GOINGELECTRIC_API_KEY, 'explicit');
  assert.equal(mobileEnvironment({}).EXPO_PUBLIC_GOINGELECTRIC_API_KEY, undefined);
});
