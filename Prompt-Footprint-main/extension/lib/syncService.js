// PromptFootprint — sync orchestrator (service worker).
//
// The only impure sync module: it reads chrome.storage.local, calls Supabase,
// and writes merged results back. All the decision logic lives in the pure,
// unit-tested modules (PFSyncPayload, PFSyncMerge). Sync is best-effort and
// silent: any failure returns {ok:false} and NEVER wipes local data or blocks
// the UI. Writes always go local-first elsewhere; this only mirrors them.
//
// Idempotent by construction: sessions upsert on (user_id, session_id), savings
// upsert on (user_id, day). Re-running never appends and never double-counts.
//
// Depends on globals: PFSupabase, PFAuth, PFStorage, PFSyncPayload, PFSyncMerge.
(function (root) {
  'use strict';

  const SAVINGS_KEY = 'pf_savings';
  const SESSION_PREFIX = 'pf_session_';
  const USER_ID_KEY = 'pf_userId';

  function snapshot() {
    return new Promise((resolve) => {
      try { chrome.storage.local.get(null, (r) => resolve(r || {})); }
      catch (_) { resolve({}); }
    });
  }
  function setLocal(obj) {
    return new Promise((resolve) => {
      try { chrome.storage.local.set(obj, () => resolve()); }
      catch (_) { resolve(); }
    });
  }

  async function pushAll(client, payload) {
    const sessions = PFSyncMerge.dedupeUpsertRows(payload.sessions, (r) => r.session_id);
    const savings = PFSyncMerge.dedupeUpsertRows(payload.savingsDaily, (r) => r.day);
    if (sessions.length) {
      await client.from('session_stats').upsert(sessions, { onConflict: 'user_id,session_id' });
    }
    if (savings.length) {
      await client.from('savings_daily').upsert(savings, { onConflict: 'user_id,day' });
    }
    await client.from('user_settings').upsert(payload.settings, { onConflict: 'user_id' });
  }

  async function pullAndMerge(client, userId, snap) {
    // Sessions: merge remote summaries into local (idempotent, no double-count).
    const remoteSessions = await client.from('session_stats').select('*');
    if (!remoteSessions.error && Array.isArray(remoteSessions.data)) {
      const localList = Object.keys(snap)
        .filter((k) => k.startsWith(SESSION_PREFIX))
        .map((k) => snap[k]);
      const remoteLocal = remoteSessions.data.map((r) => PFSyncMerge.normalizeRemoteSession(r, userId));
      const merged = PFSyncMerge.mergeSessions(localList, remoteLocal);
      const writes = {};
      for (const s of merged) writes[`${SESSION_PREFIX}${s.id}`] = s;
      if (Object.keys(writes).length) await setLocal(writes);
    }

    // Savings: merge daily maps and recompute totals (never accumulate).
    const remoteSavings = await client.from('savings_daily').select('*');
    if (!remoteSavings.error && Array.isArray(remoteSavings.data)) {
      const localDaily = (snap[SAVINGS_KEY] && snap[SAVINGS_KEY].daily) || {};
      const mergedDaily = PFSyncMerge.mergeSavingsDaily(localDaily, remoteSavings.data);
      const totals = PFSyncMerge.recomputeSavingsTotals(mergedDaily);
      await setLocal({ [SAVINGS_KEY]: totals });
    }

    // Settings: adopt the account's settings (we pushed local up first, so on
    // the current device this is a no-op; other devices converge to last write).
    const remoteSettings = await client.from('user_settings').select('*').maybeSingle();
    if (!remoteSettings.error && remoteSettings.data) {
      const s = remoteSettings.data;
      await PFStorage.setConfig({
        overlayEnabled: s.overlay_enabled !== false,
        writingChecksEnabled: s.writing_checks_enabled !== false,
        energyPerTokenMultiplier:
          typeof s.energy_per_token_multiplier === 'number' ? s.energy_per_token_multiplier : 1.0,
      });
    }
  }

  // Push local -> cloud, then pull cloud -> local. Best-effort; silent on error.
  async function syncNow() {
    const client = PFSupabase.getClient();
    if (!client) return { ok: false };
    if (!PFAuth.online()) return { ok: false };
    const userId = await PFAuth.getUserId();
    if (!userId) return { ok: false };
    try {
      const snap = await snapshot();
      const payload = PFSyncPayload.buildSyncPayload(snap, userId);
      await pushAll(client, payload);
      await pullAndMerge(client, userId, snap);
      return { ok: true };
    } catch (_) {
      return { ok: false };
    }
  }

  // One-time claim on first login for this device: record the anonymous install
  // id on the profile, then sync. Guarded so it runs once per (device, user).
  // Re-running is harmless anyway — every write is an upsert on a stable key.
  async function claimAndSync() {
    const client = PFSupabase.getClient();
    if (!client) return { ok: false };
    const userId = await PFAuth.getUserId();
    if (!userId) return { ok: false };
    try {
      const claimedFor = await PFSupabase.getClaimedFor();
      if (claimedFor !== userId) {
        const snap = await snapshot();
        const anon = snap[USER_ID_KEY] || null;
        await client.from('profiles').upsert(
          { user_id: userId, anon_client_id: anon }, { onConflict: 'user_id' }
        );
        await PFSupabase.setClaimedFor(userId);
      }
      return await syncNow();
    } catch (_) {
      return { ok: false };
    }
  }

  const api = { syncNow, claimAndSync };
  if (root) root.PFSync = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
