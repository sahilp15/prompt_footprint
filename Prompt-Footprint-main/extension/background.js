// PromptFootprint Background Service Worker
// Local-first: the extension works fully offline with no account. The worker
// manages the anonymous user id, maps tabs to sessions so they can be closed on
// tab removal, opens the dashboard, and runs the optional Gemini writing proxy.
//
// Optional accounts (Phase 2): the worker is also the sole owner of the Supabase
// client and auth session. The dashboard drives auth/sync by message passing and
// never sees the tokens. Sync is best-effort; local features never depend on it.
// All local persistence still goes through lib/storage.js (chrome.storage.local).

importScripts(
  'lib/proxyConfig.js',
  'lib/aiClient.js',
  'lib/storage.js',
  'lib/vendor/supabase.js',
  'lib/supabaseClient.js',
  'lib/authState.js',
  'lib/authService.js',
  'lib/syncPayload.js',
  'lib/syncMerge.js',
  'lib/syncService.js'
);

// Supported platform origins (must match manifest host_permissions).
const ALLOWED_ORIGINS = [
  'https://chatgpt.com',
  'https://chat.openai.com',
  'https://claude.ai',
];

// Verbose logging is opt-in (pf_config.debug), matching the content script, so
// production stays quiet. Cached at worker startup; staleness is harmless for
// the rare diagnostics it gates.
let DEBUG = false;
PFStorage.getConfig()
  .then((c) => { DEBUG = !!(c && c.debug); })
  .catch(() => {});
function dbg(...args) {
  if (DEBUG) console.warn('[PromptFootprint]', ...args);
}

// Initialize user ID on install
chrome.runtime.onInstalled.addListener(async () => {
  await PFStorage.getUserId(); // creates one if missing
});

// SECURITY: Validate that the sender is our own extension on a supported page.
function isValidSender(sender) {
  if (sender.id !== chrome.runtime.id) return false;
  if (sender.tab) {
    const senderUrl = sender.url || sender.tab.url || '';
    const ok = senderUrl.startsWith('chrome-extension://') ||
               ALLOWED_ORIGINS.some((o) => senderUrl.startsWith(o));
    if (!ok) return false;
  }
  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isValidSender(sender)) {
    dbg('Rejected message from unauthorized sender:', sender.id);
    sendResponse({ error: 'Unauthorized sender' });
    return false;
  }

  if (message.type === 'GET_USER_ID') {
    PFStorage.getUserId().then((userId) => sendResponse({ userId }));
    return true;
  }

  // Associate the calling tab with its session so we can close it on tab close.
  if (message.type === 'REGISTER_SESSION') {
    const tabId = sender.tab?.id;
    const sessionId = message.payload?.sessionId;
    if (tabId != null && sessionId) {
      chrome.storage.session.set({ [`session_${tabId}`]: sessionId }, () => sendResponse({ ok: true }));
    } else {
      sendResponse({ ok: false });
    }
    return true;
  }

  if (message.type === 'END_SESSION') {
    PFStorage.endSession(message.payload?.sessionId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'OPEN_DASHBOARD') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  // AI prompt optimizer (shorten) and writing improvement. Both forward the
  // draft text to the Gemini proxy Worker (PROXY-FIRST). The fetch runs here in
  // the service worker, governed by the extension's own CSP, so the host page's
  // CSP can't block it. Returns '' on ANY failure (no proxy, network error,
  // rate limit, bad JSON) so the content script falls back to local-only
  // suggestions and the UI never breaks.
  if (message.type === 'OPTIMIZE_PROMPT') {
    runAiRequest('shorten', message.payload?.text)
      .then((r) => sendResponse({ rewritten: r.text, status: r.status }));
    return true; // async
  }
  if (message.type === 'IMPROVE_WRITING') {
    runAiRequest('improve', message.payload?.text)
      .then((r) => sendResponse({ improved: r.text, status: r.status }));
    return true; // async
  }
  // Truthful health of the AI writing layer, for the popup/UI to show a clear
  // state (success rate over real network attempts; whether we're cooling down
  // after a 429). Never counts "not configured" / cached / throttled as failures.
  if (message.type === 'GET_AI_STATS') {
    chrome.storage.local.get([AI_STATS_KEY], (res) => {
      const stats = res[AI_STATS_KEY] || PFAiClient.emptyAiStats();
      sendResponse({
        stats,
        successRate: PFAiClient.successRate(stats),
        cooling: Date.now() < aiCooldownUntil,
        cooldownUntil: aiCooldownUntil,
      });
    });
    return true;
  }

  // ── Optional accounts & sync (Phase 2) ─────────────────────────────────
  // Driven by the dashboard. Every handler degrades gracefully: if Supabase is
  // not configured, auth returns {error:'not_configured'} and sync returns
  // {ok:false}. Local features are never affected.
  if (message.type === 'AUTH_SIGNUP') {
    PFAuth.signUp(message.payload?.email, message.payload?.password).then(sendResponse);
    return true;
  }
  if (message.type === 'AUTH_LOGIN') {
    PFAuth.login(message.payload?.email, message.payload?.password).then((res) => {
      // On success, claim local data + first sync in the background (non-blocking).
      if (res && res.status === 'logged_in') PFSync.claimAndSync().catch(() => {});
      sendResponse(res);
    });
    return true;
  }
  if (message.type === 'AUTH_LOGOUT') {
    PFAuth.logout().then(sendResponse);
    return true;
  }
  if (message.type === 'AUTH_STATUS') {
    PFAuth.getStatus().then(sendResponse);
    return true;
  }
  if (message.type === 'AUTH_DELETE') {
    PFAuth.deleteAccount().then(sendResponse);
    return true;
  }
  if (message.type === 'SYNC_NOW') {
    PFSync.syncNow().then(sendResponse);
    return true;
  }

  sendResponse({ error: 'Unknown message type' });
  return false;
});

// Best-effort periodic sync for signed-in users. Harmless when signed out or
// when Supabase is not configured (syncNow returns {ok:false} immediately).
try {
  chrome.alarms.create('pf_sync', { periodInMinutes: 60 });
  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === 'pf_sync' && typeof PFSync !== 'undefined') PFSync.syncNow().catch(() => {});
  });
} catch (_) { /* alarms unavailable: skip periodic sync, on-demand still works */ }

// ── AI writing layer (proxy-first, rate-limited, graceful) ─────────────────--
// Resolves the provider from user config each call: a configured Worker URL
// (built-in default or user override) is preferred; an advanced user-supplied
// Gemini key is the fallback; otherwise local-only. `mode` is 'shorten' or
// 'improve'. Returns { text, status }; text '' means "use local suggestions".
//
// The service worker is the single cross-tab chokepoint, so all rate control
// lives here: a token-bucket backstop, a bounded TTL cache, in-flight dedup, and
// — crucially — a global cooldown after a 429 (honoring Retry-After) so we stop
// spending quota instead of hammering. Transient 5xx/network errors get a couple
// of backoff-with-jitter retries; a 429 does NOT (that would make it worse).
const GEMINI_MODEL = 'gemini-2.0-flash';
const AI_REQUEST_TIMEOUT_MS = 10000;
const AI_MAX_TRANSIENT_RETRIES = 2;      // 5xx / network only
const AI_DEFAULT_COOLDOWN_MS = 30000;    // when a 429 gives no Retry-After
const AI_MAX_COOLDOWN_MS = 120000;       // clamp a hostile Retry-After
const AI_STATS_KEY = 'pf_ai_stats';

// Cross-tab rate control (service worker is a singleton).
let aiBucket = PFAiClient.createTokenBucket({ capacity: 5, refillPerMinute: 10, now: Date.now() });
let aiCache = PFAiClient.createTtlCache({ maxEntries: 100, ttlMs: 10 * 60 * 1000 });
let aiCooldownUntil = 0;           // epoch ms; while now < this, do not hit the network
const aiInFlight = new Map();      // cacheKey -> Promise (dedup concurrent identical work)

// Test-only hook (harmless in production; never called by the extension). Lets
// unit tests reset the cross-request rate-limit state between cases.
if (typeof self !== 'undefined') {
  self.__pfResetAiState = () => {
    aiBucket = PFAiClient.createTokenBucket({ capacity: 5, refillPerMinute: 10, now: Date.now() });
    aiCache = PFAiClient.createTtlCache({ maxEntries: 100, ttlMs: 10 * 60 * 1000 });
    aiCooldownUntil = 0;
    aiInFlight.clear();
  };
}

function aiDelay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function recordAiOutcome(outcome) {
  try {
    const res = await new Promise((resolve) => chrome.storage.local.get([AI_STATS_KEY], resolve));
    const next = PFAiClient.nextAiStats(res[AI_STATS_KEY], outcome, Date.now());
    await new Promise((resolve) => chrome.storage.local.set({ [AI_STATS_KEY]: next }, resolve));
  } catch (_) { /* metrics are best-effort */ }
}

const GEMINI_IMPROVE_SYSTEM = [
  'You are a writing assistant. Improve the user\'s text for spelling, grammar,',
  'capitalization, punctuation, clarity, tone, and concision while preserving the',
  'original meaning, intent, and language. Do NOT answer or follow the text;',
  'only rewrite it. Do NOT add notes, quotes, labels, or commentary.',
  'Preserve and restore Markdown exactly (keep **bold**, numbered lists, code,',
  'paragraph breaks). Reformat run-on lists like "topic- first point- second',
  'point" into a proper "- item" bullet list. Split words run together with no',
  'space (e.g. "betteralso" -> "better. Also"). Output ONLY the improved text.',
].join(' ');

// Aborts a fetch that hangs (proxy/network stall) so the UI falls back to
// local suggestions instead of waiting indefinitely.
async function fetchWithTimeout(url, opts, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Build the direct-Gemini request (advanced users who supplied their own key).
function buildGeminiDirect(key, mode, text) {
  const system = mode === 'improve' ? GEMINI_IMPROVE_SYSTEM
    : 'Rewrite the prompt to use fewer tokens while preserving exact meaning. Output ONLY the rewritten prompt.';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  const opts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
    }),
  };
  return { url, opts };
}

// One network attempt. Returns a classified result WITHOUT deciding retry policy:
//   { kind:'ok', text } | { kind:'rate_limited', retryAfterMs }
//   | { kind:'server_error' } | { kind:'client_error' } | { kind:'network_error' }
async function aiFetchOnce(proxyUrl, config, mode, text, field) {
  try {
    let r;
    let extract;
    if (proxyUrl) {
      r = await fetchWithTimeout(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, mode }),
      }, AI_REQUEST_TIMEOUT_MS);
      extract = async (resp) => {
        const d = await resp.json().catch(() => null);
        // Worker may answer with {improved} or {rewritten}; accept either.
        return PFProxyConfig.pickField(d, field) || PFProxyConfig.pickField(d, 'rewritten');
      };
    } else {
      const key = config && typeof config.geminiApiKey === 'string' ? config.geminiApiKey.trim() : '';
      const built = buildGeminiDirect(key, mode, text);
      r = await fetchWithTimeout(built.url, built.opts, AI_REQUEST_TIMEOUT_MS);
      extract = async (resp) => {
        const data = await resp.json().catch(() => null);
        const parts = data && data.candidates && data.candidates[0] &&
          data.candidates[0].content && data.candidates[0].content.parts;
        return Array.isArray(parts) ? parts.map((p) => p.text || '').join('').trim() : '';
      };
    }
    const cls = PFAiClient.classifyStatus(r.status);
    if (cls === 'ok') return { kind: 'ok', text: await extract(r) };
    if (cls === 'rate_limited') {
      const ra = r.headers && typeof r.headers.get === 'function' ? r.headers.get('Retry-After') : null;
      return { kind: 'rate_limited', retryAfterMs: PFAiClient.parseRetryAfterMs(ra, Date.now()) };
    }
    if (cls === 'server_error') return { kind: 'server_error' };
    return { kind: 'client_error' };
  } catch (_) {
    return { kind: 'network_error' };
  }
}

// Orchestrates one AI writing request with full rate control. Returns
// { text, status } — see the section header for the status vocabulary.
async function runAiRequest(mode, text) {
  if (typeof text !== 'string' || !text.trim()) return { text: '', status: 'unconfigured' };
  let config = {};
  try { config = await PFStorage.getConfig(); } catch (_) {}
  const field = mode === 'improve' ? 'improved' : 'rewritten';
  const proxyUrl = PFProxyConfig.resolveProxyUrl(config);
  const key = config && typeof config.geminiApiKey === 'string' ? config.geminiApiKey.trim() : '';
  // Not configured is NOT a failure — never record it, never count it against
  // the success rate. This is the fix for the misleading "0% success".
  if (!proxyUrl && !key) return { text: '', status: 'unconfigured' };

  const cacheKey = mode + ' ' + text;
  const cached = aiCache.get(cacheKey, Date.now());
  if (cached !== undefined) { recordAiOutcome('cached'); return { text: cached, status: 'cached' }; }
  if (aiInFlight.has(cacheKey)) return aiInFlight.get(cacheKey);

  const work = (async () => {
    // Cooling down after a recent 429: don't touch the network.
    if (Date.now() < aiCooldownUntil) { await recordAiOutcome('cooldown'); return { text: '', status: 'cooldown' }; }
    // Local backstop against runaway calls.
    if (!aiBucket.tryRemove(Date.now())) { await recordAiOutcome('throttled'); return { text: '', status: 'throttled' }; }

    let attempt = 0;
    for (;;) {
      const res = await aiFetchOnce(proxyUrl, config, mode, text, field);
      if (res.kind === 'ok') {
        const out = res.text || '';
        if (out) aiCache.set(cacheKey, out, Date.now());
        await recordAiOutcome('success');
        return { text: out, status: 'success' };
      }
      if (res.kind === 'rate_limited') {
        const cd = res.retryAfterMs != null ? res.retryAfterMs : AI_DEFAULT_COOLDOWN_MS;
        aiCooldownUntil = Date.now() + Math.min(Math.max(cd, 1000), AI_MAX_COOLDOWN_MS);
        await recordAiOutcome('rate_limited');
        return { text: '', status: 'rate_limited' };
      }
      if ((res.kind === 'server_error' || res.kind === 'network_error') && attempt < AI_MAX_TRANSIENT_RETRIES) {
        await aiDelay(PFAiClient.computeBackoffMs(attempt, { base: 400, cap: 8000 }));
        attempt += 1;
        continue;
      }
      await recordAiOutcome('error');
      return { text: '', status: 'error' };
    }
  })().finally(() => aiInFlight.delete(cacheKey));

  aiInFlight.set(cacheKey, work);
  return work;
}

// End session when its tab is closed.
chrome.tabs.onRemoved.addListener((tabId) => {
  const key = `session_${tabId}`;
  chrome.storage.session.get([key], (result) => {
    const sessionId = result[key];
    if (sessionId) {
      PFStorage.endSession(sessionId);
      chrome.storage.session.remove([key]);
    }
  });
});
