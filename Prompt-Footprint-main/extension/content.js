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
  let config = { overlayEnabled: true, energyPerTokenMultiplier: 1.0, debug: false };
  let processedMessageIds = new Set();
  let pendingUserMessage = null;
  let lastSubmitAt = 0;               // timestamp of the last submit-hook capture
  let lastFinalizedText = '';         // guard against finalizing the same response twice
  let sessionStats = { totalTokens: 0, totalEnergyWh: 0, totalWaterMl: 0, totalCo2G: 0, queryCount: 0 };
  let lastQueryImpact = null;

  // Verbose logging is opt-in (pf_config.debug) so production stays quiet.
  function log(...args) {
    if (config.debug) console.log('[PromptFootprint]', ...args);
  }

  // Response capture is POLLING-based, not mutation-based. ChatGPT and Claude
  // stream responses by replacing DOM nodes (childList) rather than mutating
  // text nodes (characterData), so a characterData debounce misses most of the
  // stream. Instead we poll the latest assistant element's text and only
  // finalize once it has stopped growing for SETTLE_DELAY_MS *and* the platform
  // is no longer generating (Stop button gone).
  const RESPONSE_POLL_MS = 500;       // how often to sample the assistant text
  const SETTLE_DELAY_MS = 2000;       // text must be stable this long to finalize
  const SUBMIT_DEDUP_MS = 3000;       // ignore observer user-bubble within this of a submit
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
    setupSubmitHook();
    setupPromptOptimizer();
    startWatchdog();
    log(`content script loaded — platform=${adapter.id} (${adapter.name}) session=${currentSessionId}`);
    log('composer detected:', document.querySelectorAll(adapter.inputSelector).length,
        '| send button:', !!(adapter.getSendButton && adapter.getSendButton()));
  }

  // ── Submit hook (primary user-prompt trigger) ───────────────────────────--
  // Capturing the prompt at submit time is resilient to chat-bubble selector
  // drift: we read the composer text the instant the user sends, before the
  // host UI clears it. The MutationObserver remains a fallback for programmatic
  // submits; a short dedup window stops the two paths from double-counting.
  function setupSubmitHook() {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      const el = e.target;
      if (!el || !el.matches?.(adapter.inputSelector) &&
          !el.closest?.(adapter.inputSelector)) return;
      captureSubmittedPrompt('enter');
    }, true);

    document.addEventListener('click', (e) => {
      const btn = e.target?.closest?.(adapter.sendSelector || 'button');
      if (!btn) return;
      if (adapter.sendSelector && !btn.matches?.(adapter.sendSelector) &&
          !btn.closest?.(adapter.sendSelector)) return;
      captureSubmittedPrompt('send-button');
    }, true);
  }

  function captureSubmittedPrompt(trigger) {
    const input = document.querySelector(adapter.inputSelector);
    const text = input ? getInputText(input).trim() : '';
    if (!text) { log('submit ignored — empty composer (trigger=', trigger, ')'); return; }
    // Ignore a second trigger for the same in-flight turn (Enter + click, or
    // rapid re-fire) so we don't restart the watch on the same prompt.
    if (pendingUserMessage && Date.now() - lastSubmitAt < SUBMIT_DEDUP_MS) {
      log('submit ignored — capture already active (trigger=', trigger, ')');
      return;
    }
    lastSubmitAt = Date.now();
    pendingUserMessage = { id: `submit-${lastSubmitAt}`, text, startTime: lastSubmitAt };
    updateFloatingStatus('recording');
    startResponseWatch();
    log('prompt captured at submit — trigger=', trigger, 'len=', text.length, '→ generation started');
  }

  // ── Robustness watchdog ────────────────────────────────────────────────--
  // SPA frameworks can re-render and remove our injected UI, or navigate to a
  // new conversation. Periodically make sure our overlays exist and react to
  // URL changes — WITHOUT discarding an in-progress capture.
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

      if (location.href !== lastUrl) {
        lastUrl = location.href;
        hideOptimizerChip();
        // CRITICAL: sending the first message in a NEW chat changes the URL
        // (/ -> /c/<id>). Cancelling here used to discard the very interaction
        // we just started tracking. Only reset when nothing is being captured;
        // an active capture keeps running (it has its own settle/timeout).
        if (!pendingUserMessage && !responseWatch) {
          updateFloatingStatus('saved');
        } else {
          log('URL changed during active capture — keeping capture alive:', location.href);
        }
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
      log('Observer attached to document.body');
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

      processedMessageIds.add(messageId);

      // The submit hook is the primary trigger; if it fired moments ago this is
      // the same turn surfacing in the DOM, so don't start a second capture.
      if (Date.now() - lastSubmitAt < SUBMIT_DEDUP_MS || pendingUserMessage) return;

      pendingUserMessage = { id: messageId, text, startTime: Date.now() };
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
      log('poll: assistant text growing, len=', text.length);
      return;
    }

    // Model is still working (thinking/streaming/searching) even if the visible
    // text is momentarily stable → keep the stability clock from advancing so we
    // never finalize mid-generation.
    const signal = typeof adapter.generatingSignal === 'function'
      ? adapter.generatingSignal()
      : (typeof adapter.isGenerating === 'function' && adapter.isGenerating() ? 'generating' : null);
    const generating = !!signal;
    if (generating) {
      responseWatch.lastChange = now;
      log('poll: still generating (signal=', signal, ') textLen=', text.length);
      return;
    }

    const stableMs = now - responseWatch.lastChange;
    const completeSignal = typeof adapter.isComplete === 'function' && adapter.isComplete();
    const done = PFPlatforms.isResponseComplete({
      generating, hasText: !!text, stableMs, settleMs: SETTLE_DELAY_MS, completeSignal,
    });
    if (done) {
      log('poll: complete (stableMs=', stableMs, 'completeSignal=', completeSignal, 'len=', text.length, ')');
      finalizeResponse(latest, text, responseWatch.lastChange);
      return;
    }

    // No assistant text appeared at all → give up.
    if (!text && now - responseWatch.startedAt >= MAX_NO_RESPONSE_MS) {
      stopResponseWatch();
      updateFloatingStatus('saved');
      log('poll: gave up — no assistant text after', MAX_NO_RESPONSE_MS, 'ms');
      return;
    }

    // Response never settles (very long generation) → force-finalize.
    if (text && now - responseWatch.startedAt >= HARD_CAP_MS) {
      log('poll: hard cap reached — force finalizing');
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

    // Guard against logging the same assistant response twice (e.g. observer +
    // poll racing, or a re-render re-triggering capture).
    if (text && text === lastFinalizedText) {
      log('skip: duplicate response (already finalized)');
      updateFloatingStatus('saved');
      return;
    }
    lastFinalizedText = text;
    if (msgId) processedMessageIds.add(msgId);

    const responseTimeMs = Math.max(0, endTime - startTime);
    log('generation ended — assistant text len=', text.length, 'responseTimeMs=', responseTimeMs);
    processQuery(prompt, text, responseTimeMs);
  }

  async function processQuery(promptText, responseText, responseTimeMs) {
    const multiplier = config.energyPerTokenMultiplier || 1.0;
    const impact = calculateQueryImpact(promptText, responseText, {
      platform: adapter.id,
      responseTimeMs,
      multiplier,
    });

    // Defensive: never persist an empty interaction (both prompt and response
    // must contribute tokens). The submit hook already requires a non-empty
    // prompt, so this should not trigger in practice.
    if (!impact.promptTokens || !impact.totalTokens) {
      log('skip: 0-token interaction', { promptTokens: impact.promptTokens, totalTokens: impact.totalTokens });
      updateFloatingStatus('saved');
      return;
    }

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
        log('storage write ok — session', currentSessionId, 'tokens', impact.totalTokens);
      } catch (e) {
        log('storage write FAILED:', e && e.message);
      }
    } else {
      log('skip storage write — no session or extension context');
    }

    updateFloatingStatus('saved');
    updateModalStats();
    log('Query logged:', { promptTokens: impact.promptTokens, responseTokens: impact.responseTokens, totalTokens: impact.totalTokens, responseTimeMs });
  }

  // ── Floating Overlay ───────────────────────────────────────────────────--
  function injectFloatingOverlay() {
    if (document.getElementById('pf-floating-overlay')) return;

    const container = document.createElement('div');
    container.id = 'pf-floating-overlay';
    container.innerHTML = `
      <div class="pf-floating-pill" role="button" tabindex="0" aria-label="Open PromptFootprint session details">
        <div class="pf-floating-dot"></div>
        <span class="pf-floating-label">PF</span>
        <span class="pf-floating-status">Tracking</span>
      </div>
    `;

    container.addEventListener('click', () => toggleModal());
    // Keyboard parity: the pill is a button, so open the modal on Enter/Space.
    const pill = container.querySelector('.pf-floating-pill');
    if (pill) {
      pill.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleModal();
        }
      });
    }
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

  // Real-world conversion helpers — shared with popup.js via lib/formatters.js.
  // The modal uses the single-line `compact` form.
  function updateModalStats() {
    const fmtRaw = (v, unit) => `${v.toFixed(3)} ${unit}`;

    // Session totals — human-readable conversions
    const energyEl = document.getElementById('pf-session-energy');
    const waterEl  = document.getElementById('pf-session-water');
    const co2El    = document.getElementById('pf-session-co2');
    if (energyEl) energyEl.textContent = PFFormat.energy(sessionStats.totalEnergyWh).compact;
    if (waterEl)  waterEl.textContent  = PFFormat.water(sessionStats.totalWaterMl).compact;
    if (co2El)    co2El.textContent    = PFFormat.co2(sessionStats.totalCo2G).compact;

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
      <div class="pf-opt-head" id="pf-opt-drag">
        <span class="pf-opt-title">✦ Shorter prompt suggested</span>
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
    restoreOptimizerPosition(chip);
    makeOptimizerDraggable(chip);
    document.getElementById('pf-opt-dismiss').addEventListener('click', hideOptimizerChip);
    document.getElementById('pf-opt-apply').addEventListener('click', () => {
      if (optimizerActiveInput && optimizerSuggestion) {
        setInputText(optimizerActiveInput, optimizerSuggestion.shortened);
        recordSavings(optimizerSuggestion);
      }
      hideOptimizerChip();
    });
  }

  // Persist savings the user actually realized by clicking Apply (never ignored
  // suggestions) so the dashboard's Savings tab can total them.
  function recordSavings(result) {
    if (!result || !extAlive() || !PFStorage.addSavings) return;
    try {
      PFStorage.addSavings({
        savedTokens: result.savedTokens || 0,
        savedEnergyWh: result.savedEnergyWh || 0,
        savedWaterMl: result.savedWaterMl || 0,
        savedCo2G: result.savedCo2G || 0,
      });
      log('Savings recorded:', result.savedTokens, 'tokens');
    } catch (_) {
      // Extension context invalidated — non-fatal.
    }
  }

  // ── Draggable chip ──────────────────────────────────────────────────────--
  // The chip defaults above the composer but the user can drag it anywhere by
  // its header; the position is remembered across pages.
  function makeOptimizerDraggable(chip) {
    const handle = chip.querySelector('#pf-opt-drag');
    if (!handle) return;
    let startX = 0, startY = 0, originLeft = 0, originTop = 0, dragging = false;

    handle.addEventListener('pointerdown', (e) => {
      // Ignore drags that start on interactive children (e.g. the badge).
      dragging = true;
      const rect = chip.getBoundingClientRect();
      originLeft = rect.left;
      originTop = rect.top;
      startX = e.clientX;
      startY = e.clientY;
      handle.setPointerCapture?.(e.pointerId);
      chip.classList.add('pf-opt-dragging');
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const w = chip.offsetWidth, h = chip.offsetHeight;
      const left = Math.max(8, Math.min(window.innerWidth - w - 8, originLeft + (e.clientX - startX)));
      const top = Math.max(8, Math.min(window.innerHeight - h - 8, originTop + (e.clientY - startY)));
      applyOptimizerPosition(chip, left, top);
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      chip.classList.remove('pf-opt-dragging');
      handle.releasePointerCapture?.(e.pointerId);
      const rect = chip.getBoundingClientRect();
      saveOptimizerPosition(rect.left, rect.top);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  // Pin the chip to explicit coordinates (overriding the CSS bottom/centered default).
  function applyOptimizerPosition(chip, left, top) {
    chip.style.left = `${left}px`;
    chip.style.top = `${top}px`;
    chip.style.bottom = 'auto';
    chip.style.transform = 'none';
  }

  function saveOptimizerPosition(left, top) {
    if (!extAlive()) return;
    try { chrome.storage.local.set({ pf_optimizer_pos: { left, top } }); } catch (_) {}
  }

  function restoreOptimizerPosition(chip) {
    if (!extAlive()) return;
    try {
      chrome.storage.local.get(['pf_optimizer_pos'], (res) => {
        void chrome.runtime.lastError;
        const p = res && res.pf_optimizer_pos;
        if (p && typeof p.left === 'number' && typeof p.top === 'number') {
          const left = Math.max(8, Math.min(window.innerWidth - 60, p.left));
          const top = Math.max(8, Math.min(window.innerHeight - 60, p.top));
          applyOptimizerPosition(chip, left, top);
        }
      });
    } catch (_) {}
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
    const typoNote = result.typosFixed > 0
      ? ` · <strong>${result.typosFixed} ${result.typosFixed === 1 ? 'typo' : 'typos'}</strong> fixed`
      : '';
    savingsEl.innerHTML =
      `Save <strong>~${result.savedTokens} tokens</strong> (${result.savedPct}%) · ` +
      `${PFFormat.water(result.savedWaterMl).compact} · ${PFFormat.energy(result.savedEnergyWh).compact}${typoNote}`;
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
    if (result.changed && (result.savedTokens >= OPTIMIZER_MIN_TOKENS || result.typosFixed > 0)) {
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

  let optimizerListenersAttached = false;
  function setupPromptOptimizer() {
    injectOptimizerChip();
    // Guard against attaching duplicate document listeners if setup ever runs
    // more than once (each would re-run analysis on every keystroke).
    if (optimizerListenersAttached) return;

    function handleInputChange(e) {
      const target = e.target;
      const el = target.matches?.(adapter.inputSelector)
        ? target
        : target.closest?.(adapter.inputSelector)
        || target.closest?.('[contenteditable="true"]')
        || (target.tagName === 'TEXTAREA' ? target : null);
      if (!el) return;
      clearTimeout(optimizerTimer);
      clearTimeout(aiTimer);
      // Paste: read text after the paste has been inserted into the DOM.
      const delay = e.type === 'paste' ? 100 : 0;
      optimizerTimer = setTimeout(() => analyzeInput(el), OPTIMIZER_DEBOUNCE_MS + delay);
      aiTimer = setTimeout(() => analyzeInputAI(el), AI_DEBOUNCE_MS + delay);
    }

    document.addEventListener('input', handleInputChange, true);
    document.addEventListener('paste', handleInputChange, true);
    optimizerListenersAttached = true;
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
      if (typeof message.config.debug === 'boolean') {
        config.debug = message.config.debug;
        log('debug logging', config.debug ? 'ENABLED' : 'disabled');
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

  // Start. The overlay is injected before any storage call, so a storage
  // failure degrades to "UI visible, tracking off" rather than throwing.
  const startTracking = () => init().catch((e) => log('init failed:', e && e.message));
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startTracking);
  } else {
    startTracking();
  }
})();
