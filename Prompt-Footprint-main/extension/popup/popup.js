const SUPPORTED_HOSTS = ['chatgpt.com', 'chat.openai.com', 'claude.ai'];

// ── Real-world impact conversions ─────────────────────────────────────────
// These are shown in the popup instead of raw numbers (raw numbers live on the
// stats website). The conversion logic is shared with the in-page modal via
// lib/formatters.js; here we use the two-part { main, sub } form.

function waterConversion(ml) {
  return PFFormat.water(ml);
}

function energyConversion(wh) {
  return PFFormat.energy(wh);
}

function co2Conversion(g) {
  return PFFormat.co2(g);
}

function fmtTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ── Main ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const overlayToggle = document.getElementById('pf-overlay-toggle');
  const writingToggle = document.getElementById('pf-writing-toggle');
  const debugToggle   = document.getElementById('pf-debug-toggle');
  const aiStatusEl    = document.getElementById('pf-ai-status');
  const statsBtn      = document.getElementById('pf-open-stats');
  const settingsLink  = document.getElementById('pf-open-settings');
  const statusDot     = document.querySelector('.pf-status-dot');
  const statusText    = document.querySelector('.pf-status-text');

  const userId = await PFStorage.getUserId();

  // Active-tab status
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isOnSupported = SUPPORTED_HOSTS.some((h) => tab?.url?.includes(h));
  if (isOnSupported) {
    statusDot.classList.add('active');
    statusText.textContent = 'Tracking';
  }

  // Load config (overlay + writing + debug toggle state)
  const cfg = await PFStorage.getConfig();
  overlayToggle.checked = cfg.overlayEnabled !== false;
  if (writingToggle) writingToggle.checked = cfg.writingChecksEnabled !== false;
  if (debugToggle) debugToggle.checked = cfg.debug === true;

  // AI writing status: reflect the real state — cloud is opt-in, and if the
  // service is cooling down after a rate-limit we say so instead of looking on.
  if (aiStatusEl) {
    const provider = (typeof PFProxyConfig !== 'undefined')
      ? PFProxyConfig.resolveWritingProvider(cfg) : 'local';
    if (cfg.cloudAnalysisEnabled === true && provider === 'gemini') {
      aiStatusEl.textContent = 'Cloud on';
      chrome.runtime.sendMessage({ type: 'GET_AI_STATS' }, (resp) => {
        if (chrome.runtime.lastError || !resp) return;
        if (resp.cooling) aiStatusEl.textContent = 'Paused (rate-limited)';
        else if (resp.successRate != null) aiStatusEl.textContent = `Cloud on (${Math.round(resp.successRate * 100)}% ok)`;
      });
    } else {
      aiStatusEl.textContent = 'Local only';
    }
  }

  // Load weekly stats and display as conversions
  const data = await PFStorage.getWeeklyStats(userId);
  const t = data?.totals || {};
  const tokens = t.totalTokens   || 0;
  const water  = t.totalWaterMl  || 0;
  const energy = t.totalEnergyWh || 0;
  const co2    = t.totalCo2G     || 0;

  // Tokens: show count (it's meaningful as a count)
  document.getElementById('pf-tokens').textContent = fmtTokens(tokens);

  // Water: show real-world equivalent
  const w = waterConversion(water);
  document.getElementById('pf-water').textContent    = w.main;
  document.getElementById('pf-water-sub').textContent = w.sub;

  // Energy: show real-world equivalent
  const e = energyConversion(energy);
  document.getElementById('pf-energy').textContent    = e.main;
  document.getElementById('pf-energy-sub').textContent = e.sub;

  // CO₂: show real-world equivalent
  const c = co2Conversion(co2);
  document.getElementById('pf-co2').textContent    = c.main;
  document.getElementById('pf-co2-sub').textContent = c.sub;

  // Personal average prompt size (from this user's own saved queries).
  const avgEl = document.getElementById('pf-avg');
  if (avgEl && typeof PFStorage.computeAveragePromptTokens === 'function' && typeof PFPromptSize !== 'undefined') {
    try {
      const sessions = await PFStorage.getSessions(userId);
      const { avgPromptTokens, sampleCount } = PFStorage.computeAveragePromptTokens(sessions);
      avgEl.textContent = PFPromptSize.averageLabel(avgPromptTokens, sampleCount);
    } catch (_) {
      avgEl.textContent = 'Your average prompt: —';
    }
  }

  // Overlay toggle
  overlayToggle.addEventListener('change', async () => {
    const overlayEnabled = overlayToggle.checked;
    await PFStorage.setConfig({ overlayEnabled });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'CONFIG_UPDATED', config: { overlayEnabled } }).catch(() => {});
    }
  });

  // Debug logging toggle (dev) — logs the full tracking lifecycle to the page
  // console; off by default so normal users see no spam.
  if (debugToggle) {
    debugToggle.addEventListener('change', async () => {
      const debug = debugToggle.checked;
      await PFStorage.setConfig({ debug });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'CONFIG_UPDATED', config: { debug } }).catch(() => {});
      }
    });
  }

  // Writing & spell-check suggestions toggle
  if (writingToggle) {
    writingToggle.addEventListener('change', async () => {
      const writingChecksEnabled = writingToggle.checked;
      await PFStorage.setConfig({ writingChecksEnabled });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'CONFIG_UPDATED', config: { writingChecksEnabled } }).catch(() => {});
      }
    });
  }

  // Full stats + settings/privacy live in the extension's own dashboard.
  statsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  if (settingsLink) {
    settingsLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }
});
