// PromptFootprint — Supabase client for the service worker.
//
// Runs ONLY in the background service worker (loaded via importScripts after
// lib/vendor/supabase.js, which defines the global `supabase`). The dashboard
// never imports supabase-js; it talks to the worker by message passing, so auth
// tokens stay in the worker's trust boundary.
//
// The session is persisted in chrome.storage.local under `pf_auth` via a custom
// adapter — per Chrome profile, not reachable by content scripts on chat pages.
//
// SUPABASE_URL and SUPABASE_ANON_KEY are PUBLIC values. The anon key is safe to
// ship: Row-Level Security restricts every row to its owner. The service_role
// key is NEVER placed here. Fill these in for your project (also mirrored as
// VITE_SUPABASE_* for the dashboard build). Left blank => accounts are simply
// unavailable and the extension stays fully local-first.
(function (root) {
  'use strict';

  // ── Project config (public). Replace for your Supabase project. ──────────
  const SUPABASE_URL = 'https://cpwbtulpufhqexrrzjzt.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable__EGNJa2cYPhYelN7fke7jA_ZJ5ImaPU'; // publishable key (safe by RLS)

  const AUTH_KEY = 'pf_auth';    // chrome.storage.local bag holding the session

  function chromeGet(keys) {
    return new Promise((resolve) => {
      try { chrome.storage.local.get(keys, (r) => resolve(r || {})); }
      catch (_) { resolve({}); }
    });
  }
  function chromeSet(obj) {
    return new Promise((resolve) => {
      try { chrome.storage.local.set(obj, () => resolve()); }
      catch (_) { resolve(); }
    });
  }

  // supabase-js storage adapter over the `pf_auth` bag. All session keys live
  // inside one object so we never scatter sb-* keys across storage.
  const storageAdapter = {
    async getItem(key) {
      const r = await chromeGet([AUTH_KEY]);
      const bag = r[AUTH_KEY] || {};
      return key in bag ? bag[key] : null;
    },
    async setItem(key, value) {
      const r = await chromeGet([AUTH_KEY]);
      const bag = r[AUTH_KEY] || {};
      bag[key] = value;
      await chromeSet({ [AUTH_KEY]: bag });
    },
    async removeItem(key) {
      const r = await chromeGet([AUTH_KEY]);
      const bag = r[AUTH_KEY] || {};
      delete bag[key];
      await chromeSet({ [AUTH_KEY]: bag });
    },
  };

  function isConfigured() {
    return !!SUPABASE_URL && !!SUPABASE_ANON_KEY &&
      typeof supabase !== 'undefined' && typeof supabase.createClient === 'function';
  }

  let _client = null;
  function getClient() {
    if (!isConfigured()) return null;
    if (_client) return _client;
    _client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: storageAdapter,
        storageKey: 'sb-pf-auth',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false, // email+password: no URL callback to parse
        flowType: 'pkce',
      },
      global: { headers: { 'x-pf-client': 'extension' } },
    });
    return _client;
  }

  // Read the extra bit of state we keep alongside the session: which user id the
  // local data was already migrated ("claimed") for, so we don't re-run it.
  async function getClaimedFor() {
    const r = await chromeGet([AUTH_KEY]);
    return (r[AUTH_KEY] && r[AUTH_KEY].claimedFor) || null;
  }
  async function setClaimedFor(userId) {
    const r = await chromeGet([AUTH_KEY]);
    const bag = r[AUTH_KEY] || {};
    bag.claimedFor = userId;
    await chromeSet({ [AUTH_KEY]: bag });
  }
  async function clearAuthBag() {
    await chromeSet({ [AUTH_KEY]: {} });
  }

  const api = {
    SUPABASE_URL, SUPABASE_ANON_KEY, AUTH_KEY,
    isConfigured, getClient, storageAdapter,
    getClaimedFor, setClaimedFor, clearAuthBag,
  };
  if (root) root.PFSupabase = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
