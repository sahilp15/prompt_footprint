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
  const debugToggle   = document.getElementById('pf-debug-toggle');
  const statsBtn      = document.getElementById('pf-open-stats');
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

  // Load config (overlay + debug toggle state)
  const cfg = await PFStorage.getConfig();
  overlayToggle.checked = cfg.overlayEnabled !== false;
  if (debugToggle) debugToggle.checked = cfg.debug === true;

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

  // Full stats live in the extension's own dashboard (local-first).
  statsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
});
