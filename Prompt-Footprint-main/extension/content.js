// PromptFootprint Content Script
// Injected into ChatGPT pages to observe conversations and estimate environmental impact

(function() {
  'use strict';

  let currentSessionId = null;
  let userId = null;
  let config = { overlayEnabled: true, energyPerTokenMultiplier: 1.0 };
  let processedMessageIds = new Set();
  let pendingUserMessage = null;
  let responseDebounceTimer = null;
  let sessionStats = { totalTokens: 0, totalEnergyWh: 0, totalWaterMl: 0, totalCo2G: 0, queryCount: 0 };
  let lastQueryImpact = null;

  // Initialize
  async function init() {
    // Inject overlay UI immediately — before any async/network calls
    // so the capsule is visible on first page load without delay.
    injectFloatingOverlay();
    injectModalOverlay();

    // Get user ID from background
    const result = await sendMessage({ type: 'GET_USER_ID' });
    userId = result.userId;

    // Get config
    const configResult = await sendMessage({ type: 'GET_CONFIG' });
    if (configResult && !configResult.error) {
      config = { ...config, ...configResult };
      // Sync overlay visibility with saved config
      const overlay = document.getElementById('pf-floating-overlay');
      if (overlay && !config.overlayEnabled) overlay.style.display = 'none';
    }

    // Create session
    const session = await sendMessage({
      type: 'API_REQUEST',
      payload: {
        method: 'POST',
        endpoint: '/sessions',
        body: { userId, startTime: new Date().toISOString() }
      }
    });

    if (session && session.id) {
      currentSessionId = session.id;
      // Store session ID for tab close detection
      chrome.storage.session.set({ [`session_${getTabInfo()}`]: currentSessionId });
    }

    // Start observing DOM
    startObserver();

    console.log('[PromptFootprint] Initialized. Session:', currentSessionId);
  }

  function getTabInfo() {
    return window.location.href;
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (response) => {
        resolve(response || {});
      });
    });
  }

  // DOM Observation
  function startObserver() {
    const observer = new MutationObserver(handleMutations);

    // Observe the main content area - ChatGPT renders conversation in the main element
    const observeTarget = () => {
      const main = document.querySelector('main');
      if (main) {
        observer.observe(main, { childList: true, subtree: true, characterData: true });
        console.log('[PromptFootprint] Observer attached to main');
        return true;
      }
      return false;
    };

    if (!observeTarget()) {
      // Retry until main element appears
      const retryInterval = setInterval(() => {
        if (observeTarget()) clearInterval(retryInterval);
      }, 1000);
    }
  }

  function handleMutations(mutations) {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            checkForMessages(node);
          }
        });
      } else if (mutation.type === 'characterData') {
        // Streaming text is still arriving — reset the debounce timer so we
        // capture the FULL response, not just what arrived in the first 1.5s.
        if (responseDebounceTimer !== null && pendingUserMessage) {
          clearTimeout(responseDebounceTimer);
          responseDebounceTimer = setTimeout(() => {
            const assistantMsgs = document.querySelectorAll('[data-message-author-role="assistant"]');
            const latest = assistantMsgs[assistantMsgs.length - 1];
            if (latest && pendingUserMessage) {
              const msgId = latest.getAttribute('data-message-id');
              const text = extractText(latest);
              if (text) {
                if (msgId) processedMessageIds.add(msgId);
                processQuery(pendingUserMessage.text, text);
                pendingUserMessage = null;
              }
            }
            responseDebounceTimer = null;
          }, 1500);
        }
      }
    }
  }

  function checkForMessages(node) {
    // ChatGPT uses data-message-id and data-message-author-role attributes
    const messageElements = node.querySelectorAll
      ? [node, ...node.querySelectorAll('[data-message-id]')]
      : [node];

    messageElements.forEach(el => {
      const messageId = el.getAttribute?.('data-message-id');
      const authorRole = el.getAttribute?.('data-message-author-role');

      if (!messageId || processedMessageIds.has(messageId)) return;

      if (authorRole === 'user') {
        const text = extractText(el);
        if (text) {
          pendingUserMessage = { id: messageId, text };
          processedMessageIds.add(messageId);
          updateFloatingStatus('recording');
        }
      } else if (authorRole === 'assistant') {
        // Debounce: wait for streaming to complete
        clearTimeout(responseDebounceTimer);
        responseDebounceTimer = setTimeout(() => {
          const text = extractText(el);
          if (text && pendingUserMessage) {
            processedMessageIds.add(messageId);
            processQuery(pendingUserMessage.text, text);
            pendingUserMessage = null;
          }
          responseDebounceTimer = null;
        }, 1500);
      }
    });

    // Also try broader selectors as fallback
    if (!node.getAttribute?.('data-message-id')) {
      tryAlternativeSelectors(node);
    }
  }

  function tryAlternativeSelectors(node) {
    // Fallback: look for turn-based conversation structure
    const turns = node.querySelectorAll?.('[class*="agent-turn"], [class*="user-turn"], [data-testid*="conversation-turn"]') || [];
    turns.forEach(turn => {
      const id = turn.getAttribute('data-testid') || turn.className;
      if (processedMessageIds.has(id)) return;

      const isUser = turn.querySelector('[data-message-author-role="user"]') ||
                     turn.classList?.contains('user-turn') ||
                     turn.getAttribute('data-testid')?.includes('user');
      const isAssistant = turn.querySelector('[data-message-author-role="assistant"]') ||
                          turn.classList?.contains('agent-turn') ||
                          turn.getAttribute('data-testid')?.includes('assistant');

      if (isUser) {
        const text = extractText(turn);
        if (text) {
          pendingUserMessage = { id, text };
          processedMessageIds.add(id);
        }
      } else if (isAssistant && pendingUserMessage) {
        clearTimeout(responseDebounceTimer);
        responseDebounceTimer = setTimeout(() => {
          const text = extractText(turn);
          if (text) {
            processedMessageIds.add(id);
            processQuery(pendingUserMessage.text, text);
            pendingUserMessage = null;
          }
          responseDebounceTimer = null;
        }, 1500);
      }
    });
  }

  function extractText(element) {
    // Get text content, excluding script/style tags
    const clone = element.cloneNode(true);
    clone.querySelectorAll('script, style, button, svg').forEach(el => el.remove());
    return clone.textContent?.trim() || '';
  }

  async function processQuery(promptText, responseText) {
    const multiplier = config.energyPerTokenMultiplier || 1.0;
    const impact = calculateQueryImpact(promptText, responseText, multiplier);

    lastQueryImpact = impact;
    sessionStats.totalTokens += impact.totalTokens;
    sessionStats.totalEnergyWh += impact.energyWh;
    sessionStats.totalWaterMl += impact.waterMl;
    sessionStats.totalCo2G += impact.co2G;
    sessionStats.queryCount += 1;

    // Send to backend
    if (currentSessionId) {
      sendMessage({
        type: 'API_REQUEST',
        payload: {
          method: 'POST',
          endpoint: '/queries',
          body: {
            sessionId: currentSessionId,
            promptTokens: impact.promptTokens,
            responseTokens: impact.responseTokens,
            totalTokens: impact.totalTokens,
            energyWh: impact.energyWh,
            waterMl: impact.waterMl,
            co2G: impact.co2G
          }
        }
      });
    }

    updateFloatingStatus('saved');
    updateModalStats();
    console.log('[PromptFootprint] Query logged:', impact);
  }

  // Floating Overlay
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

  // Modal Overlay
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
      const statsUrl = `https://prompt-footprint-2bjl.vercel.app?userId=${userId}`;
      window.open(statsUrl, '_blank');
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

  // Listen for config changes from popup
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'CONFIG_UPDATED') {
      config = { ...config, ...message.config };
      const overlay = document.getElementById('pf-floating-overlay');
      if (overlay) {
        overlay.style.display = config.overlayEnabled ? 'block' : 'none';
      }
    }
  });

  // End session on page unload
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
