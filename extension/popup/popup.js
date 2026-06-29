const USER_ID_KEY = 'pf_userId';
const API_BASE = 'https://promptfootprint-production.up.railway.app/api';

// ── Real-world impact conversions ─────────────────────────────────────────
// These are shown in the popup instead of raw numbers.
// Raw numbers live on the stats website.

function waterConversion(ml) {
  if (ml <= 0)   return { main: '0 drops', sub: 'of water' };
  if (ml < 0.05) return { main: '< 1 drop',  sub: 'of water' };
  if (ml < 1.5)  return { main: `≈ ${Math.round(ml * 20)} drops`, sub: 'of water' };
  if (ml < 5)    return { main: `≈ ${(ml / 5).toFixed(1)} tsp`,   sub: 'of water' };
  if (ml < 250)  return { main: `≈ ${Math.round(ml / 250 * 100)}%`, sub: 'of a glass of water' };
  return           { main: `≈ ${(ml / 250).toFixed(1)} glasses`, sub: 'of water' };
}

function energyConversion(wh) {
  if (wh <= 0)   return { main: '< 1 sec', sub: 'of phone use' };
  // Phone uses ~3 W → 1 Wh = 1200 s of phone screen-on time
  const seconds = wh * 1200;
  if (seconds < 2)   return { main: '< 2 sec',  sub: 'of phone screen-on' };
  if (seconds < 60)  return { main: `≈ ${Math.round(seconds)}s`, sub: 'of phone screen-on' };
  if (seconds < 3600) return { main: `≈ ${Math.round(seconds / 60)} min`, sub: 'of phone screen-on' };
  return              { main: `≈ ${(seconds / 3600).toFixed(1)} hrs`, sub: 'of phone screen-on' };
}

function co2Conversion(g) {
  if (g <= 0)    return { main: '< 1 cm', sub: 'driven by car' };
  // Car emits ~200 g/km → 1 g = 5 m driven
  const meters = g * 5;
  if (meters < 1)    return { main: `≈ ${Math.round(meters * 100)} cm`, sub: 'driven by car' };
  if (meters < 1000) return { main: `≈ ${meters.toFixed(1)} m`, sub: 'driven by car' };
  return               { main: `≈ ${(meters / 1000).toFixed(2)} km`, sub: 'driven by car' };
}

function fmtTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ── Main ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const overlayToggle = document.getElementById('pf-overlay-toggle');
  const statsBtn      = document.getElementById('pf-open-stats');
  const statusDot     = document.querySelector('.pf-status-dot');
  const statusText    = document.querySelector('.pf-status-text');

  const stored = await chrome.storage.local.get([USER_ID_KEY]);
  const userId = stored[USER_ID_KEY];

  // Active-tab status
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isOnChatGPT = tab?.url?.includes('chatgpt.com') || tab?.url?.includes('chat.openai.com');
  if (isOnChatGPT) {
    statusDot.classList.add('active');
    statusText.textContent = 'Tracking';
  }

  if (userId) {
    // Load config (overlay toggle state)
    try {
      const cfg = await fetch(`${API_BASE}/config?userId=${userId}`).then(r => r.json());
      overlayToggle.checked = cfg.overlayEnabled !== false;
    } catch (_) {}

    // Load weekly stats and display as conversions
    try {
      const data = await fetch(`${API_BASE}/sessions/weekly?userId=${userId}`).then(r => r.json());
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
    } catch (_) {
      // API unavailable — leave dashes shown
    }
  }

  // Overlay toggle
  overlayToggle.addEventListener('change', () => {
    const overlayEnabled = overlayToggle.checked;
    if (userId) {
      fetch(`${API_BASE}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, overlayEnabled }),
      }).catch(() => {});
    }
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'CONFIG_UPDATED', config: { overlayEnabled } }).catch(() => {});
    }
  });

  // Stats website
  statsBtn.addEventListener('click', () => {
    chrome.tabs.create({
      url: userId
        ? `https://prompt-footprint-2bjl.vercel.app?userId=${userId}`
        : 'https://prompt-footprint-2bjl.vercel.app',
    });
  });
});
