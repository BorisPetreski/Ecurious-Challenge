import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicSupabaseKey, mobileEnvironment } from '../scripts/mobile-environment.mjs';

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

test('Supabase mobile config accepts public credentials and removes management/server secrets', () => {
  const anon = `header.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.signature`;
  const privileged = `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`;
  const env = mobileEnvironment({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_API_KEY: anon,
    SUPABASE_ACCESS_TOKEN: 'fictional-management-token', SUPABASE_SERVICE_ROLE_KEY: privileged,
    SUPABASE_DB_PASSWORD: 'fictional-database-password' });
  assert.equal(env.EXPO_PUBLIC_SUPABASE_URL, 'https://project.supabase.co');
  assert.equal(env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, anon);
  assert.ok(!Object.keys(env).some(key => key.startsWith('SUPABASE_')));
  for (const key of [privileged, 'sb_secret_fictional-secret', 'not-a-public-key']) {
    assert.equal(isPublicSupabaseKey(key), false);
    assert.throws(() => mobileEnvironment({ SUPABASE_API_KEY: key }), error =>
      error.message.includes('publishable or anon') && !error.message.includes(key));
  }
  assert.equal(isPublicSupabaseKey('sb_publishable_fictional-key'), true);
});
