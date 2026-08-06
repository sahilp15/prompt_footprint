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
  let config = { overlayEnabled: true, energyPerTokenMultiplier: 1.0, debug: false, writingChecksEnabled: true };
  let assistant = null;               // the in-page writing assistant (overlay/assistant.js)
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
    startAssistant();
    setupPanelShortcut();
    startWatchdog();
    log(`content script loaded — platform=${adapter.id} (${adapter.name}) session=${currentSessionId}`);
    log('composer detected:', !!PFComposer.findComposer(document, { adapterSelector: adapter.inputSelector }),
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
      if (!el) return;
      // Accept the adapter's selector OR the detected composer, so a selector
      // that goes stale after a redesign does not silently stop tracking.
      const composer = PFComposer.findComposer(document, { adapterSelector: adapter.inputSelector });
      const inComposer = (el.matches?.(adapter.inputSelector) || el.closest?.(adapter.inputSelector)) ||
        (composer && (el === composer || composer.contains(el)));
      if (!inComposer) return;
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
    const input = PFComposer.findComposer(document, { adapterSelector: adapter.inputSelector }) ||
      document.querySelector(adapter.inputSelector);
    const text = input ? PFComposer.readText(input).trim() : '';
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
      if (assistant) assistant.ensureAlive();
      const overlay = document.getElementById('pf-floating-overlay');
      if (overlay) overlay.style.display = config.overlayEnabled ? 'block' : 'none';

      if (location.href !== lastUrl) {
        lastUrl = location.href;
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
    restoreCapsulePosition(container);
    makeCapsuleDraggable(container);

    if (!config.overlayEnabled) {
      container.style.display = 'none';
    }
  }

  // ── Draggable capsule ──────────────────────────────────────────────────--
  // The capsule can be dragged anywhere and its position persists across
  // reloads (pf_capsule_pos). A move past a small threshold is treated as a
  // drag (and suppresses the click that would otherwise open the panel); a tap
  // still opens the panel, and keyboard Enter/Space still works (a11y intact).
  function applyCapsulePosition(c, left, top) {
    c.style.left = `${left}px`;
    c.style.top = `${top}px`;
    c.style.right = 'auto';
    c.style.bottom = 'auto';
  }

  function saveCapsulePosition(left, top) {
    if (!extAlive()) return;
    try { chrome.storage.local.set({ pf_capsule_pos: { left, top } }); } catch (_) {}
  }

  function restoreCapsulePosition(c) {
    if (!extAlive()) return;
    try {
      chrome.storage.local.get(['pf_capsule_pos'], (res) => {
        void chrome.runtime.lastError;
        const p = res && res.pf_capsule_pos;
        if (!p || typeof p.left !== 'number' || typeof p.top !== 'number') return;
        const size = { width: c.offsetWidth || 120, height: c.offsetHeight || 40 };
        const pos = PFUiHelpers.clampToViewport(p, size, { width: window.innerWidth, height: window.innerHeight });
        applyCapsulePosition(c, pos.left, pos.top);
      });
    } catch (_) {}
  }

  function makeCapsuleDraggable(container) {
    const pill = container.querySelector('.pf-floating-pill');
    if (!pill) return;
    let startX = 0, startY = 0, originLeft = 0, originTop = 0, dragging = false, moved = false;

    pill.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      moved = false;
      const rect = container.getBoundingClientRect();
      originLeft = rect.left;
      originTop = rect.top;
      startX = e.clientX;
      startY = e.clientY;
      pill.setPointerCapture?.(e.pointerId);
    });
    pill.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (!moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      moved = true;
      container.classList.add('pf-floating-dragging');
      const size = { width: container.offsetWidth, height: container.offsetHeight };
      const pos = PFUiHelpers.clampToViewport(
        { left: originLeft + dx, top: originTop + dy }, size,
        { width: window.innerWidth, height: window.innerHeight });
      applyCapsulePosition(container, pos.left, pos.top);
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      pill.releasePointerCapture?.(e.pointerId);
      container.classList.remove('pf-floating-dragging');
      if (moved) {
        // Swallow the click that fires right after a drag so it doesn't open
        // the panel; the position is what the user wanted.
        const supp = (ev) => { ev.stopPropagation(); ev.preventDefault(); pill.removeEventListener('click', supp, true); };
        pill.addEventListener('click', supp, true);
        const rect = container.getBoundingClientRect();
        saveCapsulePosition(rect.left, rect.top);
      }
    };
    pill.addEventListener('pointerup', end);
    pill.addEventListener('pointercancel', end);
  }

  // Toggle the main panel from a keyboard shortcut (Alt+P). Bound once.
  function setupPanelShortcut() {
    document.addEventListener('keydown', (e) => {
      if (!PFUiHelpers.isPanelToggleShortcut(e)) return;
      e.preventDefault();
      toggleModal();
    }, true);
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
        <div class="pf-modal-resize" id="pf-modal-resize" title="Drag to resize" aria-label="Resize panel"></div>
        <div class="pf-modal-header">
          <span class="pf-modal-title">PromptFootprint</span>
          <button class="pf-modal-close" id="pf-modal-close-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div class="pf-modal-body">
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

        <div class="pf-modal-section pf-modal-weather" id="pf-modal-weather" hidden>
          <div class="pf-modal-section-label">Weather adjustment <span class="pf-modal-approx">approx</span></div>
          <div class="pf-modal-weather-body" id="pf-weather-body"></div>
        </div>
        </div>

        <div class="pf-modal-footer">
          <div class="pf-modal-query-count" id="pf-query-count">0 queries this session</div>
          <button class="pf-modal-btn" id="pf-open-stats-btn">View Full Stats</button>
        </div>
        <div class="pf-modal-hint">Tip: press <kbd>Alt</kbd>+<kbd>P</kbd> to open or close · drag the capsule to move it · drag the top-left corner to resize</div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('pf-modal-close-btn').addEventListener('click', () => toggleModal(false));
    document.getElementById('pf-open-stats-btn').addEventListener('click', () => {
      // Local-first: stats live in the extension's own dashboard page.
      chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
    });

    restoreModalSize();
    makeModalResizable();
  }

  // Persisted user resizing of the stats panel. Bounds keep it usable and out of
  // the way of the page's composer even at max size.
  const MODAL_MIN = { w: 240, h: 200 };
  function modalMax() {
    return { w: Math.min(460, window.innerWidth - 40), h: Math.min(560, window.innerHeight - 40) };
  }
  function clampModalSize(w, h) {
    const max = modalMax();
    return {
      w: Math.round(Math.min(Math.max(w, MODAL_MIN.w), Math.max(MODAL_MIN.w, max.w))),
      h: Math.round(Math.min(Math.max(h, MODAL_MIN.h), Math.max(MODAL_MIN.h, max.h))),
    };
  }
  function saveModalSize(w, h) {
    try { chrome.storage.local.set({ pf_modal_size: { w, h } }); } catch (_) {}
  }
  function restoreModalSize() {
    const container = document.querySelector('#pf-modal-overlay .pf-modal-container');
    if (!container || !chrome?.storage?.local) return;
    chrome.storage.local.get(['pf_modal_size'], (res) => {
      const s = res && res.pf_modal_size;
      if (!s || typeof s.w !== 'number' || typeof s.h !== 'number') return;
      const c = clampModalSize(s.w, s.h);
      container.style.width = c.w + 'px';
      container.style.height = c.h + 'px';
    });
  }
  function makeModalResizable() {
    const handle = document.getElementById('pf-modal-resize');
    const container = document.querySelector('#pf-modal-overlay .pf-modal-container');
    if (!handle || !container) return;
    let startX = 0, startY = 0, startW = 0, startH = 0, resizing = false;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      resizing = true;
      startX = e.clientX; startY = e.clientY;
      startW = container.offsetWidth; startH = container.offsetHeight;
      container.classList.add('pf-modal-resizing');
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    });
    handle.addEventListener('pointermove', (e) => {
      if (!resizing) return;
      // Panel is anchored bottom-right, so dragging the top-left handle up/left
      // (negative dx/dy) grows the panel.
      const c = clampModalSize(startW - (e.clientX - startX), startH - (e.clientY - startY));
      container.style.width = c.w + 'px';
      container.style.height = c.h + 'px';
    });
    const end = (e) => {
      if (!resizing) return;
      resizing = false;
      container.classList.remove('pf-modal-resizing');
      try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
      saveModalSize(container.offsetWidth, container.offsetHeight);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  function toggleModal(forceState) {
    const modal = document.getElementById('pf-modal-overlay');
    if (!modal) return;

    if (forceState !== undefined) {
      modal.classList.toggle('pf-modal-hidden', !forceState);
    } else {
      modal.classList.toggle('pf-modal-hidden');
    }
    // When the panel becomes visible, refresh the weather-adjusted figure.
    if (!modal.classList.contains('pf-modal-hidden')) refreshWeatherAdjustment();
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

    // Keep the weather-adjusted figures in step with the growing session totals
    // (re-render only — no network; the value is refreshed when the panel opens).
    renderWeatherAdjustment();
  }

  // ── Weather-adjusted estimate (shown beneath the base numbers) ────────────
  // The content script can't fetch Open-Meteo (the chat page's CSP blocks it),
  // so the service worker fetches + computes the factor; here we just render it.
  let _weatherAdj = null;
  function escapeSafe(s) {
    if (typeof PFWritingFormat !== 'undefined' && PFWritingFormat.escapeHtml) return PFWritingFormat.escapeHtml(s);
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  async function refreshWeatherAdjustment() {
    try {
      const resp = await sendMessage({ type: 'GET_WEATHER_ADJ' });
      _weatherAdj = resp && typeof resp === 'object' ? resp : null;
    } catch (_) {
      _weatherAdj = null;
    }
    renderWeatherAdjustment();
  }
  function renderWeatherAdjustment() {
    const section = document.getElementById('pf-modal-weather');
    const body = document.getElementById('pf-weather-body');
    if (!section || !body) return;
    const adj = _weatherAdj;
    if (!adj || !adj.available) {
      if (adj && adj.reason === 'no_location') {
        section.hidden = false;
        body.innerHTML = '<div class="pf-weather-hint">Set a location on the dashboard (Weekly Stats → Weather-aware estimate) to see a weather-adjusted figure here.</div>';
      } else {
        section.hidden = true;
      }
      return;
    }
    section.hidden = false;
    const region = escapeSafe(adj.regionLabel || 'nearest region');
    const temp = adj.tempC != null ? `${adj.tempC}°C` : '—';
    if (adj.isHot && adj.factor > 1.001) {
      const e = PFFormat.energy(sessionStats.totalEnergyWh * adj.factor).compact;
      const w = PFFormat.water(sessionStats.totalWaterMl * adj.factor).compact;
      const c = PFFormat.co2(sessionStats.totalCo2G * adj.factor).compact;
      body.innerHTML =
        `<div class="pf-weather-note">It’s hot near <strong>${region}</strong> (${temp}). Cooling could add about <strong>+${adj.pct}%</strong>, so this session is closer to:</div>` +
        '<div class="pf-weather-grid">' +
          `<div class="pf-weather-cell"><span class="pf-weather-val">${e}</span><span class="pf-weather-lbl">Energy</span></div>` +
          `<div class="pf-weather-cell"><span class="pf-weather-val">${w}</span><span class="pf-weather-lbl">Water</span></div>` +
          `<div class="pf-weather-cell"><span class="pf-weather-val">${c}</span><span class="pf-weather-lbl">CO2</span></div>` +
        '</div>' +
        '<div class="pf-weather-fine">Approximate — live weather at the nearest known cloud region, not the exact data center.</div>';
    } else {
      body.innerHTML = `<div class="pf-weather-note">Mild near <strong>${region}</strong> (${temp}) right now — the standard estimate applies, no weather adjustment needed.</div>`;
    }
  }

  // ── In-page writing assistant ──────────────────────────────────────────────
  // The floating indicator by the composer. All of its behaviour lives in
  // overlay/assistant.js; this is the wiring that hands it the pieces it needs:
  // the Token Cutter engine, the composer layer, this platform's id, the
  // existing pf_config settings layer, and the savings ledger.
  //
  // The engine is the SAME build the dashboard's Token Cutter runs
  // (lib/tokenCutter.bundle.js, produced from stats-site by `npm run
  // build:cutter`), so an optimization suggested here is byte-identical to one
  // suggested there. If that bundle ever fails to load, the assistant reports
  // "local optimizer unavailable" and everything else on the page keeps working.
  function startAssistant() {
    if (assistant) return;
    if (typeof PFAssistant === 'undefined' || typeof PFComposer === 'undefined') {
      log('assistant: modules missing — skipping in-page assistant');
      return;
    }
    const engine = (typeof PFTokenCutter !== 'undefined') ? PFTokenCutter : null;
    if (!engine) log('assistant: Token Cutter bundle missing — run `npm run build:cutter`');

    const deps = {
      engine,
      composer: PFComposer,
      state: PFAssistantState,
      format: PFFormat,
      platform: adapter.id,
      adapterSelector: adapter.inputSelector,
      memory: engine ? engine.emptyMemory() : null,
      log,
      getConfig: () => PFStorage.getConfig(),
      setConfig: (patch) => PFStorage.setConfig(patch),
      resetSettings: () => PFStorage.setConfig(PFAssistantState.resetPatch()),
      // The network hop for the optional enhanced mode runs in the service
      // worker: the chat page's CSP blocks it here, and the worker is the single
      // cross-tab chokepoint where rate limiting already lives.
      requestEnhanced: async (text) => {
        const resp = await sendMessage({ type: 'OPTIMIZE_PROMPT', payload: { text } });
        return { text: (resp && resp.rewritten) || '', status: resp && resp.status };
      },
      onReplaced: (savings) => recordSavings(savings),
    };

    assistant = PFAssistant.createAssistant(deps);
    assistant.start().then((ok) => {
      if (!ok) { assistant = null; return; }
      // The Token Cutter's memory (never-remove terms, standing preferences) is
      // the user's, stored on-device by the dashboard. Load it once and let the
      // next analysis pick it up — it must never delay the first render.
      if (engine && typeof engine.loadMemory === 'function') {
        engine.loadMemory()
          .then((memory) => { deps.memory = memory; })
          .catch(() => {});
      }
    });
  }

  // Persist savings the user actually realized by replacing their prompt (never
  // suggestions they ignored) so the dashboard's Savings tab can total them.
  function recordSavings(result) {
    if (!result || !extAlive() || !PFStorage.addSavings) return;
    if (!(result.savedTokens > 0)) return;
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
      // The in-page assistant's own preferences (master switch, level, auto
      // analysis, impact figures, mode, animations) all live in pf_config, so a
      // change from the popup or the dashboard is picked up by re-reading it
      // rather than by mirroring each key here.
      if (typeof message.config.writingChecksEnabled === 'boolean') {
        config.writingChecksEnabled = message.config.writingChecksEnabled;
      }
      if (assistant) assistant.refreshSettings();
      const overlay = document.getElementById('pf-floating-overlay');
      if (overlay) {
        overlay.style.display = config.overlayEnabled ? 'block' : 'none';
      }
    }
  });

  // Tear the assistant down cleanly when the page goes away, so its observers,
  // listeners, timers, and shadow host never outlive the document.
  window.addEventListener('pagehide', () => {
    if (assistant) { assistant.destroy(); assistant = null; }
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
