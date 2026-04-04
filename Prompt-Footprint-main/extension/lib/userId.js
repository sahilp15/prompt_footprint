// Anonymous user ID management
// Generates a UUID on first install, stores in chrome.storage.local

const USER_ID_KEY = 'pf_userId';

async function getUserId() {
  return new Promise((resolve) => {
    chrome.storage.local.get([USER_ID_KEY], (result) => {
      if (result[USER_ID_KEY]) {
        resolve(result[USER_ID_KEY]);
      } else {
        const newId = crypto.randomUUID();
        chrome.storage.local.set({ [USER_ID_KEY]: newId }, () => {
          resolve(newId);
        });
      }
    });
  });
}
