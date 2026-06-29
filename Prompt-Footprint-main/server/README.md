# PromptFootprint Server (Legacy)

> **Status: legacy / optional.** As of the local-first migration, the browser
> extension no longer depends on this backend. All session, query, and config
> data is now stored on-device in `chrome.storage.local` (see
> `extension/lib/storage.js`). This eliminates hosting cost and the previous
> Railway/Vercel reliability problems, and improves privacy — no prompt
> metadata leaves the user's browser.

This Express + Sequelize + PostgreSQL server is kept in the repository for
reference and for anyone who wants an opt-in cross-device sync backend in the
future. It is not built, deployed, or required for the extension to work.

If you do not plan to run a sync backend, you can ignore this directory.
