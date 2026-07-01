/* global chrome */
// Auth/sync client for the dashboard. It NEVER imports supabase-js and never
// holds tokens — it just messages the background service worker, which owns the
// Supabase session. In the public web build (no chrome) every call is a safe
// no-op so the page still renders.

function hasRuntime() {
  return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.sendMessage;
}

export function isExtensionRuntime() {
  return hasRuntime();
}

function send(type, payload) {
  return new Promise((resolve) => {
    if (!hasRuntime()) { resolve({ error: 'no_runtime' }); return; }
    try {
      chrome.runtime.sendMessage({ type, payload }, (res) => {
        // lastError fires if the worker is asleep/unavailable; degrade quietly.
        if (chrome.runtime.lastError) { resolve({ error: 'unavailable' }); return; }
        resolve(res || {});
      });
    } catch {
      resolve({ error: 'unavailable' });
    }
  });
}

export const authStatus = () => send('AUTH_STATUS');
export const signUp = (email, password) => send('AUTH_SIGNUP', { email, password });
export const login = (email, password) => send('AUTH_LOGIN', { email, password });
export const logout = () => send('AUTH_LOGOUT');
export const deleteAccount = () => send('AUTH_DELETE');
export const syncNow = () => send('SYNC_NOW');
