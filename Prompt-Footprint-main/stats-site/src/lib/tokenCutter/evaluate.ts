// The evaluation harness.
// ---------------------------------------------------------------------------
// Turns `EVAL_CASES` into numbers you can compare across changes:
//
//   averageReduction        mean token reduction across the suite
//   constraintPreservation  fraction of stated constraints still present
//   entityPreservation      fraction of tracked entities still present
//   unsafeSuggestionRate    fraction of pre-accepted suggestions that the
//                           validator then flagged as losing information
//
// A case that saves more tokens but drops a required string FAILS. That
// asymmetry is the whole point — it is what stops "improvements" that are
// really regressions.
//
// Run it with `npm run eval`.

import { EVAL_CASES, type EvalCase } from './evalDataset.ts'
import { analyzePrompt } from './index.ts'

export interface CaseResult {
  id: string
  description: string
  passed: boolean
  reduction: number
  originalTokens: number
  optimizedTokens: number
  meaningScore: number
  /** `mustContain` entries that went missing. */
  missing: string[]
  /** `mustNotContain` entries that survived. */
  leftover: string[]
  /** Reasons the case failed, in plain language. */
  failures: string[]
  optimized: string
}

export interface EvalReport {
  cases: CaseResult[]
  passed: number
  failed: number
  averageReduction: number
  constraintPreservation: number
  entityPreservation: number
  unsafeSuggestionRate: number
  averageMeaningScore: number
}

/** Compare ignoring case and collapsing whitespace, so formatting isn't graded. */
function contains(haystack: string, needle: string): boolean {
  const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ')
  return norm(haystack).includes(norm(needle))
}

export function runCase(testCase: EvalCase): CaseResult {
  const result = analyzePrompt(testCase.prompt, { level: testCase.level })
  const { optimized, analytics, validation, explanation } = result

  const missing = testCase.mustContain.filter((s) => !contains(optimized, s))
  const leftover = (testCase.mustNotContain ?? []).filter((s) => contains(optimized, s))
  const reduction = analytics.originalTokens > 0
    ? analytics.tokensSaved / analytics.originalTokens
    : 0

  const failures: string[] = []
  if (missing.length) failures.push(`lost required content: ${missing.map((m) => `“${m}”`).join(', ')}`)
  if (leftover.length) failures.push(`did not remove: ${leftover.map((m) => `“${m}”`).join(', ')}`)
  if (reduction < testCase.minReduction) {
    failures.push(`reduced only ${pct(reduction)} (expected at least ${pct(testCase.minReduction)})`)
  }
  if (reduction > testCase.maxReduction) {
    failures.push(`reduced ${pct(reduction)} — over the ${pct(testCase.maxReduction)} ceiling, which risks over-cutting`)
  }
  if (!validation.ok) {
    const critical = validation.issues.filter((i) => i.severity === 'critical')
    failures.push(`validator reported ${critical.length} critical loss: ${critical[0]?.message ?? ''}`)
  }
  if (testCase.expectsConflict && explanation.conflicts.length === 0) {
    failures.push('expected a conflicting-requirements warning, none was raised')
  }

  return {
    id: testCase.id,
    description: testCase.description,
    passed: failures.length === 0,
    reduction,
    originalTokens: analytics.originalTokens,
    optimizedTokens: analytics.optimizedTokens,
    meaningScore: validation.meaningScore,
    missing,
    leftover,
    failures,
    optimized,
  }
}

export function runEvaluation(cases: EvalCase[] = EVAL_CASES): EvalReport {
  const results = cases.map(runCase)

  let constraintsKept = 0
  let constraintsTotal = 0
  let entitiesKept = 0
  let entitiesTotal = 0
  let unsafeAccepted = 0
  let totalAccepted = 0

  for (const testCase of cases) {
    const r = analyzePrompt(testCase.prompt, { level: testCase.level })
    constraintsKept += r.validation.preservedConstraints
    constraintsTotal += r.validation.totalConstraints
    entitiesKept += r.validation.preservedEntities
    entitiesTotal += r.validation.totalEntities
    totalAccepted += r.defaultAccepted.length
    // A pre-accepted suggestion the validator then blames for a critical loss
    // is, by definition, one we should not have accepted on the user's behalf.
    const blamed = new Set(
      r.validation.issues.filter((i) => i.severity === 'critical' && i.suggestionId).map((i) => i.suggestionId),
    )
    unsafeAccepted += r.defaultAccepted.filter((id) => blamed.has(id)).length
  }

  const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

  return {
    cases: results,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    averageReduction: mean(results.map((r) => r.reduction)),
    constraintPreservation: constraintsTotal ? constraintsKept / constraintsTotal : 1,
    entityPreservation: entitiesTotal ? entitiesKept / entitiesTotal : 1,
    unsafeSuggestionRate: totalAccepted ? unsafeAccepted / totalAccepted : 0,
    averageMeaningScore: mean(results.map((r) => r.meaningScore)),
  }
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

/** A console-friendly report. Used by `npm run eval`. */
export function formatReport(report: EvalReport): string {
  const lines: string[] = []
  lines.push('Token Cutter — evaluation')
  lines.push('='.repeat(72))

  for (const c of report.cases) {
    lines.push(`${c.passed ? 'PASS' : 'FAIL'}  ${c.id.padEnd(28)} ${pct(c.reduction).padStart(7)} reduction  ${c.originalTokens}→${c.optimizedTokens} tokens`)
    if (!c.passed) for (const f of c.failures) lines.push(`      ↳ ${f}`)
  }

  lines.push('-'.repeat(72))
  lines.push(`Cases passed              ${report.passed}/${report.cases.length}`)
  lines.push(`Average token reduction   ${pct(report.averageReduction)}`)
  lines.push(`Constraint preservation   ${pct(report.constraintPreservation)}`)
  lines.push(`Entity preservation       ${pct(report.entityPreservation)}`)
  lines.push(`Unsafe auto-applied rate  ${pct(report.unsafeSuggestionRate)}`)
  lines.push(`Average meaning score     ${report.averageMeaningScore.toFixed(3)}`)
  return lines.join('\n')
}
