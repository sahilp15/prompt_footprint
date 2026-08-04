// Optional enhancement — Gemini, via the project's existing Worker proxy.
// ---------------------------------------------------------------------------
// This is an *enhancement*, never a dependency. Local processing is the default
// and produces a complete result on its own; this path runs only when the user
// switches to "Enhanced AI processing" and a proxy is configured.
//
// Security: the Gemini key lives in exactly one place — a Cloudflare Worker
// secret (`proxy/worker.js`, set with `wrangler secret put GEMINI_API_KEY`).
// The browser only ever knows the Worker's public URL. There is no code path
// here that reads, stores, or transmits an API key.
//
// Trust: the response is untrusted input. It is shape-checked, sanitized, and
// then *re-validated locally* against the original prompt — a remote rewrite
// that drops a constraint is rejected exactly like a local one would be. The
// model's own `meaningScore` is displayed as its opinion, never as our finding.

import type {
  Constraint, EnhancementReport, EnhancementResponse, Entity, ValidationReport,
} from './types.ts'
import { validateMeaning } from './validate.ts'

/** Hard ceiling matching the Worker's own `MAX_INPUT_CHARS`. */
export const MAX_ENHANCE_CHARS = 4000

const REQUEST_TIMEOUT_MS = 12_000

export interface EnhanceInput {
  text: string
  proxyUrl: string
  level: 'light' | 'balanced' | 'maximum'
  /** Verbatim strings the model must not alter. */
  protectedContent: string[]
  constraints: Constraint[]
  entities: Entity[]
  signal?: AbortSignal
}

export interface EnhanceOutcome {
  optimized: string | null
  report: EnhancementReport
  validation: ValidationReport | null
}

/** A stable failure result, so callers never have to handle a thrown error. */
function failed(status: string, reason: string): EnhanceOutcome {
  return {
    optimized: null,
    report: { applied: false, status, fallbackReason: reason },
    validation: null,
  }
}

/**
 * The instruction sent alongside the prompt.
 *
 * Deliberately structured: asking a model to "shorten this" produces a
 * paraphrase that quietly drops requirements. Naming the constraints, listing
 * the protected strings, and demanding a JSON envelope makes the result
 * checkable — and the checking is what earns the user's trust, not the model.
 */
export function buildEnhancementInstruction(input: Omit<EnhanceInput, 'proxyUrl' | 'signal'>): string {
  const aggressiveness = {
    light: 'Fix only grammar, spelling, and obvious filler. Preserve the author’s voice and sentence structure.',
    balanced: 'Reduce token count substantially while preserving tone, context, and every requirement.',
    maximum: 'Reduce as aggressively as possible while keeping every essential instruction and piece of information.',
  }[input.level]

  const constraintList = [...new Set(input.constraints.map((c) => c.text.trim()))].slice(0, 30)
  const protectedList = [...new Set(input.protectedContent.map((p) => p.trim()))]
    .filter((p) => p.length > 1)
    .slice(0, 40)
  const entityList = [...new Set(
    input.entities
      .filter((e) => e.kind !== 'proper-noun' || e.text.length > 2)
      .map((e) => e.text.trim()),
  )].slice(0, 40)

  return [
    'You are optimizing an AI prompt for token efficiency. You are NOT answering it.',
    '',
    `Aggressiveness: ${aggressiveness}`,
    '',
    'Absolute rules:',
    '1. Never change the meaning, the intent, or any requirement.',
    '2. Reproduce every string in PROTECTED verbatim, character for character.',
    '3. Keep every item in CONSTRAINTS expressed in the output, in any wording.',
    '4. Keep every item in ENTITIES present in the output.',
    '5. Never remove a negation ("not", "never", "without", "avoid", "except").',
    '6. Never invent requirements, examples, or details that are not in the input.',
    '7. Keep the original language.',
    '',
    protectedList.length ? `PROTECTED:\n${protectedList.map((p) => `- ${p}`).join('\n')}` : 'PROTECTED: (none)',
    '',
    constraintList.length ? `CONSTRAINTS:\n${constraintList.map((c) => `- ${c}`).join('\n')}` : 'CONSTRAINTS: (none)',
    '',
    entityList.length ? `ENTITIES:\n${entityList.map((e) => `- ${e}`).join('\n')}` : 'ENTITIES: (none)',
    '',
    'Reply with a single JSON object and nothing else. No prose, no code fence.',
    'Schema:',
    '{',
    '  "optimized": string,               // the rewritten prompt',
    '  "preservedConstraints": string[],  // each CONSTRAINT you kept',
    '  "removedRedundancies": string[],   // what you removed and why, one short phrase each',
    '  "uncertainChanges": string[],      // changes you are less than confident about',
    '  "protectedContent": string[],      // each PROTECTED string you reproduced',
    '  "meaningScore": number             // 0-1, your own estimate that meaning is unchanged',
    '}',
    '',
    'PROMPT TO OPTIMIZE:',
    input.text,
  ].join('\n')
}

/**
 * Pull a JSON object out of a model response.
 *
 * Models wrap JSON in fences and prose even when told not to, so this looks for
 * the outermost balanced object rather than trusting the whole body to parse.
 */
export function extractJsonObject(raw: string): unknown {
  if (typeof raw !== 'string') return null
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')

  try {
    return JSON.parse(text)
  } catch {
    // fall through to brace scanning
  }

  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const c = text[i]
    if (escaped) { escaped = false; continue }
    if (c === '\\') { escaped = true; continue }
    if (c === '"') { inString = !inString; continue }
    if (inString) continue
    if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)) } catch { return null }
      }
    }
  }
  return null
}

function asStringArray(value: unknown, limit = 40): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, limit)
}

/**
 * Validate and sanitize the parsed response.
 *
 * Returns null when the shape is wrong — a malformed response is treated as an
 * outage, not as something to partially trust.
 */
export function parseEnhancementResponse(parsed: unknown): EnhancementResponse | null {
  if (!parsed || typeof parsed !== 'object') return null
  const o = parsed as Record<string, unknown>

  const optimized = typeof o.optimized === 'string' ? o.optimized.trim() : ''
  if (!optimized) return null

  const score = Number(o.meaningScore)

  return {
    optimized,
    preservedConstraints: asStringArray(o.preservedConstraints),
    removedRedundancies: asStringArray(o.removedRedundancies),
    uncertainChanges: asStringArray(o.uncertainChanges),
    protectedContent: asStringArray(o.protectedContent),
    meaningScore: Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0,
  }
}

/**
 * Run the enhanced pass. Never throws.
 *
 * The remote result is only returned when it survives the SAME local validator
 * the local pipeline uses. If it drops a constraint, mangles a protected
 * string, or the request fails for any reason, the caller keeps its local
 * result and the report explains why.
 */
export async function enhanceWithGemini(input: EnhanceInput): Promise<EnhanceOutcome> {
  const { text, proxyUrl, protectedContent, constraints, entities, signal } = input

  if (!/^https:\/\/\S+$/i.test(proxyUrl.trim())) {
    return failed('Not configured', 'No Worker URL is set, so the local result was used.')
  }
  if (!text.trim()) {
    return failed('Nothing to send', 'The prompt is empty.')
  }
  if (text.length > MAX_ENHANCE_CHARS) {
    return failed(
      'Prompt too long for enhanced mode',
      `Enhanced processing accepts up to ${MAX_ENHANCE_CHARS.toLocaleString()} characters. The local result was used instead.`,
    )
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const onAbort = (): void => controller.abort()
  signal?.addEventListener('abort', onAbort)

  let response: Response
  try {
    response = await fetch(proxyUrl.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'cutter', text: buildEnhancementInstruction(input) }),
      signal: controller.signal,
    })
  } catch (err) {
    return failed(
      'Service unavailable',
      controller.signal.aborted
        ? 'The request timed out. The local result was used.'
        : `The proxy could not be reached (${errMessage(err)}). The local result was used.`,
    )
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }

  if (response.status === 429) {
    return failed('Rate limited', 'The proxy is rate-limited right now. The local result was used.')
  }
  if (!response.ok) {
    return failed(`Service error (${response.status})`, 'The proxy returned an error. The local result was used.')
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return failed('Invalid response', 'The proxy returned something that is not JSON. The local result was used.')
  }

  // The Worker wraps the model output; accept either the cutter key or the
  // legacy `rewritten` alias so an older deployment still works.
  const envelope = body as Record<string, unknown> | null
  const payload = envelope?.cutter ?? envelope?.rewritten ?? envelope?.improved ?? envelope
  const parsed = parseEnhancementResponse(
    typeof payload === 'string' ? extractJsonObject(payload) : payload,
  )
  if (!parsed) {
    return failed('Invalid response', 'The response did not match the expected format. The local result was used.')
  }

  // Protected strings must come back byte-identical.
  const mangled = protectedContent
    .map((p) => p.trim())
    .filter((p) => p.length > 1 && !parsed.optimized.includes(p))
  if (mangled.length) {
    return failed(
      'Rejected — protected content changed',
      `The rewrite altered ${mangled.length} protected item${mangled.length === 1 ? '' : 's'} (for example “${truncate(mangled[0])}”). The local result was used.`,
    )
  }

  // The same validator the local path uses. No exceptions for being remote.
  const validation = validateMeaning({
    original: text,
    optimized: parsed.optimized,
    originalEntities: entities,
    originalConstraints: constraints,
  })

  if (!validation.ok) {
    const first = validation.issues.find((i) => i.severity === 'critical')
    return failed(
      'Rejected — information was lost',
      `${first ? first.message : 'The rewrite dropped required information.'} The local result was used.`,
    )
  }

  return {
    optimized: parsed.optimized,
    validation,
    report: {
      applied: true,
      status: 'Enhanced with Gemini',
      meaningScore: parsed.meaningScore,
      preservedConstraints: parsed.preservedConstraints,
      removedRedundancies: parsed.removedRedundancies,
      uncertainChanges: parsed.uncertainChanges,
      protectedContent: parsed.protectedContent,
    },
  }
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return 'network error'
}

function truncate(s: string, max = 40): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}
