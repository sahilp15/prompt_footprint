const USER_ID_KEY = 'pf_userId';
const API_BASE_URL = 'https://promptfootprint-production.up.railway.app/api';

document.addEventListener('DOMContentLoaded', async () => {
  const overlayToggle = document.getElementById('pf-overlay-toggle');
  const multiplierSlider = document.getElementById('pf-multiplier');
  const multiplierDisplay = document.getElementById('pf-multiplier-display');
  const dashboardBtn = document.getElementById('pf-open-dashboard');
  const statsBtn = document.getElementById('pf-open-stats');
  const statusDot = document.querySelector('.pf-status-dot');
  const statusText = document.querySelector('.pf-status-text');

  // Get user ID
  const result = await chrome.storage.local.get([USER_ID_KEY]);
  const userId = result[USER_ID_KEY];

  // Check if on ChatGPT
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isOnChatGPT = tab?.url?.includes('chatgpt.com') || tab?.url?.includes('chat.openai.com');

  if (isOnChatGPT) {
    statusDot.classList.add('active');
    statusText.textContent = 'Tracking';
    statusText.style.color = '#34D399';
  }

  // Load config from backend
  if (userId) {
    try {
      const resp = await fetch(`${API_BASE_URL}/config?userId=${userId}`);
      const config = await resp.json();
      overlayToggle.checked = config.overlayEnabled !== false;
      if (config.energyPerTokenMultiplier) {
        multiplierSlider.value = config.energyPerTokenMultiplier;
        multiplierDisplay.textContent = `${config.energyPerTokenMultiplier}x`;
      }
    } catch (e) {
      // Use defaults
    }
  }

  // Toggle overlay
  overlayToggle.addEventListener('change', async () => {
    const overlayEnabled = overlayToggle.checked;
    if (userId) {
      fetch(`${API_BASE_URL}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, overlayEnabled })
      }).catch(() => {});
    }

    // Notify content script
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'CONFIG_UPDATED',
        config: { overlayEnabled }
      }).catch(() => {});
    }
  });

  // Multiplier slider
  multiplierSlider.addEventListener('input', () => {
    const val = parseFloat(multiplierSlider.value);
    multiplierDisplay.textContent = `${val.toFixed(1)}x`;
  });

  multiplierSlider.addEventListener('change', async () => {
    const energyPerTokenMultiplier = parseFloat(multiplierSlider.value);
    if (userId) {
      fetch(`${API_BASE_URL}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, energyPerTokenMultiplier })
      }).catch(() => {});
    }

    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'CONFIG_UPDATED',
        config: { energyPerTokenMultiplier }
      }).catch(() => {});
    }
  });

  // Dashboard button
  dashboardBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Stats website button
  statsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: `https://prompt-footprint-2bjl.vercel.app?userId=${userId}` });
  });
});
