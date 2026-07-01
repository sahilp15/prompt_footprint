// PromptFootprint — auth-state reducer (PURE, no chrome, no supabase).
//
// Maps observable inputs (is there a session? are we online?) to the small state
// the dashboard renders. Kept pure so it's fully unit-testable and so the
// local-only fallback is provable: with no session we are always 'logged_out',
// and the extension's local features are never gated on auth.
//
//   states: 'logged_out' | 'logged_in' | 'offline'
(function (root) {
  'use strict';

  function authState({ session, online } = {}) {
    if (!session) return 'logged_out';
    if (online === false) return 'offline';
    return 'logged_in';
  }

  // Reduce a prior state + an event into the next state. Events:
  //   {type:'LOGIN', session}, {type:'LOGOUT'}, {type:'OFFLINE'}, {type:'ONLINE'}
  function reduceAuth(prev, event) {
    const e = event || {};
    switch (e.type) {
      case 'LOGIN':
        return e.session ? 'logged_in' : 'logged_out';
      case 'LOGOUT':
        return 'logged_out';
      case 'OFFLINE':
        return prev === 'logged_out' ? 'logged_out' : 'offline';
      case 'ONLINE':
        return prev === 'logged_out' ? 'logged_out' : 'logged_in';
      default:
        return prev || 'logged_out';
    }
  }

  const api = { authState, reduceAuth };
  if (root) root.PFAuthState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
