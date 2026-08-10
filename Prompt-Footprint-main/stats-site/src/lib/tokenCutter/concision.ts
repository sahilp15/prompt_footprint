// Stage 8 — is this prompt actually as short as it can usefully be?
// ---------------------------------------------------------------------------
// "Already concise" is a claim, and for a long time this product made it on the
// strength of one number: whether the applied edits happened to save at least
// four tokens. That is not a statement about the prompt at all — it is a
// statement about how much the acceptance policy chose to apply — and it is why
// obviously padded prompts were being waved through.
//
// The claim is now the conjunction of seven independent conditions. Every one
// of them must hold, and each one that does not becomes a reason the user can
// read. Length is deliberately not among them: a 25-token prompt full of
// throat-clearing fails, and a 1,000-token specification with a high
// information density passes.
//
// The seventh condition is the interesting one. It asks the pipeline to have
// another go at the already-optimized text and reports whether that produced
// anything. A prompt is only concise if optimizing it again is a no-op.

import type {
  ConcisionChecks, ConcisionReport, Constraint, Entity, OptimizationLevel, Segment, Suggestion,
} from './types.ts'
import { countWords, estimateTokens } from './tokens.ts'

/** Savings small enough that interrupting someone for them is not worth it. */
export const NEGLIGIBLE_TOKENS = 2
export const NEGLIGIBLE_PERCENT = 1.5

const REPETITION_CATEGORIES = new Set(['repeated-instruction', 'redundant-example'])
const FILLER_CATEGORIES = new Set(['filler', 'politeness', 'hedge', 'wordy-phrase', 'transition'])
const FRAMING_CATEGORIES = new Set(['instruction-collapse', 'meta-commentary'])

/**
 * The share of the prompt's words that carry task, constraint, or entity
 * content, as opposed to connective tissue.
 *
 * Ratio, not a count, so it says the same thing about a short prompt and a long
 * one. It is reported for the debug view and used nowhere as a threshold — a
 * density score is a summary of the checks, not a substitute for them.
 */
export function informationDensity(
  text: string,
  segments: Segment[],
  constraints: Constraint[],
  entities: Entity[],
): number {
  const words = countWords(text)
  if (!words) return 1

  const carrying = segments
    .filter((s) => s.role !== 'meta')
    .reduce((n, s) => n + countWords(s.text), 0)
  const anchors = new Set(constraints.map((c) => c.key)).size +
    new Set(entities.map((e) => `${e.kind}|${e.key}`)).size

  // Two components: how much of the text is not pleasantry, and how densely the
  // requirements are packed into it. Capped at 1 so a requirement-dense prompt
  // cannot score above "perfectly dense".
  const substantive = carrying / words
  const anchorDensity = Math.min(1, (anchors * 8) / words)
  return Math.round(Math.min(1, substantive * 0.6 + anchorDensity * 0.4) * 100) / 100
}

export interface ConcisionInput {
  original: string
  optimized: string
  suggestions: Suggestion[]
  accepted: Set<string>
  segments: Segment[]
  constraints: Constraint[]
  entities: Entity[]
  level: OptimizationLevel
  /** Tokens a further refinement round removed, if one ran. */
  refinementTokens: number
  /** True when a further round was attempted and found nothing. */
  converged: boolean
}

/**
 * Run the seven checks.
 *
 * `suggestions` is the FULL set the detectors produced, not just the applied
 * ones. That distinction is the whole point: a prompt where the optimizer found
 * six removable filler phrases and chose to apply two of them is not concise —
 * it is under-optimized, and the report says so rather than congratulating the
 * user on their tight writing.
 */
export function assessConcision(input: ConcisionInput): ConcisionReport {
  const {
    original, optimized, suggestions, accepted, segments, constraints, entities,
    refinementTokens, converged,
  } = input

  const actionable = suggestions.filter((s) => !s.advisory)
  const residual = actionable.filter((s) => !accepted.has(s.id) && s.tokensSaved > 0)
  const residualTokens = residual.reduce((n, s) => n + s.tokensSaved, 0)

  // Anything the detectors are more than marginally confident about counts,
  // whether or not the current level chose to apply it.
  const outstanding = (test: (s: Suggestion) => boolean): boolean =>
    actionable.some((s) => test(s) && s.score >= 0.6 && s.tokensSaved > 0)

  const originalTokens = estimateTokens(original)
  const saved = Math.max(0, originalTokens - estimateTokens(optimized))
  const savedPct = originalTokens > 0 ? (saved / originalTokens) * 100 : 0

  const checks: ConcisionChecks = {
    noRepetition: !outstanding((s) => REPETITION_CATEGORIES.has(s.category)),
    noFiller: !outstanding((s) => FILLER_CATEGORIES.has(s.category)),
    notMergeable: !outstanding((s) => s.category === 'sentence-merge'),
    formattingTight: !outstanding((s) => s.category === 'whitespace'),
    noVerboseFraming: !outstanding((s) => FRAMING_CATEGORIES.has(s.category)),
    savingsNegligible: saved < NEGLIGIBLE_TOKENS || savedPct < NEGLIGIBLE_PERCENT,
    convergedOnRepeat: converged && refinementTokens === 0,
  }

  const reasons: string[] = []
  const count = (test: (s: Suggestion) => boolean): number =>
    actionable.filter((s) => test(s) && s.score >= 0.6 && s.tokensSaved > 0).length
  if (!checks.noRepetition) {
    reasons.push(`${count((s) => REPETITION_CATEGORIES.has(s.category))} repeated instruction or example`)
  }
  if (!checks.noVerboseFraming) {
    reasons.push(`${count((s) => FRAMING_CATEGORIES.has(s.category))} verbose instruction wrapper`)
  }
  if (!checks.noFiller) {
    reasons.push(`${count((s) => FILLER_CATEGORIES.has(s.category))} filler or wordy phrase`)
  }
  if (!checks.notMergeable) reasons.push('instructions that could be combined')
  if (!checks.formattingTight) reasons.push('spare formatting whitespace')
  if (!checks.savingsNegligible) reasons.push(`${saved} tokens already removable`)
  if (!checks.convergedOnRepeat) reasons.push(`${refinementTokens} more tokens found on a second pass`)

  return {
    concise: Object.values(checks).every(Boolean),
    checks,
    reasons,
    residualOpportunities: residual.length,
    residualTokens,
    density: informationDensity(original, segments, constraints, entities),
  }
}
