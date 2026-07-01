// PromptFootprint — auth service (service worker).
//
// Thin wrappers over supabase-js auth, called by background.js message handlers.
// Email + password only. Normalizes results into small shapes the dashboard can
// render, and NEVER logs tokens, emails, or errors verbatim. All local data is
// left untouched by login/logout — accounts are strictly additive.
//
// Depends on globals: PFSupabase (lib/supabaseClient.js), PFAuthState
// (lib/authState.js). Loaded via importScripts in the worker.
(function (root) {
  'use strict';

  function online() {
    try { return self.navigator ? self.navigator.onLine !== false : true; }
    catch (_) { return true; }
  }

  async function signUp(email, password) {
    const client = PFSupabase.getClient();
    if (!client) return { error: 'not_configured' };
    try {
      const { data, error } = await client.auth.signUp({ email, password });
      if (error) return { error: 'signup_failed' };
      // With email confirmations on, there is no active session yet.
      const needsVerify = !data.session;
      return { status: needsVerify ? 'verify_sent' : 'logged_in' };
    } catch (_) {
      return { error: 'signup_failed' };
    }
  }

  async function login(email, password) {
    const client = PFSupabase.getClient();
    if (!client) return { error: 'not_configured' };
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data.session) return { error: 'invalid_credentials' };
      return { status: 'logged_in', account: { email: data.user ? data.user.email : email } };
    } catch (_) {
      return { error: 'invalid_credentials' };
    }
  }

  async function logout() {
    const client = PFSupabase.getClient();
    // Sign out with supabase if possible, but always clear our local auth bag.
    try { if (client) await client.auth.signOut(); } catch (_) {}
    try { await PFSupabase.clearAuthBag(); } catch (_) {}
    // NOTE: local pf_* data (sessions, savings, config) is intentionally kept.
    return { status: 'logged_out' };
  }

  // Current account status for the dashboard. Refreshes the token on demand
  // (getSession refreshes if expired), which survives service-worker restarts
  // because the session lives in chrome.storage.local, not worker memory.
  async function getStatus() {
    const client = PFSupabase.getClient();
    if (!client) return { state: 'logged_out', configured: false };
    try {
      const { data } = await client.auth.getSession();
      const session = data ? data.session : null;
      const state = PFAuthState.authState({ session, online: online() });
      const email = session && session.user ? session.user.email : null;
      return { state, configured: true, email };
    } catch (_) {
      return { state: 'logged_out', configured: true };
    }
  }

  // Returns the authenticated user's id, or null. Used by the sync service.
  async function getUserId() {
    const client = PFSupabase.getClient();
    if (!client) return null;
    try {
      const { data } = await client.auth.getSession();
      return data && data.session && data.session.user ? data.session.user.id : null;
    } catch (_) {
      return null;
    }
  }

  // Permanently delete the account (auth record cascades to all synced rows),
  // then sign out locally. Local on-device data is kept; clear it separately.
  async function deleteAccount() {
    const client = PFSupabase.getClient();
    if (!client) return { error: 'not_configured' };
    try {
      const { error } = await client.rpc('delete_user');
      if (error) return { error: 'delete_failed' };
      await logout();
      return { status: 'deleted' };
    } catch (_) {
      return { error: 'delete_failed' };
    }
  }

  const api = { signUp, login, logout, getStatus, getUserId, deleteAccount, online };
  if (root) root.PFAuth = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
