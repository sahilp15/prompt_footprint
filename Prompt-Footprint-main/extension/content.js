// PromptFootprint Content Script
// Injected into supported AI chat pages (ChatGPT, Claude, ...) to observe
// conversations and estimate environmental impact. Platform-specific DOM
// details live in lib/platforms.js; persistence lives in lib/storage.js.

(function() {
  'use strict';

  const adapter = PFPlatforms.getActiveAdapter();
  if (!adapter) {
    // Not a supported platform — content script should not have been injected,
    // but bail defensively rather than throw.
    return;
  }

  let currentSessionId = null;
  let userId = null;
  let config = { overlayEnabled: true, energyPerTokenMultiplier: 1.0 };
  let processedMessageIds = new Set();
  let pendingUserMessage = null;
  let sessionStats = { totalTokens: 0, totalEnergyWh: 0, totalWaterMl: 0, totalCo2G: 0, queryCount: 0 };
  let lastQueryImpact = null;

  // Response capture is POLLING-based, not mutation-based. ChatGPT and Claude
  // stream responses by replacing DOM nodes (childList) rather than mutating
  // text nodes (characterData), so a characterData debounce misses most of the
  // stream. Instead we poll the latest assistant element's text and only
  // finalize once it has stopped growing for SETTLE_DELAY_MS.
  const RESPONSE_POLL_MS = 500;       // how often to sample the assistant text
  const SETTLE_DELAY_MS = 2500;       // text must be stable this long to finalize
  const MAX_NO_RESPONSE_MS = 30000;   // give up if no assistant text ever appears
  const HARD_CAP_MS = 240000;         // force-finalize a never-settling response
  let responseWatchTimer = null;
  let responseWatch = null;           // { lastText, lastChange, startedAt }

  // Initialize
  async function init() {
    // Inject overlay UI immediately — before any async/storage calls
    // so the capsule is visible on first page load without delay.
    injectFloatingOverlay();
    injectModalOverlay();

    userId = await PFStorage.getUserId();

    const savedConfig = await PFStorage.getConfig();
    if (savedConfig) {
      config = { ...config, ...savedConfig };
      const overlay = document.getElementById('pf-floating-overlay');
      if (overlay && !config.overlayEnabled) overlay.style.display = 'none';
    }

    // Create a session for this tab/platform.
    const session = await PFStorage.createSession(userId, adapter.id);
    if (session && session.id) {
      currentSessionId = session.id;
      // Register the session id with the background worker so it can be
      // closed when the tab is removed (keyed by tab id).
      sendMessage({ type: 'REGISTER_SESSION', payload: { sessionId: currentSessionId } });
    }

    startObserver();
    setupPromptOptimizer();
    startWatchdog();
    console.log(`[PromptFootprint] Initialized on ${adapter.name}. Session:`, currentSessionId);
  }

  // ── Robustness watchdog ────────────────────────────────────────────────--
  // SPA frameworks can re-render and remove our injected UI, or navigate to a
  // new conversation. Periodically make sure our overlays exist and reset
  // capture state when the URL changes.
  let lastUrl = location.href;
  function startWatchdog() {
    const wd = setInterval(() => {
      // If the extension was reloaded/updated, stop quietly.
      if (!extAlive()) { clearInterval(wd); stopResponseWatch(); return; }
      // Re-inject any overlay the page removed.
      injectFloatingOverlay();
      injectModalOverlay();
      injectOptimizerChip();
      const overlay = document.getElementById('pf-floating-overlay');
      if (overlay) overlay.style.display = config.overlayEnabled ? 'block' : 'none';

      // Detect SPA navigation (new conversation) and reset capture state.
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        stopResponseWatch();
        pendingUserMessage = null;
        hideOptimizerChip();
        updateFloatingStatus('saved');
      }
    }, 2000);
  }

  // True while this content script's extension context is still valid. After an
  // extension reload/update, old content scripts in open tabs lose their context
  // and any chrome.* call throws "Extension context invalidated". We detect this
  // and shut our timers down quietly instead of spamming the console.
  function extAlive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      if (!extAlive()) { resolve({}); return; }
      try {
        chrome.runtime.sendMessage(msg, (response) => {
          // Swallow chrome.runtime.lastError (e.g. worker asleep) — non-fatal.
          void chrome.runtime.lastError;
          resolve(response || {});
        });
      } catch (_) {
        resolve({});
      }
    });
  }

  // ── DOM Observation ────────────────────────────────────────────────────--
  // We observe document.body (not adapter.rootSelector) so the observer
  // survives SPA navigations that replace the conversation container.
  function startObserver() {
    const observer = new MutationObserver(handleMutations);
    const observeTarget = () => {
      if (!document.body) return false;
      observer.observe(document.body, { childList: true, subtree: true });
      console.log('[PromptFootprint] Observer attached to document.body');
      return true;
    };
    if (!observeTarget()) {
      const retryInterval = setInterval(() => {
        if (observeTarget()) clearInterval(retryInterval);
      }, 500);
    }
    // Also scan whatever is already on the page (script may load mid-conversation).
    scanExistingMessages();
  }

  function scanExistingMessages() {
    document.querySelectorAll(adapter.messageSelector).forEach((el) => {
      const role = adapter.getRole(el);
      const id = adapter.getMessageId(el);
      if (id) processedMessageIds.add(id); // mark pre-existing so we don't re-log
    });
  }

  function handleMutations(mutations) {
    for (const mutation of mutations) {
      if (mutation.type !== 'childList') continue;
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) checkForMessages(node);
      });
    }
  }

  // Collect message elements within (and including) a mutated node.
  function collectMessageElements(node) {
    const els = [];
    if (node.matches?.(adapter.messageSelector)) els.push(node);
    if (node.querySelectorAll) {
      node.querySelectorAll(adapter.messageSelector).forEach((el) => els.push(el));
    }
    return els;
  }

  function checkForMessages(node) {
    const messageElements = collectMessageElements(node);

    messageElements.forEach((el) => {
      const role = adapter.getRole(el);
      if (role !== 'user') return; // assistant capture is handled by polling

      const messageId = adapter.getMessageId(el);
      if (!messageId || processedMessageIds.has(messageId)) return;

      const text = adapter.extractText(el);
      if (!text) return;

      pendingUserMessage = { id: messageId, text, startTime: Date.now() };
      processedMessageIds.add(messageId);
      updateFloatingStatus('recording');
      startResponseWatch();
    });
  }

  // ── Response capture (polling) ─────────────────────────────────────────--
  function startResponseWatch() {
    stopResponseWatch();
    const now = Date.now();
    responseWatch = { lastText: '', lastChange: now, startedAt: now };
    responseWatchTimer = setInterval(pollResponse, RESPONSE_POLL_MS);
  }

  function stopResponseWatch() {
    if (responseWatchTimer) clearInterval(responseWatchTimer);
    responseWatchTimer = null;
    responseWatch = null;
  }

  function pollResponse() {
    if (!pendingUserMessage || !responseWatch) { stopResponseWatch(); return; }

    const latest = adapter.getLatestAssistant();
    const text = latest ? adapter.extractText(latest) : '';
    const now = Date.now();

    // Still growing → reset the stability clock.
    if (text && text.length !== responseWatch.lastText.length) {
      responseWatch.lastText = text;
      responseWatch.lastChange = now;
      return;
    }

    // Stable for long enough → finalize.
    if (text && now - responseWatch.lastChange >= SETTLE_DELAY_MS) {
      finalizeResponse(latest, text, responseWatch.lastChange);
      return;
    }

    // No assistant text appeared at all → give up.
    if (!text && now - responseWatch.startedAt >= MAX_NO_RESPONSE_MS) {
      stopResponseWatch();
      updateFloatingStatus('saved');
      return;
    }

    // Response never settles (very long generation) → force-finalize.
    if (text && now - responseWatch.startedAt >= HARD_CAP_MS) {
      finalizeResponse(latest, text, now);
    }
  }

  function finalizeResponse(latestEl, text, endTime) {
    if (!pendingUserMessage) { stopResponseWatch(); return; }
    const prompt = pendingUserMessage.text;
    const startTime = pendingUserMessage.startTime;
    const msgId = latestEl ? adapter.getMessageId(latestEl) : null;
    stopResponseWatch();
    pendingUserMessage = null;
    if (msgId) processedMessageIds.add(msgId);
    const responseTimeMs = Math.max(0, endTime - startTime);
    processQuery(prompt, text, responseTimeMs);
  }

  async function processQuery(promptText, responseText, responseTimeMs) {
    const multiplier = config.energyPerTokenMultiplier || 1.0;
    const impact = calculateQueryImpact(promptText, responseText, {
      platform: adapter.id,
      responseTimeMs,
      multiplier,
    });

    lastQueryImpact = impact;
    sessionStats.totalTokens += impact.totalTokens;
    sessionStats.totalEnergyWh += impact.energyWh;
    sessionStats.totalWaterMl += impact.waterMl;
    sessionStats.totalCo2G += impact.co2G;
    sessionStats.queryCount += 1;

    if (currentSessionId && extAlive()) {
      try {
        await PFStorage.addQuery(currentSessionId, {
          platform: adapter.id,
          promptTokens: impact.promptTokens,
          responseTokens: impact.responseTokens,
          totalTokens: impact.totalTokens,
          energyWh: impact.energyWh,
          waterMl: impact.waterMl,
          co2G: impact.co2G,
          responseTimeMs,
        });
      } catch (_) {
        // Extension context invalidated mid-write — non-fatal.
      }
    }

    updateFloatingStatus('saved');
    updateModalStats();
    console.log('[PromptFootprint] Query logged:', { ...impact, responseTimeMs });
  }

  // ── Floating Overlay ───────────────────────────────────────────────────--
  function injectFloatingOverlay() {
    if (document.getElementById('pf-floating-overlay')) return;

    const container = document.createElement('div');
    container.id = 'pf-floating-overlay';
    container.innerHTML = `
      <div class="pf-floating-pill">
        <div class="pf-floating-dot"></div>
        <span class="pf-floating-label">PF</span>
        <span class="pf-floating-status">Tracking</span>
      </div>
    `;

    container.addEventListener('click', () => toggleModal());
    document.body.appendChild(container);

    if (!config.overlayEnabled) {
      container.style.display = 'none';
    }
  }

  function updateFloatingStatus(status) {
    const statusEl = document.querySelector('.pf-floating-status');
    const dotEl = document.querySelector('.pf-floating-dot');
    if (!statusEl || !dotEl) return;

    if (status === 'recording') {
      statusEl.textContent = 'Recording...';
      dotEl.classList.add('pf-pulse');
    } else if (status === 'saved') {
      statusEl.textContent = 'Saved';
      dotEl.classList.remove('pf-pulse');
      setTimeout(() => {
        statusEl.textContent = 'Tracking';
      }, 2000);
    }
  }

  // ── Modal Overlay ──────────────────────────────────────────────────────--
  function injectModalOverlay() {
    if (document.getElementById('pf-modal-overlay')) return;

    const modal = document.createElement('div');
    modal.id = 'pf-modal-overlay';
    modal.classList.add('pf-modal-hidden');
    modal.innerHTML = `
      <div class="pf-modal-container">
        <div class="pf-modal-header">
          <span class="pf-modal-title">PromptFootprint</span>
          <button class="pf-modal-close" id="pf-modal-close-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div class="pf-modal-section">
          <div class="pf-modal-section-label">Session Totals</div>
          <div class="pf-modal-stats-grid">
            <div class="pf-modal-stat">
              <svg class="pf-modal-stat-icon pf-icon-energy" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
              <div class="pf-modal-stat-value" id="pf-session-energy">0.000 Wh</div>
              <div class="pf-modal-stat-label">Energy</div>
            </div>
            <div class="pf-modal-stat">
              <svg class="pf-modal-stat-icon pf-icon-water" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"></path></svg>
              <div class="pf-modal-stat-value" id="pf-session-water">0.000 mL</div>
              <div class="pf-modal-stat-label">Water</div>
            </div>
            <div class="pf-modal-stat">
              <svg class="pf-modal-stat-icon pf-icon-co2" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"></path><path d="M9.6 4.6A2 2 0 1 1 11 8H2"></path><path d="M12.6 19.4A2 2 0 1 0 14 16H2"></path></svg>
              <div class="pf-modal-stat-value" id="pf-session-co2">0.000 g</div>
              <div class="pf-modal-stat-label">CO2</div>
            </div>
          </div>
        </div>

        <div class="pf-modal-section">
          <div class="pf-modal-section-label">Last Query</div>
          <div class="pf-modal-stats-grid">
            <div class="pf-modal-stat pf-stat-small">
              <div class="pf-modal-stat-value" id="pf-query-tokens">--</div>
              <div class="pf-modal-stat-label">Tokens</div>
            </div>
            <div class="pf-modal-stat pf-stat-small">
              <div class="pf-modal-stat-value" id="pf-query-energy">--</div>
              <div class="pf-modal-stat-label">Energy</div>
            </div>
            <div class="pf-modal-stat pf-stat-small">
              <div class="pf-modal-stat-value" id="pf-query-water">--</div>
              <div class="pf-modal-stat-label">Water</div>
            </div>
            <div class="pf-modal-stat pf-stat-small">
              <div class="pf-modal-stat-value" id="pf-query-co2">--</div>
              <div class="pf-modal-stat-label">CO2</div>
            </div>
          </div>
        </div>

        <div class="pf-modal-footer">
          <div class="pf-modal-query-count" id="pf-query-count">0 queries this session</div>
          <button class="pf-modal-btn" id="pf-open-stats-btn">View Full Stats</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('pf-modal-close-btn').addEventListener('click', () => toggleModal(false));
    document.getElementById('pf-open-stats-btn').addEventListener('click', () => {
      // Local-first: stats live in the extension's own dashboard page.
      chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
    });
  }

  function toggleModal(forceState) {
    const modal = document.getElementById('pf-modal-overlay');
    if (!modal) return;

    if (forceState !== undefined) {
      modal.classList.toggle('pf-modal-hidden', !forceState);
    } else {
      modal.classList.toggle('pf-modal-hidden');
    }
  }

  // Real-world conversion helpers — same logic as popup.js
  function _fmtWater(ml) {
    if (ml <= 0)   return '0 drops';
    if (ml < 0.05) return '< 1 drop';
    if (ml < 1.5)  return `≈ ${Math.round(ml * 20)} drops`;
    if (ml < 5)    return `≈ ${(ml / 5).toFixed(1)} tsp`;
    if (ml < 250)  return `≈ ${Math.round(ml / 250 * 100)}% of a glass`;
    return           `≈ ${(ml / 250).toFixed(1)} glasses`;
  }
  function _fmtEnergy(wh) {
    if (wh <= 0)   return '< 1 sec phone';
    const s = wh * 1200;
    if (s < 2)     return '< 2 sec phone';
    if (s < 60)    return `≈ ${Math.round(s)}s phone`;
    if (s < 3600)  return `≈ ${Math.round(s / 60)} min phone`;
    return           `≈ ${(s / 3600).toFixed(1)} hr phone`;
  }
  function _fmtCo2(g) {
    if (g <= 0)    return '< 1 cm by car';
    const m = g * 5;
    if (m < 1)     return `≈ ${Math.round(m * 100)} cm by car`;
    if (m < 1000)  return `≈ ${m.toFixed(1)} m by car`;
    return           `≈ ${(m / 1000).toFixed(2)} km by car`;
  }

  function updateModalStats() {
    const fmtRaw = (v, unit) => `${v.toFixed(3)} ${unit}`;

    // Session totals — human-readable conversions
    const energyEl = document.getElementById('pf-session-energy');
    const waterEl  = document.getElementById('pf-session-water');
    const co2El    = document.getElementById('pf-session-co2');
    if (energyEl) energyEl.textContent = _fmtEnergy(sessionStats.totalEnergyWh);
    if (waterEl)  waterEl.textContent  = _fmtWater(sessionStats.totalWaterMl);
    if (co2El)    co2El.textContent    = _fmtCo2(sessionStats.totalCo2G);

    // Last query — raw values (individual queries are tiny, context matters)
    if (lastQueryImpact) {
      const tokensEl  = document.getElementById('pf-query-tokens');
      const qEnergyEl = document.getElementById('pf-query-energy');
      const qWaterEl  = document.getElementById('pf-query-water');
      const qCo2El    = document.getElementById('pf-query-co2');
      if (tokensEl)  tokensEl.textContent  = lastQueryImpact.totalTokens;
      if (qEnergyEl) qEnergyEl.textContent = fmtRaw(lastQueryImpact.energyWh, 'Wh');
      if (qWaterEl)  qWaterEl.textContent  = fmtRaw(lastQueryImpact.waterMl,  'mL');
      if (qCo2El)    qCo2El.textContent    = fmtRaw(lastQueryImpact.co2G,     'g');
    }

    // Query count
    const countEl = document.getElementById('pf-query-count');
    if (countEl) countEl.textContent = `${sessionStats.queryCount} ${sessionStats.queryCount === 1 ? 'query' : 'queries'} this session`;
  }

  // ── Prompt optimizer ───────────────────────────────────────────────────--
  // Grammarly-style: as the user types a long prompt we show a shorter version
  // and the estimated savings BEFORE they send. Two tiers:
  //   1. LOCAL heuristic — instant, offline, always available.
  //   2. AI (Gemini via the proxy Worker) — a stronger rewrite that arrives a
  //      moment later and replaces the local suggestion when it's better.
  // If the proxy isn't configured or fails, only the local tier shows.
  const OPTIMIZER_MIN_CHARS = 60;    // only analyze longer prompts
  const OPTIMIZER_MIN_TOKENS = 2;    // only suggest if it saves something real
  const OPTIMIZER_DEBOUNCE_MS = 350; // local heuristic (instant feel)
  const AI_DEBOUNCE_MS = 1100;       // AI (waits for a typing pause)
  let optimizerTimer = null;
  let aiTimer = null;
  let optimizerActiveInput = null;
  let optimizerSuggestion = null;
  let optimizerSource = 'local';     // 'local' | 'ai' — what the chip shows now
  let lastAiText = '';               // last prompt sent to the AI
  const aiCache = new Map();         // prompt text -> AI rewrite

  function getInputText(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA') return el.value || '';
    // For contenteditable, walk up to the actual editable root in case we
    // received a child element (e.g. a <p> inside ProseMirror).
    const root = el.isContentEditable ? el : (el.closest?.('[contenteditable="true"]') || el);
    return root.textContent || '';
  }

  function setInputText(el, text) {
    el.focus();
    if (el.tagName === 'TEXTAREA') {
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    // contenteditable (ChatGPT / Claude): select all, then insertText so the
    // host editor framework (Lexical / ProseMirror) registers the change.
    const sel = window.getSelection();
    sel.selectAllChildren(el);
    document.execCommand('insertText', false, text);
  }

  function injectOptimizerChip() {
    if (document.getElementById('pf-optimizer-chip')) return;
    const chip = document.createElement('div');
    chip.id = 'pf-optimizer-chip';
    chip.innerHTML = `
      <div class="pf-opt-head">
        <span>✦ Shorter prompt suggested</span>
        <span class="pf-opt-badge" id="pf-opt-badge">Local</span>
      </div>
      <div class="pf-opt-savings" id="pf-opt-savings"></div>
      <div class="pf-opt-preview" id="pf-opt-preview"></div>
      <div class="pf-opt-actions">
        <button id="pf-opt-dismiss" type="button">Dismiss</button>
        <button id="pf-opt-apply" type="button">Apply</button>
      </div>
    `;
    document.body.appendChild(chip);
    document.getElementById('pf-opt-dismiss').addEventListener('click', hideOptimizerChip);
    document.getElementById('pf-opt-apply').addEventListener('click', () => {
      if (optimizerActiveInput && optimizerSuggestion) {
        setInputText(optimizerActiveInput, optimizerSuggestion.shortened);
      }
      hideOptimizerChip();
    });
  }

  function hideOptimizerChip() {
    const chip = document.getElementById('pf-optimizer-chip');
    if (chip) chip.classList.remove('pf-opt-visible');
    optimizerSuggestion = null;
    optimizerSource = 'local';
  }

  function showOptimizerChip(result, source) {
    const chip = document.getElementById('pf-optimizer-chip');
    if (!chip) return;
    const savingsEl = document.getElementById('pf-opt-savings');
    const previewEl = document.getElementById('pf-opt-preview');
    const badgeEl = document.getElementById('pf-opt-badge');
    savingsEl.innerHTML =
      `Save <strong>~${result.savedTokens} tokens</strong> (${result.savedPct}%) · ` +
      `${_fmtWater(result.savedWaterMl)} · ${_fmtEnergy(result.savedEnergyWh)}`;
    previewEl.textContent = result.shortened;
    if (badgeEl) {
      badgeEl.textContent = source === 'ai' ? 'AI' : 'Local';
      badgeEl.classList.toggle('pf-opt-badge-ai', source === 'ai');
    }
    chip.classList.add('pf-opt-visible');
  }

  // Tier 1 — instant local heuristic.
  function analyzeInput(el) {
    const text = getInputText(el);
    if (text.length < OPTIMIZER_MIN_CHARS) {
      hideOptimizerChip();
      return;
    }
    const result = PFPromptOptimizer.analyze(text, adapter.id);
    if (result.changed && result.savedTokens >= OPTIMIZER_MIN_TOKENS) {
      optimizerActiveInput = el;
      optimizerSuggestion = result;
      optimizerSource = 'local';
      showOptimizerChip(result, 'local');
    } else if (optimizerSource !== 'ai') {
      // Don't clobber an AI suggestion that's already showing for this text.
      hideOptimizerChip();
    }
  }

  // Tier 2 — AI rewrite via the Gemini proxy (replaces the local suggestion
  // when it saves more). No-op if the proxy isn't configured.
  async function analyzeInputAI(el) {
    const text = getInputText(el);
    if (text.length < OPTIMIZER_MIN_CHARS) return;
    if (text === lastAiText) return;
    lastAiText = text;

    let rewritten = aiCache.get(text);
    if (rewritten === undefined) {
      const resp = await sendMessage({ type: 'OPTIMIZE_PROMPT', payload: { text } });
      rewritten = (resp && resp.rewritten) || '';
      aiCache.set(text, rewritten);
    }
    if (!rewritten) return;
    // The user may have kept typing — only apply if the input is unchanged.
    if (getInputText(el) !== text) return;

    const result = PFPromptOptimizer.savings(text, rewritten, adapter.id);
    if (!result.changed || result.savedTokens < OPTIMIZER_MIN_TOKENS) return;
    // Prefer AI only if it saves at least as much as whatever is showing.
    if (optimizerSuggestion && optimizerSource === 'ai' &&
        result.savedTokens <= optimizerSuggestion.savedTokens) return;

    optimizerActiveInput = el;
    optimizerSuggestion = result;
    optimizerSource = 'ai';
    showOptimizerChip(result, 'ai');
  }

  function setupPromptOptimizer() {
    injectOptimizerChip();
    // Single delegated listener — the composer element may be re-created.
    document.addEventListener('input', (e) => {
      // The input event often fires on a child of the contenteditable (e.g. a <p>
      // inside ProseMirror). Walk up to find the actual input element.
      // Fall back to any contenteditable to handle editor framework changes.
      const target = e.target;
      const el = target.matches?.(adapter.inputSelector)
        ? target
        : target.closest?.(adapter.inputSelector)
        || target.closest?.('[contenteditable="true"]')
        || (target.tagName === 'TEXTAREA' ? target : null);
      if (!el) return;
      clearTimeout(optimizerTimer);
      clearTimeout(aiTimer);
      optimizerTimer = setTimeout(() => analyzeInput(el), OPTIMIZER_DEBOUNCE_MS);
      aiTimer = setTimeout(() => analyzeInputAI(el), AI_DEBOUNCE_MS);
    }, true);
  }

  // Listen for config changes from popup
  chrome.runtime.onMessage.addListener((message, sender) => {
    // SECURITY: Only accept messages from our own extension
    if (sender.id !== chrome.runtime.id) return;

    if (message.type === 'CONFIG_UPDATED' && message.config) {
      // SECURITY: Only accept known config keys with validated types
      if (typeof message.config.overlayEnabled === 'boolean') {
        config.overlayEnabled = message.config.overlayEnabled;
      }
      if (typeof message.config.energyPerTokenMultiplier === 'number' &&
          message.config.energyPerTokenMultiplier > 0 &&
          message.config.energyPerTokenMultiplier <= 20) {
        config.energyPerTokenMultiplier = message.config.energyPerTokenMultiplier;
      }
      const overlay = document.getElementById('pf-floating-overlay');
      if (overlay) {
        overlay.style.display = config.overlayEnabled ? 'block' : 'none';
      }
    }
  });

  // End session on page unload (best-effort; background also closes on tab removal)
  window.addEventListener('beforeunload', () => {
    if (currentSessionId) {
      sendMessage({ type: 'END_SESSION', payload: { sessionId: currentSessionId } });
    }
  });

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
