# PromptFootprint Gemini Proxy

A tiny Cloudflare Worker that powers PromptFootprint's optional **AI** tiers
(Gemini Flash):

- the extension's inline **writing assistant** (`shorten` / `improve` modes), and
- the dashboard **Token Cutter**'s enhanced pass (`cutter` mode).

It exists so the Gemini API key can stay **completely secret**: the key lives
only in Cloudflare as a secret, never in this repo, never in the extension that
users download, and never in the web bundle. Clients only ever know this
Worker's **public URL** (which is not sensitive).

Both AI tiers are strictly optional. With no Worker configured, the extension
uses its offline checker and the Token Cutter uses its local pipeline — both
fully functional.

```
client  ──POST {mode, text}──▶  this Worker  ──key + text──▶  Gemini Flash
client  ◀────{result JSON}────  this Worker  ◀────result────  Gemini Flash
```

| `mode` | Used by | Returns | Input cap |
| --- | --- | --- | --- |
| `shorten` (default) | extension optimizer | `{ rewritten }` | 4,000 chars |
| `improve` | extension writing assistant | `{ improved, rewritten }` | 4,000 chars |
| `cutter` | dashboard Token Cutter | `{ cutter }` — a JSON envelope | 12,000 chars |

`cutter` receives a structured instruction (the prompt plus its constraints,
protected strings, and required schema), so its payload is legitimately larger
than the prompt itself — hence the higher cap. The Worker asks Gemini for
`application/json` directly, and the **client validates the response again** on
arrival: shape check, verbatim protected-content check, then the same local
meaning validator used for local suggestions. Anything that fails is discarded
and the local result is kept.

## One-time deploy (~5 minutes, free)

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and
a free [Gemini API key](https://aistudio.google.com/apikey).

```bash
cd proxy
npx wrangler login                 # opens browser, authorize once
npx wrangler secret put GEMINI_API_KEY
#   ^ paste your Gemini key when prompted. It is stored ONLY in Cloudflare,
#     never written to disk or the repo.
npx wrangler deploy
```

`wrangler deploy` prints your Worker URL, e.g.:

```
https://promptfootprint-proxy.<your-subdomain>.workers.dev
```

## Point the extension at it

Put that URL in `extension/lib/proxyConfig.js`:

```js
const PF_PROXY_URL = 'https://promptfootprint-proxy.<your-subdomain>.workers.dev';
```

Reload the extension. The AI optimizer is now live. If `PF_PROXY_URL` is left
empty, the extension automatically falls back to the **local heuristic**
optimizer (still fully offline, no AI).

## Updating or rotating the key

```bash
npx wrangler secret put GEMINI_API_KEY   # overwrites the old secret
```

## Security notes

- The key is a Cloudflare **secret** — it is not in `wrangler.toml`, not in git,
  and not in the deployed bundle's readable source.
- The Worker validates method/shape, caps input/output size, and rate-limits per
  IP (30 req/min, best-effort in-memory). For stronger guarantees you can pin the
  extension id via the manifest `key` field and check the `Origin` header, or move
  the limiter to Cloudflare KV / Durable Objects.
- Only prompt text is sent to the Worker; no stored history, statistics, or
  account data leaves the device.
- Prompt text is a user's own input and is echoed into the model. `cutter` mode
  pins the model with a system instruction that forbids acting on the prompt,
  and every response is re-validated client-side, so a prompt-injection attempt
  can at worst cause the enhanced pass to be rejected and the local result used.
