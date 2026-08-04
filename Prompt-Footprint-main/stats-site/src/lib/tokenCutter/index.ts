// The Token Cutter pipeline.
// ---------------------------------------------------------------------------
// One entry point, seven stages, no hidden state:
//
//   1. protect    which characters may never be rewritten
//   2. segment    sentences, blocks, and the role each one plays
//   3. extract    entities and constraints — the preservation contract
//   4. detect     grammar, filler, wordiness, redundancy → candidate edits
//   5. generate   vetoes, overlap resolution, level gating → Suggestion[]
//   6. apply      accepted edits → optimized text (original untouched)
//   7. validate   re-extract and compare; report anything lost
//
// `analyzePrompt` runs 1–5 once. `recompute` runs 6–7 and is what the UI calls
// on every accept/reject, so toggling a suggestion is cheap.

import type {
  CutterAnalytics, CutterOptions, CutterResult, ProcessingMode, Suggestion,
} from './types.ts'
import { countProtectedTerms, findProtectedSpans } from './protect.ts'
import { segmentPrompt } from './segment.ts'
import { extractEntities } from './entities.ts'
import { extractConstraints } from './constraints.ts'
import { defaultAcceptedIds, generateSuggestions } from './suggestions.ts'
import { acceptedEdits, applyEdits, buildDiff } from './apply.ts'
import { validateMeaning } from './validate.ts'
import { explainPrompt } from './explain.ts'
import { readability } from './readability.ts'
import { countWords, estimateTokens, impactForTokens } from './tokens.ts'
import { describeApplied, emptyMemory, neverRemoveTerms, relevantMemories } from './memory.ts'

export const DEFAULT_OPTIONS: CutterOptions = {
  level: 'balanced',
  platform: 'chatgpt',
  memory: emptyMemory(),
  allowProtectedEdits: false,
}

/** Everything stage 1–5 produced, reused by every later recompute. */
export interface Analysis {
  original: string
  options: CutterOptions
  result: CutterResult
}

/**
 * Run the analysis stages. Pure: same input, same output, no I/O.
 *
 * The returned `CutterResult` already has the default-accepted suggestions
 * applied, so a caller that renders it immediately shows a real optimization
 * rather than an empty state.
 */
export function analyzePrompt(text: string, options: Partial<CutterOptions> = {}): CutterResult {
  const opts: CutterOptions = { ...DEFAULT_OPTIONS, ...options }
  const original = typeof text === 'string' ? text : ''

  // ── Memory (before protection, so never-remove terms are honored) ─────────
  const preConstraints = extractConstraints(original)
  const memories = relevantMemories(opts.memory, { text: original, constraints: preConstraints })
  const protectedTerms = neverRemoveTerms(memories)

  // ── 1. Protect ────────────────────────────────────────────────────────────
  const protectedSpans = findProtectedSpans(original, protectedTerms)
  const memoryHits = protectedSpans.filter((s) => s.kind === 'memory-term').length

  // ── 2. Segment ────────────────────────────────────────────────────────────
  const segments = segmentPrompt(original, protectedSpans)

  // ── 3. Extract ────────────────────────────────────────────────────────────
  const entities = extractEntities(original)
  const constraints = preConstraints

  // ── 4 + 5. Detect and generate ────────────────────────────────────────────
  const suggestions = generateSuggestions({
    text: original,
    segments,
    constraints,
    protectedSpans,
    level: opts.level,
    allowProtectedEdits: opts.allowProtectedEdits,
  })

  const defaultAccepted = defaultAcceptedIds(suggestions, opts.level)

  // ── 6 + 7. Apply and validate ─────────────────────────────────────────────
  const optimized = applyEdits(original, suggestions, new Set(defaultAccepted))
  const validation = validateMeaning({
    original,
    optimized,
    originalEntities: entities,
    originalConstraints: constraints,
    appliedEdits: acceptedEdits(suggestions, new Set(defaultAccepted)),
  })

  return {
    original,
    optimized,
    suggestions,
    defaultAccepted,
    protectedSpans,
    segments,
    constraints,
    entities,
    explanation: explainPrompt({ segments, constraints, entities }),
    validation,
    analytics: computeAnalytics({
      original,
      optimized,
      suggestions,
      accepted: new Set(defaultAccepted),
      constraints,
      protectedSpans,
      platform: opts.platform,
    }),
    appliedMemories: describeApplied(memories, memoryHits),
    mode: 'local',
  }
}

/**
 * Re-apply with a different accepted set. Stages 1–5 are not re-run, so this
 * stays fast enough to call on every checkbox toggle.
 */
export function recompute(result: CutterResult, accepted: Set<string>, platform: CutterOptions['platform'] = 'chatgpt'): CutterResult {
  const optimized = applyEdits(result.original, result.suggestions, accepted)
  const applied = acceptedEdits(result.suggestions, accepted)

  return {
    ...result,
    optimized,
    validation: validateMeaning({
      original: result.original,
      optimized,
      originalEntities: result.entities,
      originalConstraints: result.constraints,
      appliedEdits: applied,
    }),
    analytics: computeAnalytics({
      original: result.original,
      optimized,
      suggestions: result.suggestions,
      accepted,
      constraints: result.constraints,
      protectedSpans: result.protectedSpans,
      platform,
    }),
  }
}

interface AnalyticsInput {
  original: string
  optimized: string
  suggestions: Suggestion[]
  accepted: Set<string>
  constraints: CutterResult['constraints']
  protectedSpans: CutterResult['protectedSpans']
  platform: CutterOptions['platform']
}

/** The numbers shown in the analytics rail. */
export function computeAnalytics({
  original, optimized, suggestions, accepted, constraints, protectedSpans, platform,
}: AnalyticsInput): CutterAnalytics {
  const originalTokens = estimateTokens(original)
  const optimizedTokens = estimateTokens(optimized)
  const saved = Math.max(0, originalTokens - optimizedTokens)

  const before = readability(original)
  const after = readability(optimized)

  const actionable = suggestions.filter((s) => !s.advisory)
  const acceptedCount = actionable.filter((s) => accepted.has(s.id)).length

  return {
    originalWords: countWords(original),
    optimizedWords: countWords(optimized),
    originalTokens,
    optimizedTokens,
    tokensSaved: saved,
    percentReduction: originalTokens > 0 ? (saved / originalTokens) * 100 : 0,
    saved: impactForTokens(saved, platform),
    readability: after.score,
    readabilityDelta: after.score - before.score,
    preservedConstraints: new Set(constraints.map((c) => c.key)).size,
    protectedTerms: countProtectedTerms(protectedSpans),
    suggestionsAccepted: acceptedCount,
    suggestionsRejected: actionable.length - acceptedCount,
    suggestionsTotal: actionable.length,
  }
}

/** Convenience for tests and the eval harness: text in, optimized text out. */
export function optimize(text: string, options: Partial<CutterOptions> = {}): {
  optimized: string
  result: CutterResult
} {
  const result = analyzePrompt(text, options)
  return { optimized: result.optimized, result }
}

export { buildDiff }

export type { ProcessingMode }
export * from './types.ts'
