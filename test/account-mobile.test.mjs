import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(new URL('../mobile/package.json', import.meta.url));
const ts = require('typescript');
const source = await readFile(new URL('../mobile/src/lib/account-api.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture() {
  const calls = [];
  const state = { user: { id: 'fictional-owner', email: undefined, is_anonymous: true, email_confirmed_at: null }, failure: false };
  class BookingApiError extends Error { constructor(message, code) { super(message); this.code = code; } }
  const auth = {
    async getSession() { return { data: { session: { user: { id: 'unverified-local-claim' } } } }; },
    async getUser() { return { data: { user: state.user }, error: state.failure ? { message: 'private provider data' } : null }; },
    async updateUser(body) { calls.push(['updateUser', body]); return { error: state.failure ? { message: 'private provider data' } : null }; },
    async signInWithPassword(body) { calls.push(['signInWithPassword', body]); return { data: { session: state.failure ? null : {} }, error: state.failure ? { message: 'private provider data' } : null }; },
    async verifyOtp(body) { calls.push(['verifyOtp', body]); return { error: state.failure ? { message: 'private provider data' } : null }; },
  };
  const exports = {};
  new Function('exports', 'require', compiled)(exports, () => ({ BookingApiError, getBookingAccountClient: () => ({ auth }),
    getBookingAccessToken: async () => { calls.push(['ensureExistingGuest']); return 'fictional.token'; } }));
  return { api: exports, calls, state };
}

test('account status uses the verified server user, not an unverified local claim', async () => {
  const { api, state } = fixture();
  assert.deepEqual(await api.getBookingAccount(), { id: 'fictional-owner', email: null, guest: true, emailVerified: false });
  state.failure = true;
  await assert.rejects(api.getBookingAccount(), error => error.code === 'AUTH_REQUIRED' && !error.message.includes('private provider data'));
});

test('guest email linking preserves the singleton identity and sends only chosen email', async () => {
  const { api, calls } = fixture();
  await api.requestAccountEmail(' driver@example.invalid ');
  assert.deepEqual(calls, [['ensureExistingGuest'], ['updateUser', { email: 'driver@example.invalid' }]]);
});

test('password setup requires verified email before an update and uses fixed errors', async () => {
  const { api, calls, state } = fixture();
  await assert.rejects(api.setAccountPassword('fictional-strong-password'), { code: 'EMAIL_NOT_VERIFIED' });
  assert.equal(calls.length, 0);
  state.user = { ...state.user, email: 'driver@example.invalid', is_anonymous: false, email_confirmed_at: '2026-10-24T12:00:00Z' };
  await api.setAccountPassword('fictional-strong-password');
  assert.deepEqual(calls, [['updateUser', { password: 'fictional-strong-password' }]]);
});

test('email/password login and verification errors do not expose provider data', async () => {
  const { api, state, calls } = fixture();
  state.failure = true;
  await assert.rejects(api.signInToAccount('driver@example.invalid', 'fictional-password'), error => error.code === 'SIGN_IN_FAILED' && !error.message.includes('private provider data'));
  await assert.rejects(api.verifyAccountEmail('driver@example.invalid', '123456'), error => error.code === 'EMAIL_VERIFY_FAILED' && !error.message.includes('private provider data'));
  assert.deepEqual(calls[1], ['verifyOtp', { email: 'driver@example.invalid', token: '123456', type: 'email_change' }]);
});

test('invalid email, password or verification code never reaches authentication mutations', async () => {
  const { api, calls } = fixture();
  await assert.rejects(api.signInToAccount('invalid', 'fictional-password'), { code: 'INVALID_EMAIL' });
  await assert.rejects(api.verifyAccountEmail('driver@example.invalid', '123'), { code: 'INVALID_CODE' });
  await assert.rejects(api.setAccountPassword('short'), { code: 'INVALID_PASSWORD' });
  assert.equal(calls.length, 0);
});
