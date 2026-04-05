const USER_ID_KEY = 'pf_userId';
const API_BASE_URL = 'https://promptfootprint-production.up.railway.app/api';

// ── Real-life impact conversions ──────────────────────────────────────────
function waterConversion(ml) {
  if (ml <= 0) return '';
  if (ml < 0.05) return '< 1 eye drop';
  if (ml < 2)    return `≈ ${Math.round(ml * 20)} eye drops`;
  if (ml < 15)   return `≈ ${(ml / 5).toFixed(1)} tsp`;
  if (ml < 250)  return `≈ ${Math.round(ml / 250 * 100)}% of a glass`;
  return `≈ ${(ml / 250).toFixed(1)} glasses`;
}

function energyConversion(wh) {
  if (wh <= 0) return '';
  // Phone uses ~3 W average → 1 Wh = 1200 s of phone use
  const seconds = wh * 1200;
  if (seconds < 1)  return '< 1s of phone use';
  if (seconds < 60) return `≈ ${Math.round(seconds)}s of phone use`;
  if (seconds < 3600) return `≈ ${Math.round(seconds / 60)}min phone use`;
  return `≈ ${(seconds / 3600).toFixed(1)}h phone use`;
}

function co2Conversion(g) {
  if (g <= 0) return '';
  // Car emits ~200 g/km → 1 g CO₂ = 5 m driven
  const meters = g * 5;
  if (meters < 0.5)  return `≈ ${Math.round(meters * 100)}cm by car`;
  if (meters < 1000) return `≈ ${meters.toFixed(1)}m by car`;
  return `≈ ${(meters / 1000).toFixed(2)}km by car`;
}

function fmtTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtWater(ml) {
  if (ml < 1)    return `${ml.toFixed(2)} mL`;
  if (ml < 100)  return `${ml.toFixed(1)} mL`;
  return `${ml.toFixed(0)} mL`;
}

function fmtEnergy(wh) {
  if (wh < 0.01)  return `${(wh * 1000).toFixed(2)} mWh`;
  if (wh < 1)     return `${wh.toFixed(3)} Wh`;
  return `${wh.toFixed(2)} Wh`;
}

function fmtCO2(g) {
  if (g < 0.01)  return `${(g * 1000).toFixed(1)} mg`;
  if (g < 1)     return `${g.toFixed(3)} g`;
  return `${g.toFixed(2)} g`;
}

// ── Main ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const overlayToggle = document.getElementById('pf-overlay-toggle');
  const statsBtn      = document.getElementById('pf-open-stats');
  const statusDot     = document.querySelector('.pf-status-dot');
  const statusText    = document.querySelector('.pf-status-text');

  // Get userId
  const stored = await chrome.storage.local.get([USER_ID_KEY]);
  const userId = stored[USER_ID_KEY];

  // Check if active on ChatGPT
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isOnChatGPT = tab?.url?.includes('chatgpt.com') || tab?.url?.includes('chat.openai.com');
  if (isOnChatGPT) {
    statusDot.classList.add('active');
    statusText.textContent = 'Tracking';
  }

  if (userId) {
    // Load config
    try {
      const cfg = await fetch(`${API_BASE_URL}/config?userId=${userId}`).then(r => r.json());
      overlayToggle.checked = cfg.overlayEnabled !== false;
    } catch (_) {}

    // Load weekly stats
    try {
      const data = await fetch(`${API_BASE_URL}/sessions/weekly?userId=${userId}`).then(r => r.json());
      const t = data?.totals || {};
      const tokens  = t.totalTokens    || 0;
      const water   = t.totalWaterMl   || 0;
      const energy  = t.totalEnergyWh  || 0;
      const co2     = t.totalCo2G      || 0;

      document.getElementById('pf-tokens').textContent   = fmtTokens(tokens);
      document.getElementById('pf-water').textContent    = fmtWater(water);
      document.getElementById('pf-energy').textContent   = fmtEnergy(energy);
      document.getElementById('pf-co2').textContent      = fmtCO2(co2);

      const tokensCtx = document.getElementById('pf-tokens-ctx');
      const sessions  = data?.daily?.length || 0;
      if (sessions)  tokensCtx.textContent = `${sessions} day${sessions !== 1 ? 's' : ''} tracked`;

      document.getElementById('pf-water-ctx').textContent  = waterConversion(water);
      document.getElementById('pf-energy-ctx').textContent = energyConversion(energy);
      document.getElementById('pf-co2-ctx').textContent    = co2Conversion(co2);
    } catch (_) {
      // API unavailable — leave dashes
    }
  }

  // Overlay toggle
  overlayToggle.addEventListener('change', () => {
    const overlayEnabled = overlayToggle.checked;
    if (userId) {
      fetch(`${API_BASE_URL}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, overlayEnabled }),
      }).catch(() => {});
    }
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'CONFIG_UPDATED', config: { overlayEnabled } }).catch(() => {});
    }
  });

  // Stats website button
  statsBtn.addEventListener('click', () => {
    const url = userId
      ? `https://prompt-footprint-2bjl.vercel.app?userId=${userId}`
      : 'https://prompt-footprint-2bjl.vercel.app';
    chrome.tabs.create({ url });
  });
});
