// The Token Cutter pipeline.
// ---------------------------------------------------------------------------
// One entry point, no hidden state:
//
//   1. protect    which characters may never be rewritten
//   2. segment    sentences, blocks, and the role each one plays
//   3. extract    entities and constraints — the preservation contract
//   4. detect     grammar, filler, wordiness, redundancy → candidate edits
//   5. generate   vetoes, overlap resolution, level gating → Suggestion[]
//   6. apply      accepted edits → optimized text (original untouched)
//   7. validate   re-extract and compare; report anything lost
//   8. refine     run 1–7 again on the result, until it stops paying
//   9. assess     is what is left genuinely as short as it can usefully be?
//
// `analyzePrompt` runs the whole thing. `recompute` re-runs 6–9 and is what the
// UI calls on every accept/reject, so toggling a suggestion stays cheap.
//
// STAGE 8 IS WHY THE ORDER MATTERS. Removing "Could you please make sure that"
// is what exposes the two sentences underneath it as near-duplicates of each
// other; nothing in a single pass can see that, because in the original text
// they are not duplicates yet. Each round runs over the previous round's OUTPUT
// but validates against the ORIGINAL, so no chain of individually-safe edits can
// add up to a lost requirement.

import type {
  ChangeSummary, ConcisionReport, CutterAnalytics, CutterOptions, CutterResult,
  ProcessingMode, RefinementEdit, RefinementPass, Suggestion, ValidationReport,
} from './types.ts'
import { countProtectedTerms, findProtectedSpans } from './protect.ts'
import { segmentPrompt } from './segment.ts'
import { extractEntities } from './entities.ts'
import { extractConstraints } from './constraints.ts'
import { defaultAcceptedIds, generateSuggestions } from './suggestions.ts'
import { acceptedEdits, applyEdits, buildDiff } from './apply.ts'
import { culpableSuggestionIds, validateMeaning } from './validate.ts'
import { explainPrompt } from './explain.ts'
import { readability } from './readability.ts'
import { countWords, estimateTokens, impactForTokens } from './tokens.ts'
import { describeApplied, emptyMemory, neverRemoveTerms, relevantMemories } from './memory.ts'
import { assessConcision } from './concision.ts'
import { summarizeChanges } from './summary.ts'

/**
 * Refinement rounds after the first.
 *
 * Three, because that is how deep the real chains go: round 1 strips the
 * wrapper, round 2 sees that two sentences are now identical, round 3 sees that
 * the survivors share a verb and merges them. A fourth round has never changed
 * a result in the corpus, and every round costs a full detection pass.
 */
export const DEFAULT_REFINEMENT_PASSES = 3
/** A round must find at least this much to be worth keeping. */
const MIN_PASS_TOKENS = 1

/**
 * Refinement budget by prompt size.
 *
 * Analysis runs on the main thread in the in-page assistant, once per typing
 * pause. A full pass is roughly linear in prompt length (~25 ms per 1,000
 * characters), so the number of rounds is capped by size to keep the worst case
 * well inside a frame budget the user would never notice behind a 600 ms
 * debounce. Long prompts lose the extra rounds, not the first one.
 */
function refinementBudget(chars: number, requested: number): number {
  if (chars > 24000) return 0
  if (chars > 8000) return Math.min(1, requested)
  return requested
}

export const DEFAULT_OPTIONS: CutterOptions = {
  level: 'balanced',
  platform: 'chatgpt',
  memory: emptyMemory(),
  allowProtectedEdits: false,
  targetModel: null,
  maxRefinementPasses: DEFAULT_REFINEMENT_PASSES,
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

  const defaultAccepted = defaultAcceptedIds(suggestions, opts.level, { targetModel: opts.targetModel })

  // ── 6–9. Apply, validate, refine, assess ──────────────────────────────────
  const finished = finish({
    original, suggestions, accepted: new Set(defaultAccepted), opts,
    entities, constraints, segments, protectedSpans, protectedTerms,
  })

  return {
    original,
    ...finished,
    suggestions,
    defaultAccepted,
    protectedSpans,
    segments,
    constraints,
    entities,
    explanation: explainPrompt({ segments, constraints, entities }),
    appliedMemories: describeApplied(memories, memoryHits),
    mode: 'local',
  }
}

/**
 * Re-apply with a different accepted set.
 *
 * The detection stages are not re-run against the original, but the refinement
 * rounds ARE — they operate on whatever the accepted set produced, so rejecting
 * a suggestion has to be able to change what the later rounds find. Anything
 * else would leave the panel showing a shorter prompt than the checkboxes
 * describe.
 */
export function recompute(
  result: CutterResult,
  accepted: Set<string>,
  platform: CutterOptions['platform'] = 'chatgpt',
  options: Partial<CutterOptions> = {},
): CutterResult {
  const opts: CutterOptions = { ...DEFAULT_OPTIONS, ...options, platform }
  return {
    ...result,
    ...finish({
      original: result.original,
      suggestions: result.suggestions,
      accepted,
      opts,
      entities: result.entities,
      constraints: result.constraints,
      segments: result.segments,
      protectedSpans: result.protectedSpans,
      // Never-remove terms are recovered from the spans they produced rather
      // than re-derived from memory: the refinement rounds re-protect the text
      // from scratch, and a term that was protected in the first pass has to
      // stay protected in the third.
      protectedTerms: result.protectedSpans
        .filter((s) => s.kind === 'memory-term')
        .map((s) => s.text),
    }),
  }
}

interface FinishInput {
  original: string
  suggestions: Suggestion[]
  accepted: Set<string>
  opts: CutterOptions
  entities: CutterResult['entities']
  constraints: CutterResult['constraints']
  segments: CutterResult['segments']
  protectedSpans: CutterResult['protectedSpans']
  protectedTerms: string[]
}

interface FinishOutput {
  optimized: string
  validation: ValidationReport
  analytics: CutterAnalytics
  refinements: RefinementPass[]
  concision: ConcisionReport
  changeSummary: ChangeSummary
}

/**
 * Stages 6–9, shared by the first analysis and every recompute.
 *
 * The order is load-bearing. Validation runs BEFORE refinement so a first pass
 * that lost something is repaired at the level of the individual suggestion
 * responsible, not by discarding every saving; and it runs again after each
 * refinement round, always against the ORIGINAL, so the guard cannot be walked
 * past one small step at a time.
 */
function finish(input: FinishInput): FinishOutput {
  const { original, suggestions, opts, entities, constraints, segments, protectedSpans } = input
  let accepted = input.accepted

  // ── 6 + 7. Apply, then repair anything the validator objects to ───────────
  let optimized = applyEdits(original, suggestions, accepted)
  let validation = validate(original, optimized, entities, constraints, acceptedEdits(suggestions, accepted))

  // A confident optimizer earns the right to be aggressive by undoing its own
  // mistakes precisely. Rejecting only the edits blamed for a critical loss
  // keeps every other reduction the user was about to get.
  if (!validation.ok) {
    const culpable = new Set(culpableSuggestionIds(validation))
    if (culpable.size) {
      accepted = new Set([...accepted].filter((id) => !culpable.has(id)))
      optimized = applyEdits(original, suggestions, accepted)
      validation = validate(original, optimized, entities, constraints, acceptedEdits(suggestions, accepted))
    }
  }

  // ── 8. Refine ─────────────────────────────────────────────────────────────
  // Refinement extends an optimization; it does not create one. With nothing
  // accepted there is no optimization to extend, and "Keep original" has to mean
  // the original — byte for byte, including the filler the user chose to keep.
  const { text: refined, passes, validation: refinedValidation } = accepted.size === 0
    ? { text: optimized, passes: [] as RefinementPass[], validation }
    : refine({
      original, start: optimized, opts, entities, constraints, baseline: validation,
      protectedTerms: input.protectedTerms,
    })
  optimized = refined
  validation = refinedValidation

  const analytics = computeAnalytics({
    original, optimized, suggestions, accepted, constraints, protectedSpans, platform: opts.platform,
  })

  // ── 9. Assess ─────────────────────────────────────────────────────────────
  const kept = passes.filter((p) => !p.rejected)
  const refinementTokens = kept.reduce((n, p) => n + Math.max(0, p.tokensBefore - p.tokensAfter), 0)
  const concision = assessConcision({
    original, optimized, suggestions, accepted, segments, constraints, entities,
    level: opts.level,
    refinementTokens,
    // "Another pass finds nothing more" is true in two ways. Either a round
    // actually ran and came back empty — or nothing was applied at all, in which
    // case the next round would run over a byte-identical string and is provably
    // a no-op. The second case is not an assumption; it is the same detectors
    // over the same input.
    converged: accepted.size === 0
      ? true
      : passes.length > 0 && passes[passes.length - 1].rejected === 'no-gain',
  })

  return {
    optimized,
    validation,
    analytics,
    refinements: passes,
    concision,
    changeSummary: summarizeChanges({
      suggestions, accepted, refinements: passes, constraints, entities, validation,
    }),
  }
}

function validate(
  original: string,
  optimized: string,
  entities: CutterResult['entities'],
  constraints: CutterResult['constraints'],
  appliedEdits: Suggestion[],
): ValidationReport {
  return validateMeaning({
    original, optimized, originalEntities: entities, originalConstraints: constraints, appliedEdits,
  })
}

interface RefineInput {
  original: string
  start: string
  opts: CutterOptions
  entities: CutterResult['entities']
  constraints: CutterResult['constraints']
  baseline: ValidationReport
  /** Never-remove terms, re-applied on every round. */
  protectedTerms: string[]
}

/**
 * Run the pipeline again over its own output, until it stops paying.
 *
 * Three independent termination guarantees, because a compression loop that can
 * run forever is a frozen tab:
 *   • a hard cap on rounds,
 *   • every round must strictly reduce the token count or the loop stops,
 *   • a round whose result fails validation against the ORIGINAL is discarded
 *     and the loop stops there.
 */
function refine(input: RefineInput): { text: string; passes: RefinementPass[]; validation: ValidationReport } {
  const { original, opts, entities, constraints, baseline } = input
  const maxPasses = refinementBudget(
    original.length,
    Math.max(0, opts.maxRefinementPasses ?? DEFAULT_REFINEMENT_PASSES),
  )
  const passes: RefinementPass[] = []
  let text = input.start
  let validation = baseline

  if (!maxPasses) return { text, passes, validation }

  for (let pass = 2; pass <= maxPasses + 1; pass += 1) {
    const tokensBefore = estimateTokens(text)
    const spans = findProtectedSpans(text, input.protectedTerms)
    const segs = segmentPrompt(text, spans)
    const cons = extractConstraints(text)
    const found = generateSuggestions({
      text, segments: segs, constraints: cons, protectedSpans: spans,
      level: opts.level, allowProtectedEdits: false,
    })
    const take = new Set(defaultAcceptedIds(found, opts.level, { targetModel: opts.targetModel }))
    const next = applyEdits(text, found, take)
    const tokensAfter = estimateTokens(next)

    if (tokensBefore - tokensAfter < MIN_PASS_TOKENS) {
      passes.push({ pass, tokensBefore, tokensAfter: tokensBefore, edits: [], rejected: 'no-gain' })
      break
    }

    // The round is judged against the text the user WROTE, not against the text
    // the previous round produced. Anything else would let three rounds each
    // "preserve meaning" while the chain of them dropped a requirement.
    const check = validate(original, next, entities, constraints, [])
    if (!check.ok) {
      passes.push({ pass, tokensBefore, tokensAfter, edits: [], rejected: 'validation' })
      break
    }

    const edits: RefinementEdit[] = acceptedEdits(found, take).map((s) => ({
      pass,
      category: s.category,
      title: s.title,
      reason: s.reason,
      original: s.original,
      replacement: s.replacement,
      tokensSaved: s.tokensSaved,
    }))
    passes.push({ pass, tokensBefore, tokensAfter, edits })
    text = next
    validation = check
  }

  return { text, passes, validation }
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
export { assessConcision, informationDensity, NEGLIGIBLE_PERCENT, NEGLIGIBLE_TOKENS } from './concision.ts'
export { summarizeChanges } from './summary.ts'

export type { ProcessingMode }
export * from './types.ts'
