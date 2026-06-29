// PromptFootprint Background Service Worker
// Local-first: there is no remote backend. The worker manages the anonymous
// user id, maps tabs to sessions so they can be closed on tab removal, and
// opens the dashboard. All persistence goes through lib/storage.js
// (chrome.storage.local).

importScripts('lib/proxyConfig.js', 'lib/storage.js');

// Supported platform origins (must match manifest host_permissions).
const ALLOWED_ORIGINS = [
  'https://chatgpt.com',
  'https://chat.openai.com',
  'https://claude.ai',
];

// Initialize user ID on install
chrome.runtime.onInstalled.addListener(async () => {
  await PFStorage.getUserId(); // creates one if missing
});

// SECURITY: Validate that the sender is our own extension on a supported page.
function isValidSender(sender) {
  if (sender.id !== chrome.runtime.id) return false;
  if (sender.tab) {
    const senderUrl = sender.url || sender.tab.url || '';
    const ok = senderUrl.startsWith('chrome-extension://') ||
               ALLOWED_ORIGINS.some((o) => senderUrl.startsWith(o));
    if (!ok) return false;
  }
  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isValidSender(sender)) {
    console.warn('[PromptFootprint] Rejected message from unauthorized sender:', sender.id);
    sendResponse({ error: 'Unauthorized sender' });
    return false;
  }

  if (message.type === 'GET_USER_ID') {
    PFStorage.getUserId().then((userId) => sendResponse({ userId }));
    return true;
  }

  // Associate the calling tab with its session so we can close it on tab close.
  if (message.type === 'REGISTER_SESSION') {
    const tabId = sender.tab?.id;
    const sessionId = message.payload?.sessionId;
    if (tabId != null && sessionId) {
      chrome.storage.session.set({ [`session_${tabId}`]: sessionId }, () => sendResponse({ ok: true }));
    } else {
      sendResponse({ ok: false });
    }
    return true;
  }

  if (message.type === 'END_SESSION') {
    PFStorage.endSession(message.payload?.sessionId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'OPEN_DASHBOARD') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  // AI prompt optimizer: forward the prompt text to the Gemini proxy Worker.
  // The fetch runs here (service worker), governed by the extension's own CSP,
  // so it is not blocked by the host page's CSP. Returns '' on any failure so
  // the content script can fall back to the local heuristic optimizer.
  if (message.type === 'OPTIMIZE_PROMPT') {
    const text = message.payload?.text;
    if (!PF_PROXY_URL || typeof text !== 'string' || !text.trim()) {
      sendResponse({ rewritten: '' });
      return false;
    }
    fetch(PF_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => sendResponse({ rewritten: (d && d.rewritten) || '' }))
      .catch(() => sendResponse({ rewritten: '' }));
    return true; // async
  }

  sendResponse({ error: 'Unknown message type' });
  return false;
});

// End session when its tab is closed.
chrome.tabs.onRemoved.addListener((tabId) => {
  const key = `session_${tabId}`;
  chrome.storage.session.get([key], (result) => {
    const sessionId = result[key];
    if (sessionId) {
      PFStorage.endSession(sessionId);
      chrome.storage.session.remove([key]);
    }
  });
});
