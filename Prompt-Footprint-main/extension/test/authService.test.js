const test = require('node:test');
const assert = require('node:assert');

// authService.js reads the globals PFSupabase and PFAuthState at call time
// (in the worker they're set by importScripts). We provide a stub Supabase and
// the real pure reducer, mirroring background.writingAssistant.test.js's
// dependency-injection-by-global approach. No network, no chrome.
global.PFAuthState = require('../lib/authState.js');

function stubClient({ signUpResult, signInResult, rpcResult } = {}) {
  const state = { signedOut: false };
  return {
    get _signedOut() { return state.signedOut; },
    auth: {
      async signUp() { return signUpResult || { data: { session: null }, error: null }; },
      async signInWithPassword() {
        return signInResult || { data: { session: null, user: null }, error: null };
      },
      async signOut() { state.signedOut = true; return { error: null }; },
      async getSession() {
        return signInResult && signInResult.data && signInResult.data.session
          ? { data: { session: signInResult.data.session } }
          : { data: { session: null } };
      },
    },
    async rpc() { return rpcResult || { error: null }; },
  };
}

function withSupabase(getClientImpl, extra = {}) {
  global.PFSupabase = Object.assign({
    getClient: getClientImpl,
    clearAuthBag: async () => { withSupabase._cleared = true; },
    getClaimedFor: async () => null,
    setClaimedFor: async () => {},
  }, extra);
}

// Fresh require each time is unnecessary (functions read globals at call time),
// so require once.
const PFAuth = require('../lib/authService.js');

test('not configured: auth calls fail closed and status is logged_out', async () => {
  withSupabase(() => null);
  assert.deepStrictEqual(await PFAuth.signUp('a@b.co', 'pw'), { error: 'not_configured' });
  assert.deepStrictEqual(await PFAuth.login('a@b.co', 'pw'), { error: 'not_configured' });
  const status = await PFAuth.getStatus();
  assert.strictEqual(status.state, 'logged_out');
  assert.strictEqual(status.configured, false);
});

test('signup with email confirmation returns verify_sent (no active session yet)', async () => {
  withSupabase(() => stubClient({ signUpResult: { data: { session: null }, error: null } }));
  assert.deepStrictEqual(await PFAuth.signUp('a@b.co', 'pw'), { status: 'verify_sent' });
});

test('signup failure surfaces Supabase\'s message under a normalized error tag', async () => {
  withSupabase(() => stubClient({ signUpResult: { data: {}, error: { message: 'boom' } } }));
  assert.deepStrictEqual(await PFAuth.signUp('a@b.co', 'pw'), { error: 'signup_failed', message: 'boom' });
});

test('signup errors surface Supabase\'s actual message instead of a guess', async () => {
  const weak = { code: 'weak_password', message: 'Password should contain at least one number and one symbol' };
  withSupabase(() => stubClient({ signUpResult: { data: {}, error: weak } }));
  assert.deepStrictEqual(await PFAuth.signUp('a@b.co', 'pw'), {
    error: 'signup_failed',
    message: 'Password should contain at least one number and one symbol',
  });
});

test('login errors surface Supabase\'s actual message (e.g. unconfirmed email) instead of a guess', async () => {
  const unconfirmed = { message: 'Email not confirmed' };
  withSupabase(() => stubClient({ signInResult: { data: { session: null }, error: unconfirmed } }));
  assert.deepStrictEqual(await PFAuth.login('a@b.co', 'pw'), {
    error: 'invalid_credentials',
    message: 'Email not confirmed',
  });
});

test('login success returns logged_in + account email', async () => {
  const session = { user: { id: 'u1', email: 'a@b.co' } };
  withSupabase(() => stubClient({ signInResult: { data: { session, user: session.user }, error: null } }));
  const res = await PFAuth.login('a@b.co', 'pw');
  assert.strictEqual(res.status, 'logged_in');
  assert.strictEqual(res.account.email, 'a@b.co');
});

test('login failure returns invalid_credentials with Supabase\'s message', async () => {
  withSupabase(() => stubClient({ signInResult: { data: { session: null }, error: { message: 'nope' } } }));
  assert.deepStrictEqual(await PFAuth.login('a@b.co', 'bad'), { error: 'invalid_credentials', message: 'nope' });
});

test('logout signs out AND clears the local auth bag (but keeps pf_* data)', async () => {
  withSupabase._cleared = false;
  const client = stubClient();
  withSupabase(() => client);
  const res = await PFAuth.logout();
  assert.deepStrictEqual(res, { status: 'logged_out' });
  assert.strictEqual(client._signedOut, true);
  assert.strictEqual(withSupabase._cleared, true, 'auth bag must be cleared on logout');
});

test('getStatus maps an active session to logged_in', async () => {
  const session = { user: { id: 'u1', email: 'a@b.co' } };
  withSupabase(() => stubClient({ signInResult: { data: { session } } }));
  const status = await PFAuth.getStatus();
  assert.strictEqual(status.state, 'logged_in');
  assert.strictEqual(status.email, 'a@b.co');
});

test('deleteAccount calls the delete_user rpc then signs out', async () => {
  withSupabase._cleared = false;
  const client = stubClient({ rpcResult: { error: null } });
  withSupabase(() => client);
  const res = await PFAuth.deleteAccount();
  assert.deepStrictEqual(res, { status: 'deleted' });
  assert.strictEqual(client._signedOut, true);
});
