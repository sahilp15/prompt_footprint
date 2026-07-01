const test = require('node:test');
const assert = require('node:assert');
const A = require('../lib/authState.js');

test('no session -> logged_out (local-only fallback is always available)', () => {
  assert.strictEqual(A.authState({ session: null }), 'logged_out');
  assert.strictEqual(A.authState({}), 'logged_out');
});

test('session + online -> logged_in', () => {
  assert.strictEqual(A.authState({ session: { user: { id: 'u' } }, online: true }), 'logged_in');
});

test('session + offline -> offline (still signed in, just cannot reach the server)', () => {
  assert.strictEqual(A.authState({ session: { user: { id: 'u' } }, online: false }), 'offline');
});

test('reduceAuth: LOGIN with a session -> logged_in, without -> logged_out', () => {
  assert.strictEqual(A.reduceAuth('logged_out', { type: 'LOGIN', session: { user: {} } }), 'logged_in');
  assert.strictEqual(A.reduceAuth('logged_out', { type: 'LOGIN' }), 'logged_out');
});

test('reduceAuth: LOGOUT from any state -> logged_out', () => {
  assert.strictEqual(A.reduceAuth('logged_in', { type: 'LOGOUT' }), 'logged_out');
  assert.strictEqual(A.reduceAuth('offline', { type: 'LOGOUT' }), 'logged_out');
});

test('reduceAuth: OFFLINE/ONLINE toggle only affects signed-in states', () => {
  assert.strictEqual(A.reduceAuth('logged_in', { type: 'OFFLINE' }), 'offline');
  assert.strictEqual(A.reduceAuth('offline', { type: 'ONLINE' }), 'logged_in');
  // A logged-out user going offline/online stays logged_out.
  assert.strictEqual(A.reduceAuth('logged_out', { type: 'OFFLINE' }), 'logged_out');
  assert.strictEqual(A.reduceAuth('logged_out', { type: 'ONLINE' }), 'logged_out');
});

test('reduceAuth: unknown event preserves the previous state', () => {
  assert.strictEqual(A.reduceAuth('logged_in', { type: 'NOPE' }), 'logged_in');
  assert.strictEqual(A.reduceAuth(undefined, {}), 'logged_out');
});
