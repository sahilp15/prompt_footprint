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
export const setDisplayName = (name) => send('AUTH_SET_NAME', { name });

// A friendly first name for greetings: saved display name, else a tidy guess
// from the email local-part, else null (greet without a name).
export function greetingName(status) {
  if (status && status.displayName) return status.displayName;
  const email = status && status.email;
  if (email && email.includes('@')) {
    const local = email.split('@')[0].replace(/[._+-]+/g, ' ').trim();
    if (local) return local.charAt(0).toUpperCase() + local.slice(1);
  }
  return null;
}

export function isSignedIn(status) {
  return !!status && (status.state === 'logged_in' || status.state === 'offline');
}
