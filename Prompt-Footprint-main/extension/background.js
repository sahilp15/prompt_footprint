// PromptFootprint Background Service Worker
// Handles communication between content script and backend API

const API_BASE_URL = 'https://promptfootprint-production.up.railway.app/api';
const USER_ID_KEY = 'pf_userId';

// SECURITY: Allowed API endpoints (whitelist)
const ALLOWED_ENDPOINTS = new Set([
  '/sessions',
  '/queries',
  '/config',
  '/sessions/weekly'
]);

// Initialize user ID on install
chrome.runtime.onInstalled.addListener(async () => {
  const result = await chrome.storage.local.get([USER_ID_KEY]);
  if (!result[USER_ID_KEY]) {
    const userId = crypto.randomUUID();
    await chrome.storage.local.set({ [USER_ID_KEY]: userId });
    console.log('[PromptFootprint] User ID created:', userId);
  }
});

// SECURITY: Validate that the sender is our own extension
function isValidSender(sender) {
  if (sender.id !== chrome.runtime.id) {
    return false;
  }
  // For content script messages, verify the sender URL
  if (sender.tab) {
    const senderUrl = sender.url || sender.tab.url || '';
    if (!senderUrl.startsWith('https://chatgpt.com') &&
        !senderUrl.startsWith('https://chat.openai.com') &&
        !senderUrl.startsWith('chrome-extension://')) {
      return false;
    }
  }
  return true;
}

// SECURITY: Validate that an endpoint is on the allowlist
function isAllowedEndpoint(endpoint) {
  if (!endpoint || typeof endpoint !== 'string') return false;
  // Reject path traversal
  if (endpoint.includes('..') || endpoint.includes('//')) return false;
  // Strip dynamic UUID segments for matching (e.g. /sessions/:id)
  const baseEndpoint = endpoint.replace(/\/[0-9a-f-]{36}$/i, '');
  return ALLOWED_ENDPOINTS.has(baseEndpoint) || ALLOWED_ENDPOINTS.has(endpoint);
}

// Message handler for content script communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // SECURITY: Only accept messages from our own extension
  if (!isValidSender(sender)) {
    console.warn('[PromptFootprint] Rejected message from unauthorized sender:', sender.id);
    sendResponse({ error: 'Unauthorized sender' });
    return false;
  }

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

  // Unknown message type
  sendResponse({ error: 'Unknown message type' });
  return false;
});

async function handleApiRequest({ method, endpoint, body, params }) {
  // SECURITY: Validate endpoint against allowlist
  if (!isAllowedEndpoint(endpoint)) {
    throw new Error(`Disallowed API endpoint: ${endpoint}`);
  }

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
