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
  const levelSelect   = document.getElementById('pf-level-select');
  const autoToggle    = document.getElementById('pf-auto-toggle');
  const impactToggle  = document.getElementById('pf-impact-toggle');
  const motionToggle  = document.getElementById('pf-motion-toggle');
  const resetLink     = document.getElementById('pf-reset-assistant');
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

  // Personalized greeting: signed-in name (or email guess) from the background,
  // else a locally saved name. Hidden when we have nothing to show.
  (async () => {
    const greetEl = document.getElementById('pf-greeting');
    const nameEl = document.getElementById('pf-greeting-name');
    if (!greetEl || !nameEl) return;
    function guessFromEmail(email) {
      if (!email || !email.includes('@')) return null;
      const local = email.split('@')[0].replace(/[._+-]+/g, ' ').trim();
      return local ? local.charAt(0).toUpperCase() + local.slice(1) : null;
    }
    let name = null;
    try {
      const s = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'AUTH_STATUS' }, (r) => {
          if (chrome.runtime.lastError) resolve(null); else resolve(r);
        });
      });
      if (s && (s.state === 'logged_in' || s.state === 'offline')) {
        name = s.displayName || guessFromEmail(s.email);
      }
    } catch (_) { /* ignore */ }
    if (!name && typeof cfg.displayName === 'string' && cfg.displayName.trim()) name = cfg.displayName.trim();
    if (name) { nameEl.textContent = name; greetEl.hidden = false; }
  })();
  overlayToggle.checked = cfg.overlayEnabled !== false;
  if (debugToggle) debugToggle.checked = cfg.debug === true;

  // In-page assistant preferences, read through the same helper the content
  // script uses so the popup can never disagree with what the assistant does.
  const assistant = PFAssistantState.readSettings(cfg);
  if (writingToggle) writingToggle.checked = assistant.enabled;
  if (levelSelect)   levelSelect.value     = assistant.level;
  if (autoToggle)    autoToggle.checked    = assistant.autoAnalyze;
  if (impactToggle)  impactToggle.checked  = assistant.showImpact;
  if (motionToggle)  motionToggle.checked  = assistant.animations;

  // Optimization mode: local is the default and needs nothing configured.
  // Enhanced is only real when cloud analysis is on AND a provider is resolved,
  // and we say so plainly rather than implying the cloud is involved when it is not.
  if (aiStatusEl) {
    const provider = (typeof PFProxyConfig !== 'undefined')
      ? PFProxyConfig.resolveWritingProvider(cfg) : 'local';
    if (assistant.mode === 'enhanced' && provider === 'gemini') {
      aiStatusEl.textContent = 'Enhanced (API)';
      chrome.runtime.sendMessage({ type: 'GET_AI_STATS' }, (resp) => {
        if (chrome.runtime.lastError || !resp) return;
        if (resp.cooling) aiStatusEl.textContent = 'Enhanced — paused (rate-limited)';
        else if (resp.successRate != null) aiStatusEl.textContent = `Enhanced (${Math.round(resp.successRate * 100)}% ok)`;
      });
    } else {
      aiStatusEl.textContent = 'Processed locally';
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

  // ── In-page assistant preferences ───────────────────────────────────────
  // Every one of these writes through PFStorage.setConfig (which validates) and
  // then tells the open tab to re-read its config — the same CONFIG_UPDATED path
  // the overlay toggle has always used, rather than a second settings channel.
  async function saveAssistant(partial) {
    const patch = PFAssistantState.settingsPatch(partial);
    await PFStorage.setConfig(patch);
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'CONFIG_UPDATED', config: patch }).catch(() => {});
    }
  }

  if (writingToggle) {
    writingToggle.addEventListener('change', () => saveAssistant({ enabled: writingToggle.checked }));
  }
  if (levelSelect) {
    levelSelect.addEventListener('change', () => saveAssistant({ level: levelSelect.value }));
  }
  if (autoToggle) {
    autoToggle.addEventListener('change', () => saveAssistant({ autoAnalyze: autoToggle.checked }));
  }
  if (impactToggle) {
    impactToggle.addEventListener('change', () => saveAssistant({ showImpact: impactToggle.checked }));
  }
  if (motionToggle) {
    motionToggle.addEventListener('change', () => saveAssistant({ animations: motionToggle.checked }));
  }

  // Reset: assistant preferences back to defaults and any saved panel position
  // cleared. Tracking data and account settings are untouched.
  if (resetLink) {
    resetLink.addEventListener('click', async (e) => {
      e.preventDefault();
      const patch = PFAssistantState.resetPatch();
      await PFStorage.setConfig(patch);
      // Also drops layout the previous suggestion chip saved; the assistant
      // anchors itself to the composer and never restores a stored position.
      await new Promise((resolve) => chrome.storage.local.remove(
        ['pf_assistant_pos', 'pf_optimizer_pos', 'pf_optimizer_size'], resolve));
      const next = PFAssistantState.readSettings(patch);
      if (writingToggle) writingToggle.checked = next.enabled;
      if (levelSelect)   levelSelect.value     = next.level;
      if (autoToggle)    autoToggle.checked    = next.autoAnalyze;
      if (impactToggle)  impactToggle.checked  = next.showImpact;
      if (motionToggle)  motionToggle.checked  = next.animations;
      resetLink.textContent = 'preferences reset';
      setTimeout(() => { resetLink.textContent = 'reset assistant preferences'; }, 1800);
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'CONFIG_UPDATED', config: patch }).catch(() => {});
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
