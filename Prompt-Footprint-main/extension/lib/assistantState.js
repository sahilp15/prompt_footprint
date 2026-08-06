// PromptFootprint In-Page Assistant — state, settings, and scheduling.
// ---------------------------------------------------------------------------
// The rules that decide WHAT the in-page assistant shows, kept free of the DOM
// so they can be unit-tested under Node. `overlay/assistant.js` owns the pixels;
// this file owns the decisions:
//
//   • which of the eleven UI states applies right now
//   • whether an optimization is worth recommending at all
//   • the debounce that stops analysis running on every keystroke
//   • the request guard that discards a result whose prompt has since changed
//   • the assistant's slice of pf_config, with defaults and validation
//
// Everything here is pure or explicitly injected (timers are parameters), so a
// test never has to wait on a real clock.

(function (root) {
  'use strict';

  // ── Thresholds ────────────────────────────────────────────────────────────

  /** Below this the composer is treated as empty — no indicator, no analysis. */
  const MIN_VISIBLE_CHARS = 16;
  /** Analysis waits for a pause in typing, not a keystroke. */
  const DEBOUNCE_MS = 600;
  /** A saving has to be worth interrupting someone for. Both floors must clear. */
  const MIN_SAVED_TOKENS = 4;
  const MIN_SAVED_PERCENT = 4;

  // The eleven states the UI is specified to have. Exported so the renderer and
  // the tests agree on the vocabulary.
  const STATES = [
    'empty',        // composer is empty (or too short to say anything about)
    'typing',       // user is mid-burst; last result is stale
    'analyzing',    // engine is running
    'available',    // a worthwhile optimization exists
    'concise',      // analyzed, nothing meaningful to cut
    'failed',       // the engine threw
    'unsupported',  // no composer could be identified on this page
    'offline',      // enhanced mode wanted, but the browser is offline
    'unavailable',  // the local engine bundle did not load
    'replaced',     // the prompt was just replaced (transient success state)
    'undo',         // replacement done, undo still available
  ];

  // ── Settings ──────────────────────────────────────────────────────────────

  const LEVELS = ['light', 'balanced', 'maximum'];
  const MODES = ['local', 'enhanced'];

  /**
   * Assistant defaults. `enabled` intentionally reuses the existing
   * `writingChecksEnabled` config key rather than introducing a second master
   * switch — the popup toggle, the storage validation, and the CONFIG_UPDATED
   * message for it already exist.
   */
  const DEFAULTS = {
    enabled: true,
    level: 'balanced',
    autoAnalyze: true,
    showImpact: true,
    mode: 'local',
    animations: true,
  };

  /** Project a `pf_config` object onto the assistant's settings, with defaults. */
  function readSettings(config) {
    const c = config || {};
    return {
      enabled: c.writingChecksEnabled !== false,
      level: LEVELS.includes(c.assistantLevel) ? c.assistantLevel : DEFAULTS.level,
      autoAnalyze: c.assistantAutoAnalyze !== false,
      showImpact: c.assistantShowImpact !== false,
      // Enhanced mode is doubly gated: the user must have picked it AND have
      // turned on cloud analysis. Without both, prompts stay on the device.
      mode: (MODES.includes(c.assistantMode) && c.assistantMode === 'enhanced' && c.cloudAnalysisEnabled === true)
        ? 'enhanced'
        : 'local',
      animations: c.assistantAnimations !== false,
    };
  }

  /** The `pf_config` patch for a settings change (validated, unknown keys dropped). */
  function settingsPatch(partial) {
    const p = partial || {};
    const out = {};
    if (typeof p.enabled === 'boolean') out.writingChecksEnabled = p.enabled;
    if (LEVELS.includes(p.level)) out.assistantLevel = p.level;
    if (typeof p.autoAnalyze === 'boolean') out.assistantAutoAnalyze = p.autoAnalyze;
    if (typeof p.showImpact === 'boolean') out.assistantShowImpact = p.showImpact;
    if (MODES.includes(p.mode)) out.assistantMode = p.mode;
    if (typeof p.animations === 'boolean') out.assistantAnimations = p.animations;
    return out;
  }

  /** Patch that puts every assistant preference back to its default. */
  function resetPatch() {
    return {
      writingChecksEnabled: DEFAULTS.enabled,
      assistantLevel: DEFAULTS.level,
      assistantAutoAnalyze: DEFAULTS.autoAnalyze,
      assistantShowImpact: DEFAULTS.showImpact,
      assistantMode: DEFAULTS.mode,
      assistantAnimations: DEFAULTS.animations,
    };
  }

  // ── Is this worth showing? ────────────────────────────────────────────────

  /**
   * True when an optimization is worth recommending.
   *
   * The bar is deliberately high. An assistant that offers to save two tokens on
   * a one-line prompt trains the user to ignore it, so a small win is reported
   * as "Already concise" instead. A result the validator did not pass is never
   * offered at all.
   */
  function isWorthOffering(analytics, validation) {
    if (!analytics) return false;
    if (validation && validation.ok === false) return false;
    const saved = analytics.tokensSaved || 0;
    const pct = analytics.percentReduction || 0;
    return saved >= MIN_SAVED_TOKENS && pct >= MIN_SAVED_PERCENT;
  }

  // ── State selection ───────────────────────────────────────────────────────

  /**
   * The state the UI should be in. One function, evaluated in priority order, so
   * "why is it showing that?" has exactly one answer to read.
   *
   * input: {
   *   engineReady, composerFound, text, typing, analyzing, error,
   *   online, mode, analytics, validation, replaced, canUndo
   * }
   */
  function nextState(input) {
    const s = input || {};
    if (!s.engineReady) return 'unavailable';
    if (!s.composerFound) return 'unsupported';

    const text = typeof s.text === 'string' ? s.text : '';
    if (text.trim().length < MIN_VISIBLE_CHARS) return 'empty';

    // A completed replacement outranks live analysis for a moment so the user
    // sees their action confirmed rather than the panel immediately re-analyzing.
    if (s.replaced) return 'replaced';
    if (s.canUndo) return 'undo';

    if (s.error) return 'failed';
    if (s.mode === 'enhanced' && s.online === false) return 'offline';
    if (s.analyzing) return 'analyzing';
    if (s.typing) return 'typing';
    if (!s.analytics) return 'typing';
    return isWorthOffering(s.analytics, s.validation) ? 'available' : 'concise';
  }

  /** Whether the collapsed indicator should be on screen in a given state. */
  function isIndicatorVisible(state) {
    return state !== 'empty' && state !== 'unsupported' && state !== 'unavailable';
  }

  // ── Debounce ──────────────────────────────────────────────────────────────

  /**
   * Trailing-edge debounce with injectable timers.
   *
   * Analysis is the expensive part of the feature, so it must run once per
   * typing pause, never once per keystroke. Passing the timer functions in keeps
   * this testable without a real clock.
   */
  function createDebouncer(fn, delay, timers) {
    // The default timers are WRAPPED, not referenced. `{ setTimeout }` would
    // later be invoked as `t.setTimeout(...)`, i.e. with `t` as the receiver,
    // and Chrome rejects that with "Illegal invocation" — Node does not, so
    // this is exactly the kind of bug that passes tests and fails in a browser.
    const t = timers || {
      setTimeout: (fn2, ms) => setTimeout(fn2, ms),
      clearTimeout: (id) => clearTimeout(id),
    };
    const wait = typeof delay === 'number' ? delay : DEBOUNCE_MS;
    let handle = null;
    return {
      schedule(...args) {
        if (handle !== null) t.clearTimeout(handle);
        handle = t.setTimeout(() => { handle = null; fn(...args); }, wait);
      },
      cancel() {
        if (handle !== null) t.clearTimeout(handle);
        handle = null;
      },
      get pending() { return handle !== null; },
    };
  }

  // ── Stale-request cancellation ────────────────────────────────────────────

  /**
   * Monotonic token guard.
   *
   * Optimization can be asynchronous (a worker hop, or the optional network
   * call). If the prompt changed while a request was in flight, its answer
   * describes text that no longer exists and must be thrown away — showing it
   * would be worse than showing nothing. `issue()` invalidates every outstanding
   * token; `isCurrent(token)` is the check every completion handler runs.
   */
  function createRequestGuard() {
    let current = 0;
    return {
      issue() { current += 1; return current; },
      isCurrent(token) { return token === current; },
      /** Invalidate everything in flight without starting a new request. */
      cancelAll() { current += 1; },
      get token() { return current; },
    };
  }

  const PFAssistantState = {
    MIN_VISIBLE_CHARS,
    DEBOUNCE_MS,
    MIN_SAVED_TOKENS,
    MIN_SAVED_PERCENT,
    STATES,
    LEVELS,
    MODES,
    DEFAULTS,
    readSettings,
    settingsPatch,
    resetPatch,
    isWorthOffering,
    nextState,
    isIndicatorVisible,
    createDebouncer,
    createRequestGuard,
  };

  if (root) root.PFAssistantState = PFAssistantState;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFAssistantState;
})(typeof self !== 'undefined' ? self : this);
