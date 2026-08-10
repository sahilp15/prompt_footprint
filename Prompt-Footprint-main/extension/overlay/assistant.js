// PromptFootprint — in-page writing assistant.
// ---------------------------------------------------------------------------
// The small floating indicator that sits by the ChatGPT / Claude composer while
// you write, tells you what your prompt is costing, and offers a shorter version
// that means the same thing.
//
// Three rules shape the whole file:
//
//   1. THE PROMPT IS THE USER'S. Nothing is ever rewritten without an explicit
//      click, every replacement is undoable to the exact original string, and
//      the original is kept verbatim rather than reconstructed.
//   2. IT MUST NOT COST ANYTHING TO HAVE OPEN. Analysis is debounced to a typing
//      pause, results whose text has changed are discarded, the DOM is queried
//      on mutation bursts rather than on a timer, and the panel is anchored to
//      the composer's corner so growth never triggers a re-measure.
//   3. FAILURE IS QUIET. Every state — no composer, no engine, offline, engine
//      error — has a calm inline presentation, and none of them stop the user
//      from using ChatGPT normally.
//
// The optimizer itself is NOT implemented here. This is the surface for the
// Token Cutter engine (lib/tokenCutter.bundle.js, built from the same source the
// dashboard's Token Cutter uses), so the two can never disagree about what a
// prompt costs or what is safe to remove.

(function (root) {
  'use strict';

  const HOST_ID = 'pf-assistant-root';
  const CSS_PATH = 'extension/overlay/assistant.css';

  // Layout keys the previous suggestion chip persisted. The assistant anchors
  // itself to the composer instead of being dragged, so these are only ever
  // deleted — "reset position" means "stop honouring a position you saved
  // before the rebuild".
  const LEGACY_POSITION_KEYS = ['pf_assistant_pos', 'pf_optimizer_pos', 'pf_optimizer_size'];

  /** Enhanced mode ceiling, matching the proxy Worker's own limit. */
  const ENHANCED_MAX_CHARS = 4000;
  /** How long the success state shows before settling into "undo available". */
  const SUCCESS_MS = 1500;
  /** How long the undo toast stays on screen. Undo itself remains in the panel. */
  const TOAST_MS = 9000;
  /** Mutation bursts are coalesced into at most one re-detect per this window. */
  const DETECT_THROTTLE_MS = 250;
  /** Safety net for layout changes no observer reports (CSS transitions, etc.). */
  const ANCHOR_TICK_MS = 500;

  const ICONS = {
    // The PromptFootprint mark: a leaf built from a single stroke.
    leaf: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>',
    drop: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/></svg>',
    chevron: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>',
    shield: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>',
    check: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    info: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
    gear: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  };

  /** Same text once every run of whitespace is treated as one space. */
  function sameIgnoringWhitespace(a, b) {
    const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return norm(a) === norm(b);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  const MARKUP = `
    <div class="shell" part="shell">
      <div class="bar" id="bar" role="button" tabindex="0" aria-expanded="false"
           aria-label="PromptFootprint prompt assistant">
        <span class="mark" aria-hidden="true">${ICONS.leaf}</span>
        <span class="headline" id="headline"></span>
        <span class="pct" id="pct" hidden></span>
        <span class="sub" id="sub" hidden></span>
        <span class="bar-spacer"></span>
        <button class="bar-action" id="quick-optimize" type="button" hidden>Optimize</button>
        <span class="bar-chevron" aria-hidden="true">${ICONS.chevron}</span>
      </div>

      <div class="model-pill" id="model-pill" hidden>
        <span class="model-dot" aria-hidden="true"></span>
        <span class="model-name" id="model-name"></span>
      </div>

      <div class="panel" id="panel" hidden>
        <div class="savings" id="savings" hidden>
          <div class="savings-headline" id="savings-headline"></div>
          <div class="savings-detail" id="savings-detail"></div>
        </div>

        <div class="metrics" id="metrics"></div>

        <div class="note" id="note" hidden></div>

        <div class="compare" id="compare">
          <div>
            <div class="pane-label">Your prompt <span class="count" id="count-original"></span></div>
            <div class="pane" id="pane-original"></div>
          </div>
          <div>
            <div class="pane-label">Optimized <span class="count" id="count-optimized"></span></div>
            <div class="pane is-optimized" id="pane-optimized"></div>
          </div>
        </div>

        <div class="explain" id="explain"></div>

        <div class="ledger" id="ledger" hidden>
          <div class="ledger-col">
            <div class="ledger-title">Removed</div>
            <ul class="ledger-list" id="ledger-removed"></ul>
          </div>
          <div class="ledger-col">
            <div class="ledger-title">Preserved</div>
            <ul class="ledger-list" id="ledger-preserved"></ul>
          </div>
        </div>

        <div class="preserved" id="preserved">
          <span aria-hidden="true">${ICONS.shield}</span>
          <span id="preserved-text"></span>
        </div>

        <div class="level">
          <span>Compression</span>
          <span class="segmented" id="levels" role="group" aria-label="Compression level">
            <button type="button" data-level="light" aria-pressed="false">Light</button>
            <button type="button" data-level="balanced" aria-pressed="true">Balanced</button>
            <button type="button" data-level="maximum" aria-pressed="false">Maximum</button>
          </span>
        </div>

        <div class="actions">
          <button class="act primary" id="act-replace" type="button">Replace prompt</button>
          <button class="act" id="act-copy" type="button">Copy optimized</button>
          <button class="act" id="act-retry" type="button">Try again</button>
          <button class="act quiet" id="act-keep" type="button">Keep original</button>
          <button class="act" id="act-undo" type="button" hidden>Undo</button>
        </div>

        <div class="settings" id="settings" hidden>
          <div class="settings-title">Assistant settings</div>
          <label class="setting">Analyze while I type
            <span class="switch"><input type="checkbox" id="set-auto"><span></span></span>
          </label>
          <label class="setting">Show environmental estimates
            <span class="switch"><input type="checkbox" id="set-impact"><span></span></span>
          </label>
          <label class="setting">Animations
            <span class="switch"><input type="checkbox" id="set-motion"><span></span></span>
          </label>
          <label class="setting" id="set-mode-row">Enhanced (API) optimization
            <span class="switch"><input type="checkbox" id="set-mode"><span></span></span>
          </label>
          <div class="setting-note" id="set-mode-note"></div>
          <label class="setting">Model-detection debug panel
            <span class="switch"><input type="checkbox" id="set-debug"><span></span></span>
          </label>
          <div class="actions">
            <button class="act quiet" id="set-reset" type="button">Reset preferences</button>
            <button class="act quiet" id="set-off" type="button">Turn assistant off</button>
          </div>
        </div>

        <div class="debug" id="debug" hidden>
          <div class="debug-title">Model detection</div>
          <div class="debug-rows" id="debug-rows"></div>
        </div>

        <div class="foot">
          <span class="privacy" id="privacy"></span>
          <button class="icon-btn" id="gear" type="button" aria-label="Assistant settings"
                  aria-expanded="false">${ICONS.gear}</button>
        </div>
      </div>
    </div>

    <div class="toast" id="toast" hidden>
      <span class="tick" aria-hidden="true">${ICONS.check}</span>
      <span id="toast-text">Prompt replaced</span>
      <button class="act quiet" id="toast-undo" type="button">Undo</button>
    </div>

    <div class="sr" id="live" role="status" aria-live="polite"></div>
  `;

  /**
   * Build an assistant instance.
   *
   * Dependencies are injected rather than reached for, so the whole thing can be
   * driven from a test without a browser extension around it:
   *   engine     the Token Cutter bundle (PFTokenCutter)
   *   composer   PFComposer
   *   state      PFAssistantState
   *   format     PFFormat (impact wording)
   *   getConfig / setConfig   the existing pf_config layer
   *   requestEnhanced(text)   optional; resolves { text, status }
   *   onReplaced(savings)     called once per accepted replacement
   *   getModel()              current model observation, or null
   *   present                 PFModelPresent (model wording)
   *   subscribeModel(fn)      registers a model-change callback; returns teardown
   */
  function createAssistant(deps) {
    const d = deps || {};
    const engine = d.engine;
    const composerLib = d.composer;
    const S = d.state;
    const format = d.format;
    const log = d.log || function () {};
    const platform = d.platform || 'chatgpt';
    // Model detection is CENTRALIZED: the assistant never queries the page for a
    // model. It is handed an observation and told when it changes, which is what
    // stops two components disagreeing about what is selected — and what makes
    // the change path a single function instead of a rescan.
    const present = d.present || null;
    // Projects avoided INPUT tokens onto the whole interaction. Without it the
    // panel can only speak in tokens: the engine's own impact figure is a
    // token-linear number, and showing it as "energy saved" would claim that
    // cutting half the input halves the interaction, which it does not.
    const projectSavings = typeof d.projectSavings === 'function' ? d.projectSavings : null;

    // ── Instance state ──────────────────────────────────────────────────────
    let host = null;
    let shadow = null;
    let el = {};                      // id -> element inside the shadow root
    let started = false;
    let destroyed = false;

    let settings = S.DEFAULTS;
    let composerEl = null;
    let text = '';
    let analysis = null;              // CutterResult from the engine
    let analytics = null;
    let optimizedText = '';
    let enhancement = null;           // { status, applied, reason }
    let uiState = 'empty';
    let expanded = false;
    let analyzing = false;
    let typing = false;
    let engineError = null;
    let dismissedFor = null;          // text the user said "Keep original" to
    let undoRecord = null;            // { el, before, after }
    let successUntil = 0;
    let writingProgrammatically = false;
    let replacing = false;            // re-entrancy guard for the write itself
    let pendingWrite = null;          // { intended } — awaiting the editor's echo
    let driftedAt = 0;                // last refused replace, for the inline note
    let lastRenderedSaved = 0;
    let observation = null;           // what model the page currently has selected
    let modelPillText = '';           // last text rendered, so we only transition on change
    let modelChangedAt = 0;           // for the debug panel's "last change"

    const guard = S.createRequestGuard();
    const debouncer = S.createDebouncer(() => { typing = false; analyze(); }, S.DEBOUNCE_MS);

    // Every listener/observer/timer registered here is torn down by destroy().
    const cleanups = [];
    let detectTimer = null;
    let anchorTimer = null;
    let successTimer = null;
    let toastTimer = null;
    let flashTimer = null;
    let pasteTimer = null;
    let anchorRaf = 0;
    let countRaf = 0;
    let anchorEl = null;              // the composer's visible surface (cached)

    function on(target, type, handler, opts) {
      if (!target || !target.addEventListener) return;
      target.addEventListener(type, handler, opts);
      cleanups.push(() => target.removeEventListener(type, handler, opts));
    }

    // ── Mounting ────────────────────────────────────────────────────────────

    /**
     * Create the host element and its shadow root, exactly once.
     *
     * Duplicate mounting is the classic SPA extension bug: the watchdog fires,
     * the script re-runs on a soft navigation, and the user ends up with two
     * indicators fighting over one composer. Two guards prevent it — an instance
     * flag, and an id lookup that also catches a *different* instance having
     * mounted already.
     */
    function mount() {
      if (destroyed) return false;
      if (host && host.isConnected) return true;

      const existing = document.getElementById(HOST_ID);
      if (existing && existing !== host) {
        // Another instance owns the UI. Adopt nothing, mount nothing.
        log('assistant: host already present — not mounting a second one');
        return false;
      }

      host = document.createElement('div');
      host.id = HOST_ID;
      host.setAttribute('data-pf-assistant', '1');
      shadow = host.attachShadow({ mode: 'open' });

      // The stylesheet is a real extension resource loaded into the shadow root,
      // so page CSS cannot reach our UI and our CSS cannot leak onto the page.
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      try {
        link.href = chrome.runtime.getURL(CSS_PATH);
      } catch (_) {
        link.href = CSS_PATH;
      }
      shadow.appendChild(link);

      const wrap = document.createElement('div');
      wrap.innerHTML = MARKUP;
      while (wrap.firstChild) shadow.appendChild(wrap.firstChild);

      shadow.querySelectorAll('[id]').forEach((node) => { el[node.id] = node; });
      el.shell = shadow.querySelector('.shell');

      host.hidden = true;
      document.body.appendChild(host);

      bindUi();
      applyTheme();
      applyMotion();
      // Entrance plays on the first reveal, not on mount, so a page that never
      // shows the assistant never animates anything.
      return true;
    }

    function bindUi() {
      on(el.bar, 'click', (e) => {
        if (e.target.closest('#quick-optimize')) return;   // handled separately
        toggleExpanded();
      });
      on(el.bar, 'keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        toggleExpanded();
      });
      on(el['quick-optimize'], 'click', (e) => {
        e.stopPropagation();
        // The quick action opens the panel rather than replacing straight away:
        // the user has not seen what would change yet.
        setExpanded(true);
      });

      on(el['act-replace'], 'click', replacePrompt);
      on(el['act-copy'], 'click', copyOptimized);
      on(el['act-retry'], 'click', tryAgain);
      on(el['act-keep'], 'click', keepOriginal);
      on(el['act-undo'], 'click', undo);
      on(el['toast-undo'], 'click', undo);

      on(el.levels, 'click', (e) => {
        const btn = e.target.closest('button[data-level]');
        if (!btn) return;
        setLevel(btn.dataset.level);
      });

      on(el.gear, 'click', () => {
        const open = el.settings.hidden;
        el.settings.hidden = !open;
        el.gear.setAttribute('aria-expanded', String(open));
        measure();
      });

      on(el['set-debug'], 'change', () => save({ debugPanel: el['set-debug'].checked }));
      on(el['set-auto'], 'change', () => save({ autoAnalyze: el['set-auto'].checked }));
      on(el['set-impact'], 'change', () => save({ showImpact: el['set-impact'].checked }));
      on(el['set-motion'], 'change', () => save({ animations: el['set-motion'].checked }));
      on(el['set-mode'], 'change', () => {
        save({ mode: el['set-mode'].checked ? 'enhanced' : 'local' });
      });
      on(el['set-reset'], 'click', async () => {
        if (typeof d.resetSettings === 'function') await d.resetSettings();
        dismissedFor = null;
        try { chrome.storage.local.remove(LEGACY_POSITION_KEYS); } catch (_) { /* optional */ }
        await refreshSettings();
        analyze();
      });
      on(el['set-off'], 'click', () => save({ enabled: false }));
    }

    // ── Settings ────────────────────────────────────────────────────────────

    async function refreshSettings() {
      let config = {};
      try {
        config = (typeof d.getConfig === 'function' ? await d.getConfig() : {}) || {};
      } catch (_) { config = {}; }
      applySettings(S.readSettings(config));
    }

    function applySettings(next) {
      const wasEnabled = settings.enabled;
      settings = next;
      applyMotion();
      if (!settings.enabled) {
        hide();
        return;
      }
      if (!wasEnabled) analyze();
      syncSettingsUi();
      render();
    }

    async function save(partial) {
      const patch = S.settingsPatch(partial);
      settings = { ...settings, ...partial };   // optimistic, for instant feedback
      syncSettingsUi();
      applyMotion();
      if (typeof d.setConfig === 'function') {
        try { await d.setConfig(patch); } catch (_) { /* non-fatal */ }
      }
      // Re-read the stored config as the authority. This is what makes
      // "enhanced" snap back to "local" when cloud analysis has not been opted
      // into: the gate lives in one place and the UI cannot talk itself past it.
      await refreshSettings();
      if (!settings.enabled) { hide(); return; }
      // A level/mode/auto change invalidates whatever is on screen.
      guard.cancelAll();
      analyze();
    }

    function syncSettingsUi() {
      if (!el['set-auto']) return;
      el['set-auto'].checked = settings.autoAnalyze;
      el['set-impact'].checked = settings.showImpact;
      el['set-motion'].checked = settings.animations;
      el['set-debug'].checked = settings.debugPanel;
      el['set-mode'].checked = settings.mode === 'enhanced';
      el['set-mode-note'].textContent = settings.mode === 'enhanced'
        ? 'Your prompt is sent to your configured proxy for a stronger rewrite. Local checks still validate the result.'
        : 'Off — everything is optimized on this device. Enable cloud analysis in the extension popup to use this.';
      shadow.querySelectorAll('#levels button[data-level]').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.level === settings.level));
      });
      el.privacy.innerHTML = settings.mode === 'enhanced'
        ? `${ICONS.shield}<span>Enhanced mode · validated locally</span>`
        : `${ICONS.shield}<span>Processed locally</span>`;
    }

    function setLevel(level) {
      if (!S.LEVELS.includes(level) || level === settings.level) return;
      save({ level });
    }

    function applyMotion() {
      if (!host) return;
      if (settings.animations) host.removeAttribute('data-motion');
      else host.setAttribute('data-motion', 'off');
    }

    // ── Theme ───────────────────────────────────────────────────────────────

    /**
     * Follow the HOST PAGE's theme rather than the OS.
     *
     * ChatGPT and Claude both let you pick a theme independently of the system
     * setting, so `prefers-color-scheme` is only the last resort here. The class
     * and data-attribute checks cover both apps today; the luminance probe is
     * what keeps this working when they change their markup.
     */
    function detectTheme() {
      const html = document.documentElement;
      const body = document.body;
      const flag = (node) => {
        if (!node) return null;
        if (node.classList?.contains('dark')) return 'dark';
        if (node.classList?.contains('light')) return 'light';
        const attr = node.getAttribute?.('data-theme') || node.getAttribute?.('data-mode') ||
                     node.getAttribute?.('data-color-scheme');
        if (attr === 'dark' || attr === 'light') return attr;
        return null;
      };
      const explicit = flag(html) || flag(body);
      if (explicit) return explicit;

      try {
        const bg = getComputedStyle(body || html).backgroundColor;
        const m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(bg || '');
        if (m) {
          const lum = (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255;
          return lum < 0.45 ? 'dark' : 'light';
        }
      } catch (_) { /* fall through */ }

      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark' : 'light';
    }

    function applyTheme() {
      if (!host) return;
      const theme = detectTheme();
      if (host.getAttribute('data-theme') !== theme) host.setAttribute('data-theme', theme);
    }

    // ── Composer binding ────────────────────────────────────────────────────

    /**
     * Re-run detection and rebind if the composer element changed.
     *
     * ChatGPT replaces the composer node on navigation, model switch, and when
     * an attachment is added, so "the composer" is an identity that has to be
     * re-established rather than a reference that can be held.
     */
    function detect() {
      if (destroyed || !settings.enabled) return;
      // The page's theme and its composer change for the same reasons (a
      // navigation, a re-render), so they are refreshed together.
      applyTheme();
      const found = composerLib.findComposer(document, { adapterSelector: d.adapterSelector });
      if (found === composerEl) { anchor(); return; }

      composerEl = found;
      anchorEl = null;                  // the cached surface belongs to the old node
      if (!composerEl) {
        // Not an error state the user needs to act on — the page simply has no
        // composer right now (a settings screen, a shared conversation).
        guard.cancelAll();
        debouncer.cancel();
        analysis = null;
        analytics = null;
        render();
        return;
      }

      log('assistant: composer bound —', composerEl.tagName,
          composerEl.id || composerEl.className || '(unnamed)');
      observeComposerSize();
      // Rebinding mid-draft (a re-render) must not lose the analysis, so read
      // the new element and only re-analyze when the text actually differs.
      const nextText = composerLib.readText(composerEl);
      if (nextText !== text) {
        text = nextText;
        analyze();
      } else {
        anchor();
        render();
      }
    }

    function scheduleDetect() {
      if (detectTimer || destroyed) return;
      detectTimer = setTimeout(() => {
        detectTimer = null;
        applyTheme();
        detect();
      }, DETECT_THROTTLE_MS);
    }

    // ── Input handling ──────────────────────────────────────────────────────

    function handleInput(e) {
      if (!settings.enabled || destroyed) return;
      // Our own writes dispatch input events; they are not the user typing.
      if (writingProgrammatically) return;
      const target = e.target;
      if (!target) return;
      if (composerEl && target !== composerEl && !composerEl.contains(target)) {
        // The event came from somewhere else — it may be a composer we have not
        // detected yet (e.g. straight after a navigation).
        scheduleDetect();
        return;
      }
      if (!composerEl) { scheduleDetect(); return; }

      const next = composerLib.readText(composerEl);
      if (next === text) return;

      // Our own write, echoed back by the host editor — possibly a moment later,
      // and possibly with whitespace normalized to the editor's taste. Adopt
      // what it actually produced so `text` and the undo record describe the
      // real contents. Matching on normalized text (not a time window) means a
      // genuine keystroke can never be swallowed by this branch: it would change
      // the content, not just the spacing.
      if (pendingWrite && sameIgnoringWhitespace(next, pendingWrite.intended)) {
        pendingWrite = null;
        text = next;
        if (undoRecord) undoRecord.after = next;
        render();
        return;
      }
      pendingWrite = null;
      text = next;

      // Editing after a replacement means the stored original no longer
      // corresponds to what is on screen, so undo is retired honestly.
      if (undoRecord && next !== undoRecord.after) clearUndo();
      if (dismissedFor !== null && next !== dismissedFor) dismissedFor = null;
      driftedAt = 0;

      guard.cancelAll();          // anything in flight now describes stale text
      typing = true;
      analyzing = false;
      engineError = null;
      render();

      if (settings.autoAnalyze) debouncer.schedule();
      else debouncer.cancel();
    }

    // ── Model ───────────────────────────────────────────────────────────────

    /**
     * Adopt a new model observation.
     *
     * Called once at start and then only from the detector's change event —
     * never on a timer, and never by scraping the page from here. Three things
     * happen, in this order, and the order matters:
     *
     *   1. the pill updates immediately, so the user sees the switch land;
     *   2. anything in flight is cancelled, because a result computed for the
     *        previous model describes a model they have moved away from;
     *   3. the prompt is re-analyzed against the new target.
     *
     * Step 3 is a re-analysis rather than a re-render because the target model
     * feeds the optimizer's final readability check — a switch to a model we
     * cannot identify legitimately produces a slightly less dense rewrite.
     */
    function setModel(next) {
      if (destroyed) return;
      const changed = !!next && (!observation ||
        observation.canonicalModel !== next.canonicalModel ||
        observation.selectedLabel !== next.selectedLabel ||
        observation.reasoningMode !== next.reasoningMode ||
        observation.routing !== next.routing);
      observation = next || null;
      if (!changed) { renderModel(); return; }

      modelChangedAt = Date.now();
      renderModel();
      if (!analysis) { render(); return; }
      guard.cancelAll();
      analyze();
    }

    /**
     * The optimizer's view of the target model.
     *
     * Only what the final readability check needs. `known` is the load-bearing
     * field: an unmapped label is a real, named selection but not one we have
     * calibrated compression against, so the optimizer keeps a little more
     * explicit structure. It never changes which information survives.
     */
    function targetModel() {
      if (!observation) return null;
      const o = observation;
      return {
        provider: o.provider || 'unknown',
        canonicalModel: o.canonicalModel || null,
        label: o.selectedLabel || null,
        tier: o.tier || null,
        reasoningClass: o.reasoningMode || null,
        known: !!o.canonicalModel,
      };
    }

    /** The pill, updated in place with a subtle transition — never a toast. */
    function renderModel() {
      if (!el['model-pill']) return;
      const text = present && observation ? present.pillLabel(observation) : null;
      if (!text) {
        el['model-pill'].hidden = true;
        modelPillText = '';
        return;
      }
      el['model-pill'].hidden = false;
      if (text === modelPillText) return;
      modelPillText = text;
      el['model-name'].textContent = text;
      // A class the stylesheet animates for one beat. Re-triggered by removing
      // it, forcing a reflow, and re-adding — otherwise a second change inside
      // the animation window would not play.
      if (settings.animations) {
        el['model-pill'].classList.remove('is-changed');
        void el['model-pill'].offsetWidth;
        el['model-pill'].classList.add('is-changed');
      }
      if (expanded && settings.debugPanel) renderDebug();
    }

    // ── Analysis ────────────────────────────────────────────────────────────

    async function analyze() {
      if (destroyed || !settings.enabled) return;
      if (!composerEl) { render(); return; }

      text = composerLib.readText(composerEl);
      const subject = text;

      if (subject.trim().length < S.MIN_VISIBLE_CHARS) {
        guard.cancelAll();
        analysis = null;
        analytics = null;
        enhancement = null;
        typing = false;
        analyzing = false;
        render();
        return;
      }

      if (!engine || typeof engine.analyzePrompt !== 'function') { render(); return; }

      const token = guard.issue();
      analyzing = true;
      typing = false;
      engineError = null;
      render();

      let result;
      try {
        result = engine.analyzePrompt(subject, {
          level: settings.level,
          platform,
          memory: d.memory || engine.emptyMemory(),
          targetModel: targetModel(),
        });
      } catch (err) {
        if (!guard.isCurrent(token)) return;
        analyzing = false;
        engineError = (err && err.message) || 'Analysis failed';
        log('assistant: analysis failed —', engineError);
        render();
        return;
      }

      // The prompt changed while we were working: this answer is about text that
      // no longer exists, so it is dropped rather than shown.
      if (!guard.isCurrent(token)) return;

      analysis = result;
      analytics = result.analytics;
      optimizedText = result.optimized;
      enhancement = null;
      analyzing = false;
      render();

      if (settings.mode === 'enhanced') await runEnhanced(subject, token);
    }

    /**
     * Optional enhanced pass.
     *
     * The network call happens in the service worker (the chat page's CSP blocks
     * it here), and its answer is treated as untrusted: every protected span must
     * come back byte-identical and the rewrite must pass the SAME local validator
     * a local suggestion does. Anything less keeps the local result.
     */
    async function runEnhanced(subject, token) {
      if (typeof d.requestEnhanced !== 'function') return;
      if (subject.length > ENHANCED_MAX_CHARS) {
        enhancement = { applied: false, status: 'Prompt too long for enhanced mode — using the local result.' };
        render();
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) { render(); return; }

      let reply = null;
      try {
        reply = await d.requestEnhanced(subject);
      } catch (_) {
        reply = null;
      }
      if (!guard.isCurrent(token) || !analysis) return;

      const remote = reply && typeof reply.text === 'string' ? reply.text.trim() : '';
      if (!remote) {
        enhancement = { applied: false, status: enhancedFailureText(reply && reply.status) };
        render();
        return;
      }

      const intact = analysis.protectedSpans.every((span) => remote.includes(span.text));
      if (!intact) {
        enhancement = { applied: false, status: 'Enhanced rewrite altered protected content — kept the local result.' };
        render();
        return;
      }

      let validation = null;
      try {
        validation = engine.validateMeaning({
          original: analysis.original,
          optimized: remote,
          originalEntities: analysis.entities,
          originalConstraints: analysis.constraints,
          appliedEdits: [],
        });
      } catch (_) { validation = null; }

      if (!validation || !validation.ok) {
        enhancement = { applied: false, status: 'Enhanced rewrite dropped required detail — kept the local result.' };
        render();
        return;
      }

      const originalTokens = engine.estimateTokens(analysis.original);
      const optimizedTokens = engine.estimateTokens(remote);
      const saved = Math.max(0, originalTokens - optimizedTokens);
      optimizedText = remote;
      analytics = {
        ...analysis.analytics,
        originalTokens,
        optimizedTokens,
        tokensSaved: saved,
        percentReduction: originalTokens > 0 ? (saved / originalTokens) * 100 : 0,
        saved: engine.impactForTokens(saved, platform),
      };
      analysis = { ...analysis, validation };
      enhancement = { applied: true, status: 'Enhanced rewrite, validated locally.' };
      render();
    }

    function enhancedFailureText(status) {
      switch (status) {
        case 'unconfigured': return 'Enhanced mode is not configured — using the local result.';
        case 'rate_limited':
        case 'cooldown':
        case 'throttled': return 'Enhanced mode is rate-limited right now — using the local result.';
        case 'error': return 'Enhanced mode could not be reached — using the local result.';
        default: return 'Using the local result.';
      }
    }

    // ── Actions ─────────────────────────────────────────────────────────────

    function composerText() {
      return composerEl ? composerLib.readText(composerEl) : '';
    }

    /**
     * Whether Replace is safe to run *right now*.
     *
     * The optimization — and every character offset the engine used to build it
     * — describes `analysis.original`. If the composer no longer holds exactly
     * that string, applying the result would overwrite whatever the user has
     * since written with an optimization of text that no longer exists. So the
     * check is identity against the analyzed text, not "is there a result".
     *
     * It also makes duplicate replacement structurally impossible: once the
     * optimized text is in the box, the box no longer equals `analysis.original`
     * and a second click is refused.
     */
    function canReplaceNow() {
      if (replacing || !analysis || !composerEl || !optimizedText) return false;
      if (optimizedText === analysis.original) return false;
      return composerText() === analysis.original;
    }

    function replacePrompt() {
      if (!canReplaceNow()) {
        // The prompt changed under the open panel. Re-analyze rather than
        // applying a stale result — and say so, so the click isn't a no-op.
        if (analysis && composerEl && composerText() !== analysis.original) {
          driftedAt = Date.now();
          render();
          analyze();
        }
        return false;
      }

      replacing = true;
      const before = analysis.original;       // verified to be what is on screen
      const intended = optimizedText;

      // The write dispatches input events synchronously; the flag covers exactly
      // that window so our own edit is never mistaken for the user typing.
      writingProgrammatically = true;
      let ok = false;
      try {
        ok = composerLib.writeText(composerEl, intended);
      } finally {
        writingProgrammatically = false;
        replacing = false;
      }

      if (!ok) {
        engineError = 'Could not update the message box. Copy the optimized prompt instead.';
        render();
        return false;
      }

      // The host editor may apply the change in its own microtask, and may
      // normalize whitespace while doing it. `pendingWrite` lets the resulting
      // input event be recognized as our own echo rather than as the user
      // typing — which would otherwise retire undo and trigger a pointless
      // re-analysis the moment a replacement succeeded.
      pendingWrite = { intended };
      text = intended;
      undoRecord = { el: composerEl, before, after: intended };
      driftedAt = 0;
      successUntil = Date.now() + SUCCESS_MS;
      debouncer.cancel();
      guard.cancelAll();

      if (typeof d.onReplaced === 'function' && analytics) {
        try {
          d.onReplaced({
            savedTokens: analytics.tokensSaved || 0,
            savedEnergyWh: (analytics.saved && analytics.saved.energyWh) || 0,
            savedWaterMl: (analytics.saved && analytics.saved.waterMl) || 0,
            savedCo2G: (analytics.saved && analytics.saved.co2G) || 0,
          });
        } catch (_) { /* recording savings must never break the replacement */ }
      }

      // Collapse on success: the user's attention belongs on their message box
      // now, not on a comparison of a prompt they have already accepted. Undo
      // stays one click away in the toast, and in the panel if they reopen it.
      setExpanded(false);
      flashSuccess();
      showToast('Prompt replaced');
      render();

      clearTimeout(successTimer);
      successTimer = setTimeout(() => { successUntil = 0; render(); }, SUCCESS_MS);
      return true;
    }

    function undo() {
      if (!undoRecord || replacing) return false;
      const target = undoRecord.el && undoRecord.el.isConnected ? undoRecord.el : composerEl;
      if (!target) return false;
      const original = undoRecord.before;

      replacing = true;
      writingProgrammatically = true;
      let ok = false;
      try {
        ok = composerLib.writeText(target, original);
      } finally {
        writingProgrammatically = false;
        replacing = false;
      }
      if (!ok) return false;

      pendingWrite = { intended: original };
      text = original;
      clearUndo();
      hideToast();
      announce('Original prompt restored');
      analyze();
      return true;
    }

    function clearUndo() {
      undoRecord = null;
      successUntil = 0;
      clearTimeout(successTimer);
    }

    async function copyOptimized() {
      if (!optimizedText) return;
      let ok = false;
      try {
        await navigator.clipboard.writeText(optimizedText);
        ok = true;
      } catch (_) {
        ok = false;
      }
      el['act-copy'].textContent = ok ? 'Copied' : 'Copy failed';
      announce(ok ? 'Optimized prompt copied' : 'Could not copy');
      setTimeout(() => { if (el['act-copy']) el['act-copy'].textContent = 'Copy optimized'; }, 1600);
    }

    /** Retry at the next compression level, wrapping round at Maximum. */
    function tryAgain() {
      if (engineError) { engineError = null; analyze(); return; }
      const i = S.LEVELS.indexOf(settings.level);
      setLevel(S.LEVELS[(i + 1) % S.LEVELS.length]);
    }

    function keepOriginal() {
      dismissedFor = text;
      setExpanded(false);
      render();
    }

    // ── Rendering ───────────────────────────────────────────────────────────

    function computeState() {
      return S.nextState({
        engineReady: !!(engine && typeof engine.analyzePrompt === 'function'),
        composerFound: !!composerEl,
        text,
        typing,
        analyzing,
        error: engineError,
        online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
        mode: settings.mode,
        analytics,
        validation: analysis && analysis.validation,
        // The engine's own assessment of whether this prompt is genuinely as
        // short as it can usefully be. Without it, "Already concise" is not said.
        concision: analysis && analysis.concision,
        replaced: Date.now() < successUntil,
        canUndo: !!undoRecord,
      });
    }

    function render() {
      if (!host) return;
      const next = computeState();
      uiState = next;

      // The pill lives inside the host and is hidden with it, so it is kept in
      // step even while nothing is on screen. Doing it here rather than after
      // the visibility check means the model is already correct the moment the
      // assistant appears, instead of showing the previous one for a frame.
      renderModel();

      if (!settings.enabled || !S.isIndicatorVisible(next) ||
          (dismissedFor !== null && dismissedFor === text && next !== 'undo' && next !== 'replaced')) {
        hide();
        return;
      }

      show();
      el.shell.classList.toggle('is-analyzing', next === 'analyzing');
      renderBar(next);
      if (expanded) renderPanel(next);
      anchor();
    }

    function renderBar(state) {
      const saved = analytics ? analytics.tokensSaved || 0 : 0;
      const pct = analytics ? Math.round(analytics.percentReduction || 0) : 0;
      const tokens = analytics ? analytics.originalTokens || 0
        : (engine && engine.estimateTokens ? engine.estimateTokens(text) : 0);

      el.headline.classList.toggle('is-pending', state === 'analyzing');
      el.pct.hidden = true;
      el.sub.hidden = true;
      el['quick-optimize'].hidden = true;

      switch (state) {
        case 'analyzing':
          el.headline.textContent = 'Analyzing…';
          break;
        case 'typing':
          el.headline.innerHTML = `<span class="num">${tokens}</span> tokens`;
          break;
        case 'available': {
          el.headline.innerHTML = `Save <span class="num" id="saved-num">${saved}</span> tokens`;
          el.pct.hidden = false;
          el.pct.textContent = `−${pct}%`;
          el.sub.hidden = false;
          el.sub.innerHTML = ecoLine(tokens);
          el['quick-optimize'].hidden = expanded;
          animateSaved(saved);
          break;
        }
        case 'concise':
          el.headline.textContent = 'Already concise';
          el.sub.hidden = false;
          el.sub.innerHTML = `<span class="num">${tokens}</span> tokens`;
          break;
        // Something IS compressible here, just not enough to interrupt for. The
        // separate wording matters: calling this "Already concise" is what made
        // the assistant look like it was not reading the prompt.
        case 'marginal':
          el.headline.textContent = saved > 0 ? 'Little left to cut' : 'Nothing worth cutting';
          el.sub.hidden = false;
          el.sub.innerHTML = saved > 0
            ? `<span class="num">${tokens}</span> tokens · ${saved} removable`
            : `<span class="num">${tokens}</span> tokens`;
          el['quick-optimize'].hidden = expanded || saved <= 0;
          break;
        case 'replaced':
          el.headline.textContent = 'Prompt replaced';
          break;
        case 'undo':
          el.headline.textContent = 'Optimized prompt in place';
          break;
        case 'failed':
          el.headline.textContent = 'Could not analyze';
          break;
        case 'offline':
          el.headline.textContent = 'Offline — local mode';
          break;
        default:
          el.headline.innerHTML = `<span class="num">${tokens}</span> tokens`;
      }
      el.bar.setAttribute('aria-label', `PromptFootprint: ${el.headline.textContent}`);
    }

    function ecoLine(tokens) {
      const parts = [`<span class="num">${tokens}</span> tok`];
      const projection = currentProjection();
      if (settings.showImpact && projection) {
        // A percentage of the WHOLE interaction, not a percentage of the input.
        // On a short prompt those differ by roughly an order of magnitude.
        const pct = projection.formatted;
        parts.push(`<span class="dot">·</span><span class="eco">${ICONS.drop}~${esc(pct)} of interaction</span>`);
      }
      return parts.join(' ');
    }

    /**
     * The conservative projection for the current analysis, or null.
     *
     * Returns null rather than falling back to the engine's token-linear figure:
     * no number at all is better than one that overstates the saving.
     */
    function currentProjection() {
      if (!projectSavings || !analytics || !(analytics.tokensSaved > 0)) return null;
      try {
        return projectSavings(analytics.originalTokens, analytics.optimizedTokens);
      } catch (_) {
        return null;
      }
    }

    /**
     * Count the headline figure up to its new value.
     *
     * Only when it actually changed, only in the collapsed bar, and never when
     * motion is reduced — the point is to draw the eye to a changed number, not
     * to animate for its own sake.
     */
    function animateSaved(target) {
      const node = shadow.getElementById('saved-num');
      if (!node) return;
      const reduce = !settings.animations ||
        (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      const from = lastRenderedSaved;
      lastRenderedSaved = target;
      if (reduce || from === target || Math.abs(target - from) < 2) {
        node.textContent = String(target);
        return;
      }
      cancelAnimationFrame(countRaf);
      const start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / 320);
        const eased = 1 - Math.pow(1 - t, 3);
        node.textContent = String(Math.round(from + (target - from) * eased));
        if (t < 1) countRaf = requestAnimationFrame(step);
      };
      countRaf = requestAnimationFrame(step);
    }

    function renderPanel(state) {
      const hasResult = !!(analysis && analytics);
      el.compare.hidden = !hasResult;
      el.preserved.hidden = !hasResult;
      el.explain.hidden = !hasResult;
      el.metrics.hidden = !hasResult;

      renderNote(state);

      if (hasResult) {
        renderSavings();
        el.metrics.innerHTML = metricsHtml();
        el['pane-original'].textContent = analysis.original;
        el['pane-optimized'].textContent = optimizedText;
        el['count-original'].textContent = `${analytics.originalTokens} tokens`;
        el['count-optimized'].textContent = `${analytics.optimizedTokens} tokens`;
        el.explain.innerHTML = explanationHtml();
        renderLedger();
        renderPreserved();
      } else {
        el.savings.hidden = true;
        el.ledger.hidden = true;
      }
      renderDebug();

      // Disabled the moment the prompt drifts from the analyzed text, so the
      // stale-replacement case is prevented rather than merely caught.
      el['act-replace'].disabled = !canReplaceNow();
      el['act-copy'].disabled = !hasResult;
      el['act-undo'].hidden = !undoRecord;
      el['act-keep'].hidden = !!undoRecord;
      syncSettingsUi();
      measure();
    }

    /**
     * The headline reduction, in the plainest possible terms.
     *
     *     412 → 246 tokens
     *     166 input tokens removed · 40% shorter
     *
     * Deliberately says "input tokens", not "tokens": the number is a fact about
     * the prompt, and nothing here is allowed to imply that a 40% shorter prompt
     * is a 40% smaller interaction. That claim, with its uncertainty, lives in
     * the metrics grid below.
     */
    function renderSavings() {
      const saved = analytics.tokensSaved || 0;
      if (saved <= 0) { el.savings.hidden = true; return; }
      el.savings.hidden = false;
      el['savings-headline'].innerHTML =
        `<span class="num was">${analytics.originalTokens}</span>` +
        '<span class="arrow" aria-hidden="true">→</span>' +
        `<span class="num now">${analytics.optimizedTokens}</span> tokens`;
      const model = present && observation ? present.pillLabel(observation) : null;
      el['savings-detail'].innerHTML =
        `<strong>${saved}</strong> input token${saved === 1 ? '' : 's'} removed` +
        `<span class="dot">·</span><strong>${Math.round(analytics.percentReduction)}%</strong> shorter` +
        (model ? `<span class="dot">·</span><span class="for-model">for ${esc(model)}</span>` : '');
    }

    function metricsHtml() {
      const cells = [
        { label: 'Original', value: `${analytics.originalTokens}`, gain: false },
        { label: 'Optimized', value: `${analytics.optimizedTokens}`, gain: false },
        { label: 'Input tokens avoided', value: `${analytics.tokensSaved}`, gain: analytics.tokensSaved > 0 },
        { label: 'Input tokens reduced', value: `${Math.round(analytics.percentReduction)}%`, gain: analytics.tokensSaved > 0 },
      ];
      // THREE separate claims, deliberately labelled differently, because they
      // are three different magnitudes and conflating them is the mistake the
      // environmental methodology exists to prevent:
      //
      //   input tokens reduced          a fact about the prompt (token counting)
      //   input-processing reduction    that fact's share of the interaction's
      //                                 energy — prefill is a minority of it
      //   total interaction impact      the same, net of the fact that output
      //                                 length, hidden reasoning, tools, and
      //                                 retries do not shrink with the prompt
      //
      // "36% fewer tokens = 36% less energy" is not a claim this panel can make,
      // so the second and third rows are ranges and are labelled as estimates.
      const projection = settings.showImpact ? currentProjection() : null;
      if (projection) {
        if (projection.inputProcessing) {
          cells.push({ label: 'Est. input-processing reduction', value: projection.inputProcessing, gain: true });
        }
        cells.push({ label: 'Projected total interaction', value: projection.formatted, gain: true });
        if (projection.energy && format) {
          cells.push({ label: 'Projected energy avoided', value: format.energy(Math.max(0, projection.energy.central)).compact, gain: true });
        }
      }
      // Column count that divides evenly, so the grid never ends on a blank cell.
      const cols = cells.length % 3 === 0 ? 3 : Math.min(cells.length, 4);
      el.metrics.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
      return cells.map((c) => (
        `<div class="metric${c.gain ? ' is-gain' : ''}">` +
        `<span class="metric-value">${esc(c.value)}</span>` +
        `<span class="metric-label">${esc(c.label)}</span></div>`
      )).join('');
    }

    /**
     * What changed, in the user's terms. Built from the suggestions the engine
     * actually applied, so it can never describe an edit that did not happen.
     */
    function explanationHtml() {
      const accepted = new Set(analysis.defaultAccepted);
      const applied = analysis.suggestions.filter((s) => !s.advisory && accepted.has(s.id));
      if (enhancement && enhancement.applied) {
        return `<div>Rewritten by the enhanced pass and re-checked against your original.</div>`;
      }
      if (!applied.length) return '<div>No changes proposed at this compression level.</div>';

      const byTitle = new Map();
      for (const s of applied) byTitle.set(s.title, (byTitle.get(s.title) || 0) + 1);
      const chips = Array.from(byTitle.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([title, n]) => `<span class="chip">${esc(title)}${n > 1 ? ` ×${n}` : ''}</span>`)
        .join('');
      const extra = (analysis.refinements || [])
        .filter((p) => !p.rejected)
        .reduce((n, p) => n + p.edits.length, 0);
      const n = applied.length + extra;
      const rounds = (analysis.refinements || []).filter((p) => !p.rejected).length;
      return `<div>${n} change${n === 1 ? '' : 's'} applied — wording only, never your instructions.` +
             (rounds ? ` Found over ${rounds + 1} compression passes.` : '') + '</div>' +
             `<div class="chips">${chips}</div>`;
    }

    /**
     * The two lists that make aggressive compression trustworthy: what went, and
     * what was checked as still present.
     *
     * Built from the engine's own summary, which is derived from the applied
     * edits and the validator's tallies — so neither column can describe work
     * that did not happen. The Preserved column is empty unless the validator
     * ran and passed, rather than falling back to a reassuring default.
     */
    function renderLedger() {
      const summary = analysis.changeSummary;
      if (!summary || (!summary.removed.length && !summary.preserved.length)) {
        el.ledger.hidden = true;
        return;
      }
      el.ledger.hidden = false;
      const items = (list, empty) => (list.length
        ? list.slice(0, 6).map((i) => `<li>${esc(i.count > 1 ? `${i.count} ${i.label}` : i.label)}</li>`).join('')
        : `<li class="ledger-empty">${empty}</li>`);
      el['ledger-removed'].innerHTML = items(summary.removed, 'nothing');
      el['ledger-preserved'].innerHTML = items(
        summary.preserved,
        summary.verified ? 'nothing to check' : 'not verified',
      );
    }

    /**
     * The developer view. Off by default, and never shown to someone who has not
     * asked for it — but when a detection bug is reported, this is the panel
     * that makes it diagnosable from a screenshot.
     */
    function renderDebug() {
      if (!el.debug) return;
      const on = !!settings.debugPanel && !!present && typeof present.debugRows === 'function';
      el.debug.hidden = !on;
      if (!on) return;
      const rows = present.debugRows(observation, {
        observedRoots: typeof d.observedRoots === 'function' ? d.observedRoots() : null,
      });
      const stamp = modelChangedAt
        ? new Date(modelChangedAt).toTimeString().slice(0, 8)
        : 'no change this session';
      el['debug-rows'].innerHTML = rows.map((r) => (
        `<div class="debug-row"><span class="debug-k">${esc(r.label)}</span>` +
        `<span class="debug-v">${esc(r.value)}</span></div>`
      )).join('') +
        `<div class="debug-row"><span class="debug-k">Change seen at</span><span class="debug-v">${esc(stamp)}</span></div>`;
    }

    /**
     * The preservation claim.
     *
     * It is stated only when the engine's validator actually ran and passed —
     * `validated: true` plus `ok` — so the UI never asserts "meaning preserved"
     * on the strength of nothing having been checked.
     */
    function renderPreserved() {
      const v = analysis.validation;
      const target = el['preserved-text'];
      if (!v || v.validated !== true) {
        el.preserved.classList.add('is-warning');
        target.textContent = 'This result has not been checked. Review it before replacing your prompt.';
        return;
      }
      if (!v.ok) {
        el.preserved.classList.add('is-warning');
        const first = (v.issues || [])[0];
        target.innerHTML = `<strong>Review needed.</strong> ${esc(first ? first.message : 'Something from your prompt may be missing.')}`;
        return;
      }
      el.preserved.classList.remove('is-warning');
      target.innerHTML = '<strong>Meaning preserved.</strong> ' +
        `Checked ${v.totalEntities} detail${v.totalEntities === 1 ? '' : 's'} and ` +
        `${v.totalConstraints} requirement${v.totalConstraints === 1 ? '' : 's'} — ` +
        'names, numbers, dates, links, code, quotes, formatting, tone, and every ' +
        '“do not” instruction were re-checked in the shortened version.';
    }

    function renderNote(state) {
      const note = el.note;
      const set = (html, warn) => {
        note.hidden = false;
        note.className = `note${warn ? ' is-warning' : ''}`;
        note.innerHTML = `${ICONS.info}<span>${html}</span>`;
      };
      note.hidden = true;

      if (state === 'failed') {
        set(`${esc(engineError || 'Analysis failed.')} You can keep writing — nothing was changed.`, true);
      } else if (driftedAt && Date.now() - driftedAt < 6000) {
        set('Your prompt changed since this was analyzed, so it was not replaced. Re-checking it now.', true);
      } else if (state === 'offline') {
        set('You are offline, so enhanced mode is unavailable. Local optimization still works.', false);
      } else if (state === 'concise') {
        set('This prompt is already efficient — no repetition, no filler, and nothing left to merge.', false);
      } else if (state === 'marginal') {
        // Say WHY, using the engine's own list of what it still sees. A bare
        // "nothing worth cutting" is the message that made this feature feel
        // like it was not looking.
        const reasons = (analysis && analysis.concision && analysis.concision.reasons) || [];
        set(reasons.length
          ? `Still compressible — ${esc(reasons.slice(0, 3).join(', '))} — but not enough to be worth a replacement at this level. Try Maximum.`
          : 'Only a token or two to gain here.', false);
      } else if (enhancement && !enhancement.applied) {
        set(esc(enhancement.status), false);
      } else if (!settings.autoAnalyze) {
        set('Automatic analysis is off — results update when you change the compression level.', false);
      }
    }

    function announce(message) {
      if (el.live) el.live.textContent = message;
    }

    // ── Expand / collapse ───────────────────────────────────────────────────

    function toggleExpanded() { setExpanded(!expanded); }

    function setExpanded(next) {
      if (expanded === next) return;
      expanded = next;
      el.bar.setAttribute('aria-expanded', String(next));
      el.shell.classList.toggle('is-expanded', next);
      if (next) {
        el.panel.hidden = false;
        renderPanel(uiState);
        // Always open at the top. A panel that reopens where it was last
        // scrolled hides the very comparison it exists to show.
        el.panel.scrollTop = 0;
      }
      animateHeight(() => { el.panel.hidden = !next; if (!next) el.settings.hidden = true; });
      renderBar(uiState);
    }

    /**
     * Animate the shell between its current and its next height.
     *
     * Height is animated explicitly (rather than max-height) so the transition
     * lands exactly on the content size — a max-height guess either clips the
     * panel or leaves it easing through empty space, and both read as jank.
     */
    function animateHeight(mutate) {
      const shell = el.shell;
      const from = shell.getBoundingClientRect().height;
      shell.classList.add('is-measuring');
      shell.style.height = 'auto';
      mutate();
      const to = shell.getBoundingClientRect().height;
      shell.style.height = `${from}px`;
      void shell.offsetHeight;                 // commit the start value
      shell.classList.remove('is-measuring');
      requestAnimationFrame(() => { shell.style.height = `${to}px`; });

      const done = (e) => {
        if (e && e.propertyName !== 'height') return;
        shell.style.height = '';
        shell.removeEventListener('transitionend', done);
      };
      shell.addEventListener('transitionend', done);
      // Fallback for the reduced-motion case, where no transition fires.
      setTimeout(() => done(), 400);
    }

    /** Re-measure after content inside an already-open panel changed size. */
    function measure() {
      if (!expanded) return;
      el.shell.style.height = '';
    }

    // ── Visibility and anchoring ────────────────────────────────────────────

    function show() {
      if (!host || !host.hidden) return;
      host.hidden = false;
      anchor();
      requestAnimationFrame(() => el.shell.classList.add('is-in'));
    }

    function hide() {
      if (!host || host.hidden) return;
      el.shell.classList.remove('is-in');
      host.hidden = true;
      if (expanded) {
        expanded = false;
        el.panel.hidden = true;
        el.shell.classList.remove('is-expanded');
        el.bar.setAttribute('aria-expanded', 'false');
      }
      hideToast();
    }

    let lastAnchor = '';

    /**
     * Pin the assistant to the composer's top-right corner.
     *
     * Anchoring by `right`/`bottom` rather than `left`/`top` is the trick that
     * makes expansion free: the panel grows up and to the left, away from the
     * composer, so a height or width change never needs a second measurement and
     * never nudges the indicator. It also guarantees we never sit on top of the
     * send button, the attachment row, or the voice controls, all of which live
     * inside the composer we are anchored outside of.
     */
    /**
     * Coalesce anchoring to one call per frame.
     *
     * The document observer fires in bursts while a response streams. Measuring
     * on every burst would mean hundreds of layout reads a second for a box that
     * moves at most once per frame, which is exactly the kind of cost that makes
     * an extension "slow down ChatGPT".
     */
    function scheduleAnchor() {
      if (anchorRaf || !host || host.hidden) return;
      anchorRaf = requestAnimationFrame(() => { anchorRaf = 0; anchor(); });
    }

    function anchor() {
      if (!host || host.hidden || !composerEl || !composerEl.isConnected) return;
      // Anchor to the composer's visible surface, not the editable node inside
      // it, so we sit clear of the attachment row, model picker, dictation
      // button, and send control that share that surface. Cached: resolving it
      // walks (and measures) several ancestors, and it only changes when the
      // composer itself does.
      if (!anchorEl || !anchorEl.isConnected || !anchorEl.contains(composerEl)) {
        anchorEl = composerLib.composerBox(composerEl);
      }
      const rect = anchorEl.getBoundingClientRect();
      if (!rect.width && !rect.height) return;

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const gap = 8;
      const margin = 8;
      const barHeight = 38;

      // Horizontal: right edge aligned with the composer, clamped so the box can
      // never leave the viewport however the page is laid out.
      const right = Math.min(Math.max(margin, vw - rect.right), Math.max(margin, vw - 160));
      const maxWidth = Math.min(500, Math.max(200, vw - right - margin));

      // Vertical: above the composer when there is room, below when there is not.
      const roomAbove = rect.top - gap - margin;
      const below = roomAbove < barHeight + 24;
      // Never taller than roughly half the window: this is an assistant beside
      // the composer, not a takeover of the conversation.
      const ceiling = Math.round(vh * 0.52);
      const fit = (space) => Math.max(140, Math.min(ceiling, space));
      let css;
      if (below) {
        const top = Math.min(rect.bottom + gap, vh - barHeight - margin);
        css = { right, top, bottom: null, panelMax: fit(vh - top - barHeight - margin - 8), maxWidth };
      } else {
        const bottom = Math.max(margin, vh - rect.top + gap);
        css = { right, top: null, bottom, panelMax: fit(vh - bottom - barHeight - margin - 8), maxWidth };
      }

      const key = JSON.stringify(css);
      if (key === lastAnchor) return;      // nothing moved — do not touch style
      lastAnchor = key;

      host.style.right = `${css.right}px`;
      host.style.maxWidth = `${css.maxWidth}px`;
      if (css.top !== null) {
        host.style.top = `${css.top}px`;
        host.style.bottom = 'auto';
      } else {
        host.style.bottom = `${css.bottom}px`;
        host.style.top = 'auto';
      }
      host.style.left = 'auto';
      el.panel.style.setProperty('--panel-max', `${css.panelMax}px`);

      // The toast normally sits above the indicator; if the indicator is already
      // near the top of the window it goes below instead, so a transient
      // notification can never end up off-screen.
      const roomForToast = css.top !== null
        ? css.top - margin
        : vh - css.bottom - barHeight - margin;
      el.toast.classList.toggle('is-below', roomForToast < 48);
    }

    // ── Toast ───────────────────────────────────────────────────────────────

    function showToast(message) {
      if (!el.toast) return;
      el['toast-text'].textContent = message;
      el.toast.hidden = false;
      anchor();                                   // pick above/below before it shows
      requestAnimationFrame(() => el.toast.classList.add('is-in'));
      announce(`${message}. Undo is available.`);
      clearTimeout(toastTimer);
      toastTimer = setTimeout(hideToast, TOAST_MS);
    }

    function hideToast() {
      if (!el.toast || el.toast.hidden) return;
      clearTimeout(toastTimer);
      el.toast.classList.remove('is-in');
      // Reuse the one timer slot rather than registering a new cleanup per call:
      // a long session would otherwise grow the teardown list without bound.
      toastTimer = setTimeout(() => { if (el.toast) el.toast.hidden = true; }, 200);
    }

    function flashSuccess() {
      if (!settings.animations) return;
      el.shell.classList.remove('is-success');
      void el.shell.offsetWidth;
      el.shell.classList.add('is-success');
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => el.shell && el.shell.classList.remove('is-success'), 700);
    }

    // ── Observers ───────────────────────────────────────────────────────────

    let composerResize = null;

    function observeComposerSize() {
      if (typeof ResizeObserver === 'undefined') return;
      if (composerResize) composerResize.disconnect();
      composerResize = new ResizeObserver(() => anchor());
      try {
        composerResize.observe(composerEl);
        // The composer's own container grows when a file is attached, and the
        // whole layout shifts when the sidebar opens — both show up here.
        if (composerEl.parentElement) composerResize.observe(composerEl.parentElement);
        if (document.body) composerResize.observe(document.body);
      } catch (_) { /* observation is an optimization, not a requirement */ }
      cleanups.push(() => composerResize && composerResize.disconnect());
    }

    function startObservers() {
      // One document observer, coalesced. React re-renders produce mutation
      // storms, so the handler must do nothing but arm a throttled timer.
      const mo = new MutationObserver(() => {
        if (!composerEl || !composerEl.isConnected || !host || !host.isConnected) scheduleDetect();
        else scheduleAnchor();
      });
      mo.observe(document.body, { childList: true, subtree: true });
      cleanups.push(() => mo.disconnect());

      // Theme changes are attribute flips on <html>/<body>.
      const themeMo = new MutationObserver(applyTheme);
      themeMo.observe(document.documentElement, {
        attributes: true, attributeFilter: ['class', 'data-theme', 'data-mode', 'style'],
      });
      cleanups.push(() => themeMo.disconnect());

      on(document, 'input', handleInput, true);
      // Paste: read after the host editor has inserted the content. Most editors
      // also emit `input`, in which case this is a cheap no-op (text unchanged).
      on(document, 'paste', () => {
        clearTimeout(pasteTimer);
        pasteTimer = setTimeout(() => handleInput({ target: composerEl }), 50);
      }, true);
      on(window, 'resize', scheduleAnchor, { passive: true });
      on(window, 'scroll', scheduleAnchor, { passive: true, capture: true });
      on(window, 'online', render);
      on(window, 'offline', render);

      // SPA navigation: ChatGPT swaps conversations without a page load.
      let lastUrl = location.href;
      const urlTick = setInterval(() => {
        if (location.href === lastUrl) return;
        lastUrl = location.href;
        onNavigate();
      }, 400);
      cleanups.push(() => clearInterval(urlTick));

      // A cheap safety net: one rect read per tick, and `anchor()` exits without
      // touching the DOM when nothing has moved.
      anchorTimer = setInterval(() => {
        if (host && !host.hidden) anchor();
      }, ANCHOR_TICK_MS);
      cleanups.push(() => clearInterval(anchorTimer));
    }

    /** Reset per-conversation state without tearing the UI down. */
    function onNavigate() {
      guard.cancelAll();
      debouncer.cancel();
      analysis = null;
      analytics = null;
      optimizedText = '';
      enhancement = null;
      engineError = null;
      dismissedFor = null;
      clearUndo();
      hideToast();
      setExpanded(false);
      text = '';
      composerEl = null;
      scheduleDetect();
      render();
    }

    // ── Lifecycle ───────────────────────────────────────────────────────────

    async function start() {
      if (started || destroyed) return false;
      started = true;
      if (!mount()) { started = false; return false; }
      await refreshSettings();
      startObservers();
      // Adopt the model the detector already has, then subscribe. Doing it in
      // this order means the first render shows the real model rather than an
      // empty pill that fills in a moment later.
      if (typeof d.getModel === 'function') {
        try { observation = d.getModel(); } catch (_) { observation = null; }
      }
      if (typeof d.subscribeModel === 'function') {
        try {
          const stop = d.subscribeModel((next) => setModel(next));
          if (typeof stop === 'function') cleanups.push(stop);
        } catch (_) { /* detection is an enhancement, never a requirement */ }
      }
      detect();
      render();
      log('assistant: started —', engine ? 'engine ready' : 'ENGINE MISSING',
          '| model:', observation ? (observation.canonicalModel || observation.selectedLabel) : 'not detected');
      return true;
    }

    function destroy() {
      destroyed = true;
      started = false;
      debouncer.cancel();
      guard.cancelAll();
      clearTimeout(detectTimer);
      clearTimeout(successTimer);
      clearTimeout(toastTimer);
      clearTimeout(flashTimer);
      clearTimeout(pasteTimer);
      cancelAnimationFrame(countRaf);
      cancelAnimationFrame(anchorRaf);
      while (cleanups.length) {
        const fn = cleanups.pop();
        try { fn(); } catch (_) { /* teardown must not throw */ }
      }
      if (host && host.parentNode) host.parentNode.removeChild(host);
      host = null;
      shadow = null;
      el = {};
      composerEl = null;
    }

    /** Re-mount if the page removed our host (some SPAs prune unknown nodes). */
    function ensureAlive() {
      if (destroyed || !started) return;
      if (host && host.isConnected) return;
      host = null;
      if (mount()) { syncSettingsUi(); render(); }
    }

    return {
      start,
      destroy,
      ensureAlive,
      applySettings,
      refreshSettings,
      detect,
      analyze,
      replacePrompt,
      undo,
      setExpanded,
      setLevel,
      setModel,
      // Inspection surface for tests and debugging — never used by the UI.
      get state() { return uiState; },
      get model() { return observation; },
      get modelPill() { return modelPillText; },
      get expanded() { return expanded; },
      get settings() { return settings; },
      get composer() { return composerEl; },
      get result() { return analysis; },
      get analytics() { return analytics; },
      get optimized() { return optimizedText; },
      get canUndo() { return !!undoRecord; },
      get host() { return host; },
      get shadow() { return shadow; },
    };
  }

  const PFAssistant = { createAssistant, HOST_ID, CSS_PATH };

  if (root) root.PFAssistant = PFAssistant;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFAssistant;
})(typeof self !== 'undefined' ? self : this);
