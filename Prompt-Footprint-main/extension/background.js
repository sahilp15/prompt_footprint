// PromptFootprint Background Service Worker
// Handles communication between content script and backend API

const API_BASE_URL = 'http://localhost:3001/api';
const USER_ID_KEY = 'pf_userId';

// Initialize user ID on install
chrome.runtime.onInstalled.addListener(async () => {
  const result = await chrome.storage.local.get([USER_ID_KEY]);
  if (!result[USER_ID_KEY]) {
    const userId = crypto.randomUUID();
    await chrome.storage.local.set({ [USER_ID_KEY]: userId });
    console.log('[PromptFootprint] User ID created:', userId);
  }
});

// Message handler for content script communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_USER_ID') {
    chrome.storage.local.get([USER_ID_KEY], (result) => {
      sendResponse({ userId: result[USER_ID_KEY] });
    });
    return true;
  }

  if (message.type === 'API_REQUEST') {
    handleApiRequest(message.payload)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'END_SESSION') {
    handleEndSession(message.payload)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'GET_CONFIG') {
    chrome.storage.local.get([USER_ID_KEY], async (result) => {
      try {
        const resp = await fetch(`${API_BASE_URL}/config?userId=${result[USER_ID_KEY]}`);
        const config = await resp.json();
        sendResponse(config);
      } catch (err) {
        sendResponse({ overlayEnabled: true, energyPerTokenMultiplier: 1.0 });
      }
    });
    return true;
  }
});

async function handleApiRequest({ method, endpoint, body, params }) {
  const url = new URL(`${API_BASE_URL}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const options = {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json' }
  };

  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url.toString(), options);
  return response.json();
}

async function handleEndSession({ sessionId }) {
  return handleApiRequest({
    method: 'PATCH',
    endpoint: `/sessions/${sessionId}`,
    body: { endTime: new Date().toISOString() }
  });
}

// End session when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.get([`session_${tabId}`], (result) => {
    const sessionId = result[`session_${tabId}`];
    if (sessionId) {
      handleEndSession({ sessionId });
      chrome.storage.session.remove([`session_${tabId}`]);
    }
  });
});
