# PromptFootprint Gemini Proxy

A tiny Cloudflare Worker that powers the extension's **AI prompt optimizer**
(Gemini Flash). It exists so the Gemini API key can stay **completely secret**:
the key lives only in Cloudflare as a secret, never in this repo and never in
the extension that users download. The extension only ever knows this Worker's
**public URL** (which is not sensitive).

```
extension  ──POST {text}──▶  this Worker  ──key + text──▶  Gemini Flash
extension  ◀──{rewritten}──  this Worker  ◀──rewritten───  Gemini Flash
```

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
- Only token-free prompt text is sent to the Worker; no stored history leaves the
  device.
