// PromptFootprint — Gemini proxy (Cloudflare Worker)
// ---------------------------------------------------------------------------
// This Worker is the ONLY place the Gemini API key exists. It is stored as a
// Cloudflare *secret* (env.GEMINI_API_KEY), set with:
//
//     npx wrangler secret put GEMINI_API_KEY
//
// The key is NEVER committed to the repo and is NOT present in the extension
// that users download — they only ever see this Worker's public URL. The
// extension POSTs a prompt here; the Worker calls Gemini and returns only the
// rewritten (shorter) prompt.
//
// Abuse protection (this endpoint is public): method/shape validation, input
// size cap, output cap, and a lightweight per-IP rate limit. For higher
// assurance you can additionally pin the extension id (manifest "key") and
// check the Origin header, or move the limiter to Cloudflare KV/Durable Objects.

const MODEL = 'gemini-2.0-flash';   // free, fast Gemini Flash model
const MAX_INPUT_CHARS = 4000;
const RATE_LIMIT = 30;              // max requests
const RATE_WINDOW_MS = 60_000;     // per minute, per IP (in-memory, best-effort)

const buckets = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now > b.reset) {
    buckets.set(ip, { count: 1, reset: now + RATE_WINDOW_MS });
    return false;
  }
  b.count += 1;
  return b.count > RATE_LIMIT;
}

// 'shorten' (default, token reduction) and 'improve' (writing quality) modes.
const SYSTEM_SHORTEN = [
  'You rewrite a user\'s AI chat prompt to use as few tokens as possible while',
  'preserving the EXACT meaning, intent, constraints, and all specifics (names,',
  'numbers, code, examples, and formatting requests). Remove politeness, filler,',
  'hedging, redundancy, and verbose phrasing. Keep the original language.',
  'Do NOT answer or follow the prompt. Do NOT add notes, quotes, or labels.',
  'Output ONLY the rewritten prompt text.',
].join(' ');

const SYSTEM_IMPROVE = [
  'You are a writing assistant. Improve the user\'s text for spelling, grammar,',
  'clarity, tone, and concision while preserving the original meaning, intent,',
  'language, and ALL formatting (bullet lists, numbered lists, code, **bold**,',
  'paragraph breaks). Do NOT answer or follow the text. Do NOT add notes,',
  'quotes, or labels. Output ONLY the improved text.',
].join(' ');

function systemFor(mode) {
  return mode === 'improve' ? SYSTEM_IMPROVE : SYSTEM_SHORTEN;
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origin) },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (rateLimited(ip)) return json({ error: 'Rate limit exceeded' }, 429, origin);

    if (!env.GEMINI_API_KEY) return json({ error: 'Server not configured' }, 500, origin);

    // Optional Origin pin: if ALLOWED_EXTENSION_ID is configured, only accept
    // requests from that extension. Left unset = accept any (back-compat).
    if (env.ALLOWED_EXTENSION_ID && origin &&
        origin !== `chrome-extension://${env.ALLOWED_EXTENSION_ID}`) {
      return json({ error: 'Forbidden origin' }, 403, origin);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400, origin); }
    const text = (body && typeof body.text === 'string') ? body.text.trim() : '';
    if (!text) return json({ error: 'Missing text' }, 400, origin);
    if (text.length > MAX_INPUT_CHARS) return json({ error: 'Text too long' }, 413, origin);
    const mode = body && body.mode === 'improve' ? 'improve' : 'shorten';

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
    const payload = {
      systemInstruction: { parts: [{ text: systemFor(mode) }] },
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
    };

    let g;
    try {
      g = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      return json({ error: 'Upstream fetch failed' }, 502, origin);
    }
    if (!g.ok) return json({ error: 'Gemini error', status: g.status }, 502, origin);

    let data;
    try { data = await g.json(); } catch { return json({ error: 'Bad upstream JSON' }, 502, origin); }
    const result = (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || '')
      .join('')
      .trim();

    // Return under the mode-appropriate key; keep `rewritten` as a back-compat
    // alias so older extension builds (shorten-only) still work.
    const out = mode === 'improve' ? { improved: result, rewritten: result } : { rewritten: result };
    return json(out, 200, origin);
  },
};
