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

  // ── Live model detection state ─────────────────────────────────────────---
  // `observation` is what the page currently shows; `snapshots` is what each
  // sent message was sent WITH. Those are different questions, and conflating
  // them is how a model switch would silently rewrite history.
  const providerAdapter = (typeof PFProviderAdapters !== 'undefined')
    ? PFProviderAdapters.forLocation(typeof location !== 'undefined' ? location : null)
    : null;
  const snapshots = (typeof PFPromptSnapshots !== 'undefined') ? PFPromptSnapshots.createStore() : null;
  // Models the catalog does not know yet. Recorded locally, never transmitted,
  // and never used to guess an identity — only to mark an estimate as a
  // provider-level fallback and to leave a trace worth acting on later.
  const discovery = (typeof PFModelDiscovery !== 'undefined')
    ? PFModelDiscovery.createRegistry({ log })
    : null;
  // ── The token analyzer ─────────────────────────────────────────────────---
  // Attachments and pasted content are input too. The tracker captures files the
  // user attaches (and notices when they remove them); the context model turns
  // the composer text, the pasted runs, and the attachments into one breakdown.
  // Both are model-aware: everything is re-costed when the picker changes,
  // without re-reading a byte of any file.
  const attachmentTracker = (typeof PFAttachmentTracker !== 'undefined')
    ? PFAttachmentTracker.createTracker({
      document,
      adapter,
      getTarget: () => tokenTarget(),
      getSurface: () => (observation && observation.surface) || adapter.id,
      onChange: onAttachmentsChanged,
      log,
    })
    : null;
  const contextModel = (typeof PFContext !== 'undefined')
    ? PFContext.createContext({
      getTarget: () => tokenTarget(),
      getSurface: () => (observation && observation.surface) || adapter.id,
      tracker: attachmentTracker,
    })
    : null;

  let detector = null;
  let observation = null;
  let draftEstimate = null;         // projection for the prompt being typed
  let draftBreakdown = null;        // the token analyzer's breakdown of it
  let lastChangeExplanation = null; // why the projection moved, for the panel
  let draftTimer = null;

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

    // Additive schema stamp for anything recorded by the previous estimator.
    // Never blocks tracking: a failure here just means the stamp is retried next
    // load, and every stored number stays exactly as it was.
    PFStorage.migrateStorage().then((r) => {
      if (r && r.migrated) log('storage migrated', r);
    }).catch((e) => log('storage migration skipped:', e && e.message));

    startObserver();
    startModelDetection();
    setupSubmitHook();
    setupDraftWatch();
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
    // Freeze the model at SEND time. From here on this message belongs to this
    // model, whatever the picker does next.
    const snapshot = takeSendSnapshot(text, lastSubmitAt);
    // The composer clears on send and so do its attachments; anything still
    // tracked would be counted again against the next message.
    if (attachmentTracker) attachmentTracker.reset('sent');
    if (contextModel) contextModel.reset();
    if (assistant && typeof assistant.contextChanged === 'function') assistant.contextChanged();
    pendingUserMessage = {
      id: `submit-${lastSubmitAt}`, text, startTime: lastSubmitAt,
      snapshotId: snapshot ? snapshot.id : null,
    };
    updateFloatingStatus('recording');
    startResponseWatch();
    log('prompt captured at submit — trigger=', trigger, 'len=', text.length,
        'model=', observation && (observation.canonicalModel || observation.selectedLabel),
        '→ generation started');
  }

  // ── Live model detection ───────────────────────────────────────────────--
  // The detector owns the observers; this is the wiring that reacts to what it
  // finds. On a model/mode change we re-project the UNSENT prompt and explain
  // the move — and we deliberately do not touch anything already sent.
  function startModelDetection() {
    if (!providerAdapter || typeof PFModelDetector === 'undefined') {
      log('model detection: no adapter for this host — estimates will be provider-level');
      return;
    }
    detector = PFModelDetector.create({
      adapter: providerAdapter,
      document,
      window,
      log,
      onChange: onModelChange,
    });
    detector.start();
    observation = detector.current;
    if (discovery) discovery.load().catch(() => {});
    recordDiscovery(observation);
    recomputeDraft('init');
    log('model detection started —', observation && observation.selectedLabel, observation && observation.canonicalModel,
        '| reasoning:', observation && observation.reasoningMode);
  }

  function onModelChange(current, previous) {
    const prevEstimate = draftEstimate;
    observation = current;
    // Anything still in flight for the previous model is now describing a model
    // the user has moved away from. The detector's generation counter is what
    // makes that decidable; cancelling the pending draft pass is the local half.
    if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
    recomputeDraft('model-change');
    lastChangeExplanation = (typeof PFModelPresent !== 'undefined')
      ? PFModelPresent.changeExplanation(previous, current, prevEstimate, draftEstimate)
      : null;
    updateModelPanel();
    // The in-page assistant re-reads the model, re-labels its pill, and
    // re-optimizes the draft against the new target — without a reload, without
    // the panel closing, and without the user touching the prompt.
    publishModel(current);
    recordDiscovery(current);
    log('model change:', lastChangeExplanation);
  }

  /**
   * A picker label the catalog has never seen.
   *
   * Recorded so the registry can be updated for real, and so the estimate can
   * be marked as a provider-level fallback — while the UI keeps showing the
   * exact model the product named. Knowing WHICH model is selected and knowing
   * WHAT IT COSTS are different things with different confidences.
   */
  function recordDiscovery(obs) {
    if (!discovery || !obs || !obs.selectedLabel || obs.canonicalModel) return;
    if (obs.routing === 'auto') return;   // Auto is a mode, not an unknown model
    discovery.record(obs.provider, obs.selectedLabel);
  }

  /** The text sitting in the composer right now (never stored, never sent). */
  function readDraftText() {
    const el = PFComposer.findComposer(document, { adapterSelector: adapter.inputSelector });
    return el ? PFComposer.readText(el) : '';
  }

  // Typing must not trigger a recalculation per keystroke; one per pause is
  // enough for a projection whose inputs are a token count and a model id.
  function setupDraftWatch() {
    document.addEventListener('input', () => {
      if (draftTimer) clearTimeout(draftTimer);
      draftTimer = setTimeout(() => { draftTimer = null; recomputeDraft('typing'); }, 400);
    }, true);

    // Pasted text is recorded so the breakdown can attribute it separately —
    // NOT so it can be added on top. Once pasted it is composer text, and
    // lib/tokens/context.js treats it as a subdivision of that total.
    document.addEventListener('paste', (e) => {
      if (!contextModel || !e.clipboardData) return;
      let pasted = '';
      try { pasted = e.clipboardData.getData('text/plain') || ''; } catch (_) { pasted = ''; }
      if (contextModel.notePaste(pasted)) log('paste captured —', pasted.length, 'characters');
    }, true);

    if (attachmentTracker) attachmentTracker.start();
  }

  /**
   * What the token counter needs to pick a tokenizer.
   *
   * Deliberately a narrow projection of the observation rather than the whole
   * thing: the counter must never be able to reach for a field it should not be
   * deciding on, and this is the list of things that legitimately change how
   * text is counted.
   */
  function tokenTarget() {
    const o = observation || {};
    return {
      provider: o.provider || (providerAdapter ? providerAdapter.provider : 'unknown'),
      canonicalModel: o.effectiveModel || o.canonicalModel || null,
      selectedLabel: o.selectedLabel || null,
      routing: o.routing || 'unknown',
      surface: o.surface || adapter.id,
    };
  }

  /**
   * Provider- and model-aware token count.
   *
   * Replaces the old global `estimateTokens` (characters / 4) at every call site
   * that describes a prompt. That function counted Claude and ChatGPT
   * identically, which on the current Claude tokenizer understates the input by
   * roughly 60%.
   */
  function countTokens(text) {
    if (typeof PFTokenCounter === 'undefined') return estimateTokens(text);
    return PFTokenCounter.count(text, tokenTarget());
  }

  /** The full observable request: composer text, pasted runs, and attachments. */
  function observableBreakdown() {
    if (!contextModel) return null;
    try {
      return contextModel.compose(readDraftText());
    } catch (e) {
      log('token analyzer failed:', e && e.message);
      return null;
    }
  }

  function onAttachmentsChanged(reason) {
    log('attachments changed (', reason, ')');
    recomputeDraft('attachments');
    if (assistant && typeof assistant.contextChanged === 'function') assistant.contextChanged();
  }

  /** Shared estimator input, built from the current observation. */
  function estimateInput(extra) {
    const o = observation || {};
    return {
      provider: o.provider || (providerAdapter ? providerAdapter.provider : 'unknown'),
      surface: o.surface || 'unknown',
      selectedModel: o.canonicalModel || null,
      effectiveModel: o.effectiveModel || null,
      modelConfidence: o.confidence || 0,
      routing: o.routing || 'unknown',
      reasoning: o.reasoningMode || 'unknown',
      tools: o.tools || [],
      ...extra,
    };
  }

  function recomputeDraft(reason) {
    if (typeof PFEstimator === 'undefined') return;
    // The whole observable request — attachments included. Projecting the energy
    // of "summarize this" while a 40-page PDF sits next to it was understating
    // the interaction by orders of magnitude, for the same reason the token
    // count was.
    const breakdown = observableBreakdown();
    const inputTokens = breakdown ? breakdown.total : countTokens(readDraftText());
    draftBreakdown = breakdown;
    draftEstimate = PFEstimator.estimate(estimateInput({ inputTokens, phase: 'draft' }));
    draftEstimate.generation = detector ? detector.generation : 0;
    updateModelPanel();
    if (reason !== 'typing') log('draft estimate (', reason, ')', inputTokens, 'tokens ->',
      PFEstimator.formatRange(draftEstimate.energyWh, 'Wh'));
  }

  /** What the popup asks for; a plain object, no DOM nodes, no prompt text. */
  function currentModelState() {
    const obs = observation ? { ...observation } : null;
    if (obs) delete obs.element;
    const inputTokens = draftEstimate ? draftEstimate.inputTokens : 0;
    let savings = null;
    if (draftEstimate && typeof PFEstimator !== 'undefined' && lastDraftSavings) {
      savings = lastDraftSavings;
    }
    return {
      supported: !!providerAdapter,
      observation: obs,
      estimate: draftEstimate,
      inputTokens,
      savings,
      // The popup shows the same breakdown the in-page panel does. Only counts
      // and file NAMES cross this boundary — never file contents, and never the
      // prompt text.
      breakdown: draftBreakdown ? {
        total: draftBreakdown.total,
        low: draftBreakdown.low,
        high: draftBreakdown.high,
        confidence: draftBreakdown.confidence,
        method: draftBreakdown.method,
        tokenizer: draftBreakdown.tokenizer,
        contextTokens: draftBreakdown.contextTokens,
        contextPercent: draftBreakdown.contextPercent,
        parts: draftBreakdown.parts.map((part) => ({
          label: part.label, kind: part.kind, tokens: part.tokens,
          confidence: part.confidence, pages: part.pages,
          textTokens: part.textTokens, visualTokens: part.visualTokens,
        })),
      } : null,
      changeExplanation: lastChangeExplanation,
      generation: detector ? detector.generation : 0,
    };
  }

  // The in-page assistant reports how many input tokens its suggestion would
  // avoid. That is an INPUT-side number and is projected as such — never as a
  // percentage of the whole interaction.
  let lastDraftSavings = null;
  function projectDraftSavings(originalTokens, optimizedTokens) {
    if (typeof PFEstimator === 'undefined' || !draftEstimate) return null;
    lastDraftSavings = PFEstimator.projectInputSavings({
      estimate: draftEstimate,
      originalInputTokens: originalTokens,
      optimizedInputTokens: optimizedTokens,
      phase: 'draft',
    });
    return lastDraftSavings;
  }

  /** What the in-page assistant needs to show an honest reduction figure. */
  function projectSavingsForAssistant(originalTokens, optimizedTokens) {
    const p = projectDraftSavings(originalTokens, optimizedTokens);
    if (!p) return null;
    return {
      // Two ranges, never one number: what the avoided input tokens are worth
      // to the prefill stage, and what that is worth to the whole interaction
      // once output decoding and hidden reasoning are accounted for.
      inputProcessing: p.inputProcessingPct
        ? PFEstimator.formatPercentRange(p.inputProcessingPct)
        : null,
      formatted: PFEstimator.formatPercentRange(p.totalReductionPct),
      energy: p.energySavedWh,
      projection: p,
    };
  }

  // ── Model changes reach the assistant through here ────────────────────────
  // One subscription list, fed by the single detector. Components never scrape
  // the page for a model of their own — that is how two parts of one extension
  // end up disagreeing about what is selected.
  const modelSubscribers = new Set();

  function subscribeModel(fn) {
    if (typeof fn !== 'function') return function () {};
    modelSubscribers.add(fn);
    return function () { modelSubscribers.delete(fn); };
  }

  function publishModel(current) {
    modelSubscribers.forEach((fn) => {
      try { fn(current); } catch (e) { log('model subscriber failed:', e && e.message); }
    });
  }

  // ── Robustness watchdog ────────────────────────────────────────────────--
  // SPA frameworks can re-render and remove our injected UI, or navigate to a
  // new conversation. Periodically make sure our overlays exist and react to
  // URL changes — WITHOUT discarding an in-progress capture.
  let lastUrl = location.href;
  function startWatchdog() {
    const wd = setInterval(() => {
      // If the extension was reloaded/updated, stop quietly.
      if (!extAlive()) {
        clearInterval(wd);
        stopResponseWatch();
        if (detector) { detector.destroy(); detector = null; }
        return;
      }
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
          // A new conversation is a new context: attachments, pasted runs, and
          // the breakdown built from them all belong to the chat we just left.
          // ChatGPT and Claude navigate without a reload, so nothing else clears
          // this state.
          if (attachmentTracker) attachmentTracker.reset('navigation');
          if (contextModel) contextModel.reset();
          recomputeDraft('navigation');
          if (assistant && typeof assistant.contextChanged === 'function') assistant.contextChanged();
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

      const now = Date.now();
      const snapshot = takeSendSnapshot(text, now);
      pendingUserMessage = { id: messageId, text, startTime: now, snapshotId: snapshot ? snapshot.id : null };
      updateFloatingStatus('recording');
      startResponseWatch();
    });
  }

  /**
   * Record the model/mode this prompt is being sent with.
   *
   * The prompt text itself is not stored — only a local non-reversible hash and
   * the token count — so the history that lets us attribute a response to the
   * right model never becomes a history of what the user wrote.
   */
  function takeSendSnapshot(text, sentAt) {
    if (!snapshots || typeof PFEstimator === 'undefined') return null;
    // Counted with the detected model's tokenizer, and including whatever was
    // attached: what was sent is what should be recorded.
    const breakdown = observableBreakdown();
    const inputTokens = breakdown ? breakdown.total : countTokens(text);
    const estimate = PFEstimator.estimate(estimateInput({ inputTokens, phase: 'sent' }));
    return snapshots.create({
      conversationKey: observation ? observation.conversationKey : null,
      promptText: text,
      inputTokens,
      observation,
      estimate,
      sentAt,
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
    const snapshotId = pendingUserMessage.snapshotId;
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
    processQuery(prompt, text, responseTimeMs, snapshotId);
  }

  /**
   * The completed-interaction estimate.
   *
   * It is built from the snapshot taken at SEND time, not from the current
   * picker: if the user switched models while the answer was streaming, this
   * response still came from the model that was selected when they hit send.
   */
  function completionEstimate(snapshotId, promptTokens, responseTokens) {
    if (typeof PFEstimator === 'undefined') return null;
    const snap = snapshots && snapshotId ? snapshots.get(snapshotId) : null;
    const obs = (snap && snap.observation) || observation || {};
    const est = PFEstimator.estimate({
      provider: obs.provider || (providerAdapter ? providerAdapter.provider : 'unknown'),
      surface: obs.surface || 'unknown',
      selectedModel: obs.canonicalModel || null,
      effectiveModel: obs.effectiveModel || null,
      modelConfidence: obs.confidence || 0,
      routing: obs.routing || 'unknown',
      reasoning: obs.reasoningMode || 'unknown',
      tools: obs.tools || [],
      inputTokens: promptTokens,
      outputTokens: responseTokens,
      phase: 'complete',
    });
    if (snap && snapshots) snapshots.complete(snap.id, est);
    return est;
  }

  async function processQuery(promptText, responseText, responseTimeMs, snapshotId) {
    const multiplier = config.energyPerTokenMultiplier || 1.0;
    const impact = calculateQueryImpact(promptText, responseText, {
      platform: adapter.id,
      responseTimeMs,
      multiplier,
      // Count with the tokenizer of the model that actually served this turn,
      // not with one generic ratio for every provider.
      countTokens,
    });
    const est = completionEstimate(snapshotId, impact.promptTokens, impact.responseTokens);
    if (est) {
      // The evidence-aware estimate replaces the flat per-token figures. The
      // band, the boundaries, and the evidence class travel with it into
      // storage; the session totals keep using the central value so existing
      // charts stay readable.
      impact.energyWh = est.energyWh.central * multiplier;
      impact.co2G = est.carbon ? est.carbon.central * multiplier : impact.co2G;
      const w = est.water.fullOperational || est.water.cooling || est.water.reported;
      impact.waterMl = w ? w.central * multiplier : impact.waterMl;
      impact.estimate = est;
    }

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
        const est = impact.estimate;
        await PFStorage.addQuery(currentSessionId, {
          platform: adapter.id,
          promptTokens: impact.promptTokens,
          responseTokens: impact.responseTokens,
          totalTokens: impact.totalTokens,
          energyWh: impact.energyWh,
          waterMl: impact.waterMl,
          co2G: impact.co2G,
          responseTimeMs,
          ...(est ? {
            energyWhLow: est.energyWh.low,
            energyWhHigh: est.energyWh.high,
            waterCoolingMl: est.water.cooling ? est.water.cooling.central : null,
            waterFullOperationalMl: est.water.fullOperational ? est.water.fullOperational.central : null,
            waterBoundary: (est.water.fullOperational && est.water.fullOperational.boundary) ||
              (est.water.cooling && est.water.cooling.boundary) || 'undisclosed',
            carbonScope: est.carbon ? est.carbon.scope : null,
            carbonAccounting: est.carbon ? est.carbon.accounting : null,
            evidence: est.evidence,
            confidence: est.confidence,
            selectedModel: est.selectedModel,
            canonicalModel: est.canonicalModel,
            effectiveModel: est.effectiveModel,
            routing: est.routing,
            reasoningMode: est.reasoning,
            tools: est.tools,
            lowerBound: est.lowerBound,
            modelSnapshotId: est.modelSnapshotId,
            estimatorVersion: est.profileId,
          } : {}),
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

        <div class="pf-modal-section pf-modal-model" id="pf-modal-model">
          <div class="pf-modal-section-label">Model &amp; projected impact</div>
          <div class="pf-model-head">
            <span class="pf-model-provider" id="pf-model-provider">—</span>
            <span class="pf-model-badge" id="pf-model-evidence" title="Evidence class"></span>
          </div>
          <div class="pf-model-name" id="pf-model-name">Detecting…</div>
          <div class="pf-model-grid">
            <div class="pf-model-cell"><span class="pf-model-val" id="pf-model-tokens">—</span><span class="pf-model-lbl">Input tokens</span></div>
            <div class="pf-model-cell"><span class="pf-model-val" id="pf-model-energy">—</span><span class="pf-model-lbl" id="pf-model-energy-lbl">Projected interaction range</span></div>
          </div>
          <div class="pf-model-note" id="pf-model-change" hidden></div>
          <button class="pf-model-toggle" id="pf-model-toggle" aria-expanded="false">Details</button>
          <div class="pf-model-details" id="pf-model-details" hidden></div>
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
    const detailsBtn = document.getElementById('pf-model-toggle');
    if (detailsBtn) {
      detailsBtn.addEventListener('click', () => {
        const panel = document.getElementById('pf-model-details');
        if (!panel) return;
        const open = panel.hidden;
        panel.hidden = !open;
        detailsBtn.setAttribute('aria-expanded', String(open));
        detailsBtn.textContent = open ? 'Hide details' : 'Details';
        if (open) renderModelDetails(panel);
      });
    }
    updateModelPanel();
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
    // When the panel becomes visible, refresh the weather-adjusted figure and
    // re-project the prompt currently in the composer against the current model.
    if (!modal.classList.contains('pf-modal-hidden')) {
      refreshWeatherAdjustment();
      recomputeDraft('panel-open');
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

    // A session total is only meaningful under one boundary, so name the one it
    // was summed under. Every query in a session comes from the same provider,
    // which is what makes the sum legitimate in the first place.
    if (lastQueryImpact && lastQueryImpact.estimate) {
      const est = lastQueryImpact.estimate;
      const w = est.water.fullOperational || est.water.cooling || est.water.reported;
      if (waterEl && w) waterEl.title = `Water boundary: ${w.boundary} (${w.scope}). ${PFEnvCopy.WATER_BOUNDARIES}`;
      if (co2El && est.carbon) co2El.title = `Carbon accounting: ${est.carbon.accounting} (${est.carbon.scope}).`;
      if (energyEl) energyEl.title = `Central values only; each query's range is in the model panel. Evidence: ${est.evidence}.`;
    }

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
    updateModelPanel();
  }

  // ── Model panel ───────────────────────────────────────────────────────────
  // Renders what we currently believe about the model and what that implies for
  // the prompt in the composer. Every value it shows is a range with an evidence
  // badge; nothing here is presented as provider telemetry.
  function updateModelPanel() {
    const section = document.getElementById('pf-modal-model');
    if (!section || typeof PFModelPresent === 'undefined') return;
    const summary = PFModelPresent.collapsedSummary(observation, draftEstimate, {
      inputTokens: draftEstimate ? draftEstimate.inputTokens : 0,
      tokensAvoided: lastDraftSavings ? lastDraftSavings.tokensAvoided : null,
    });

    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('pf-model-provider', summary.surface && summary.surface !== summary.provider
      ? `${summary.provider} · ${summary.surface}` : summary.provider);
    set('pf-model-name', summary.model);
    set('pf-model-tokens', summary.inputTokens != null ? String(summary.inputTokens) : '—');
    set('pf-model-energy', summary.energyRange);
    set('pf-model-energy-lbl', summary.energyLabel + (summary.lowerBound ? ' (lower bound)' : ''));

    const badge = document.getElementById('pf-model-evidence');
    if (badge) {
      badge.textContent = summary.evidenceLabel || '—';
      badge.className = `pf-model-badge pf-evidence-${(summary.evidence || 'unknown').toLowerCase()}`;
      badge.title = summary.evidence
        ? `${summary.evidenceLabel}: ${PFEnvCopy.EVIDENCE_EXPLANATION[summary.evidence]} Confidence: ${summary.confidence}.`
        : '';
    }

    const change = document.getElementById('pf-model-change');
    if (change) {
      change.hidden = !lastChangeExplanation;
      change.textContent = lastChangeExplanation || '';
    }

    const details = document.getElementById('pf-model-details');
    if (details && !details.hidden) renderModelDetails(details);
    else if (details) details.dataset.stale = '1';
  }

  function renderModelDetails(container) {
    const rows = PFModelPresent.expandedRows(observation, draftEstimate);
    const esc = PFModelPresent.escapeHtml;
    const disclosures = draftEstimate ? draftEstimate.disclosures : [PFEnvCopy.providerCopy('unknown')];
    container.innerHTML =
      rows.map((r) => (
        `<div class="pf-model-row"><span class="pf-model-row-k">${esc(r.label)}</span>` +
        `<span class="pf-model-row-v">${esc(r.value)}</span>` +
        (r.hint ? `<span class="pf-model-row-h">${esc(r.hint)}</span>` : '') +
        '</div>'
      )).join('') +
      `<div class="pf-model-disclosures">${disclosures.map((d) => `<p>${esc(d)}</p>`).join('')}` +
      `<p>${esc(PFEnvCopy.SAVINGS)}</p></div>`;
    container.dataset.stale = '';
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
      projectSavings: projectSavingsForAssistant,
      // Model detection is owned by the detector and handed to the assistant.
      // The assistant never queries the DOM for a model, which is what keeps one
      // answer on the page and makes a model switch a single event rather than a
      // rescan in every component that cares.
      present: (typeof PFModelPresent !== 'undefined') ? PFModelPresent : null,
      // The token analyzer. The assistant renders its breakdown; it does not
      // own it, so the popup and the panel can never disagree about what the
      // request currently contains.
      context: contextModel,
      getModel: () => observation,
      subscribeModel,
      observedRoots: () => (detector ? detector.observedRoots.length : 0),
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
    // Project what those avoided INPUT tokens are worth against the whole
    // interaction. The engine's own figure is an input-side number; presenting
    // it as a share of total energy without this step would overstate it by an
    // order of magnitude on a short prompt.
    let projection = null;
    if (draftEstimate) {
      const original = draftEstimate.inputTokens;
      projection = projectDraftSavings(original, Math.max(0, original - result.savedTokens));
      updateModelPanel();
    }
    try {
      // The ledger records the PROJECTED reduction, not the token-linear one, so
      // the dashboard's running total cannot inherit the overstatement. Where no
      // projection is available the resource fields are left at zero rather than
      // filled in with a number we do not believe.
      PFStorage.addSavings({
        savedTokens: result.savedTokens || 0,
        savedEnergyWh: projection && projection.energySavedWh ? Math.max(0, projection.energySavedWh.central) : 0,
        savedWaterMl: projection && projection.waterSaved ? Math.max(0, projection.waterSaved.central) : 0,
        savedCo2G: projection && projection.carbonSaved ? Math.max(0, projection.carbonSaved.central) : 0,
      });
      log('Savings recorded:', result.savedTokens, 'tokens');
    } catch (_) {
      // Extension context invalidated — non-fatal.
    }
  }

  // Listen for config changes from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // SECURITY: Only accept messages from our own extension
    if (sender.id !== chrome.runtime.id) return;

    // The popup asks the page what model it is looking at. Only detection
    // metadata crosses this boundary — never composer text.
    if (message.type === 'PF_MODEL_STATE') {
      recomputeDraft('popup');
      sendResponse(currentModelState());
      return true;
    }

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
    if (attachmentTracker) attachmentTracker.destroy();
    // The detector owns observers, listeners, and timers; none of them may
    // outlive the document.
    if (detector) { detector.destroy(); detector = null; }
    if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
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
