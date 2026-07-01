# PromptFootprint — Deleting Your Data

_Last updated: 2026-07-01_

PromptFootprint is local-first, so most "your data" lives in your own browser and
is under your control. If you created an optional account, there is also a small
amount of synced data on the server. Here is how to remove each.

## 1. Delete local data (no account needed)

Your on-device data is stored in `chrome.storage.local`: token/impact metrics,
settings, realized savings, an anonymous install ID, and overlay positions. It
never includes your prompt or reply text.

You can remove it in any of these ways:

- **Uninstall the extension.** Right-click the toolbar icon → Remove, or go to
  `chrome://extensions` and remove PromptFootprint. This deletes all of its local
  data.
- **Clear its storage without uninstalling.** `chrome://extensions` → PromptFootprint
  → Details → "Site data" / storage → clear.

## 2. Delete your account and synced data (if you signed in)

If you created an account, the server holds only: your email (for login), your
non-sensitive settings, per-session **summaries** (numbers, no text), and per-day
savings totals.

- **From the extension:** open the dashboard → Account → **Delete account**. This
  permanently removes your account and all synced rows.
- **By email:** if you can't sign in, email us from the address on the account and
  ask for deletion. Contact details below. We aim to complete deletion requests
  promptly.

Deleting your account does **not** touch your local data — clear that separately
using §1 if you also want it gone from the device.

## 3. What is never stored (so there's nothing to delete)

- The text of your prompts or the models' replies — never stored, never uploaded.
- Draft text sent for optional AI writing help — used to generate a suggestion and
  not retained by PromptFootprint.

## 4. Contact

- Issues: <https://github.com/sahilp15/prompt_footprint/issues>
- Email (placeholder — replace before publishing): `support@promptfootprint.app`
