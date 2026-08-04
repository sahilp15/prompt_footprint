// Stage 7 — semantic safety validation.
// ---------------------------------------------------------------------------
// A shorter prompt that lost a requirement is not an optimization, it is a bug.
// This stage re-extracts every entity and constraint from the OPTIMIZED text
// and compares it against the original. Anything missing is reported.
//
// The product rule this enforces: PromptFootprint never tells a user that two
// prompts mean the same thing unless this comparison actually ran. The report
// carries `validated: true` as a type-level reminder — there is no code path
// that produces a "meaning preserved" claim without building one of these.
//
// Some loss is expected and correct: removing a duplicated instruction removes
// its second copy of an entity. Comparison is therefore on distinct keys, not
// occurrence counts — except for negations, where every occurrence is keyed
// separately because losing one genuinely flips a requirement.

import type {
  Constraint, Entity, Suggestion, ValidationIssue, ValidationReport,
} from './types.ts'
import { CRITICAL_ENTITY_KINDS, extractEntities } from './entities.ts'
import { extractConstraints } from './constraints.ts'

const KIND_LABEL: Record<string, string> = {
  number: 'number',
  date: 'date',
  url: 'link',
  email: 'email address',
  'file-type': 'file type',
  technology: 'technology',
  'proper-noun': 'name',
  quoted: 'quoted text',
  negation: 'negation',
  'length-limit': 'length limit',
  imperative: 'explicit instruction',
  constraint: 'constraint',
}

/** Which accepted edit removed `text`, if any — used to attribute an issue. */
function blame(original: string, entityText: string, edits: Suggestion[]): string | undefined {
  const needle = entityText.toLowerCase()
  for (const e of edits) {
    const removed = original.slice(e.start, e.end).toLowerCase()
    if (removed.includes(needle) && !e.replacement.toLowerCase().includes(needle)) return e.id
  }
  return undefined
}

export interface ValidateInput {
  original: string
  optimized: string
  /** Pre-computed to avoid re-parsing; recomputed if absent. */
  originalEntities?: Entity[]
  originalConstraints?: Constraint[]
  /** The edits that were actually applied, for attribution. */
  appliedEdits?: Suggestion[]
}

/**
 * Compare the original and optimized prompts and report what, if anything, was
 * lost. Always returns a report — never throws, never guesses.
 */
export function validateMeaning({
  original,
  optimized,
  originalEntities,
  originalConstraints,
  appliedEdits = [],
}: ValidateInput): ValidationReport {
  const beforeEntities = originalEntities ?? extractEntities(original)
  const beforeConstraints = originalConstraints ?? extractConstraints(original)

  const afterEntities = extractEntities(optimized)
  const afterConstraints = extractConstraints(optimized)

  const afterEntityKeys = new Set(afterEntities.map((e) => `${e.kind}|${e.key}`))
  const afterConstraintKeys = new Set(afterConstraints.map((c) => c.key))

  const issues: ValidationIssue[] = []

  // ── Entities ──────────────────────────────────────────────────────────────
  // Deduplicate the "before" set first: an entity stated twice and now stated
  // once is preserved, not lost.
  const beforeUnique = new Map<string, Entity>()
  for (const e of beforeEntities) beforeUnique.set(`${e.kind}|${e.key}`, e)

  let preservedEntities = 0
  for (const [id, entity] of beforeUnique) {
    if (afterEntityKeys.has(id)) { preservedEntities += 1; continue }

    // Proper nouns and technologies are matched loosely — casing or a
    // possessive can shift without the fact being lost.
    if (entity.kind === 'proper-noun' || entity.kind === 'technology') {
      if (optimized.toLowerCase().includes(entity.key.toLowerCase())) { preservedEntities += 1; continue }
    }
    // Imperatives are keyed on content words; a partial survival still counts
    // as long as the operative verb is present.
    if (entity.kind === 'imperative') {
      const head = entity.key.split(' ')[0]
      if (head && optimized.toLowerCase().includes(head)) { preservedEntities += 1; continue }
    }

    const critical = CRITICAL_ENTITY_KINDS.has(entity.kind)
    const label = KIND_LABEL[entity.kind] || entity.kind
    issues.push({
      severity: critical ? 'critical' : 'warning',
      kind: entity.kind,
      text: entity.text,
      message: critical
        ? `The ${label} “${truncate(entity.text)}” is in your original but not in the optimized version.`
        : `The ${label} “${truncate(entity.text)}” no longer appears in the optimized version.`,
      suggestionId: blame(original, entity.text, appliedEdits),
    })
  }

  // ── Constraints ───────────────────────────────────────────────────────────
  const beforeConstraintUnique = new Map<string, Constraint>()
  for (const c of beforeConstraints) beforeConstraintUnique.set(c.key, c)

  const optimizedLower = optimized.toLowerCase()

  let preservedConstraints = 0
  for (const [key, constraint] of beforeConstraintUnique) {
    if (afterConstraintKeys.has(key)) { preservedConstraints += 1; continue }

    // Inclusion/exclusion constraints are keyed on content words, and their key
    // only forms when a trigger verb precedes them. Removing a sentence that
    // *restated* "the post should be about climate change" drops the key while
    // the subject is still plainly in the prompt — that is deduplication
    // working, not information loss. So the substantive test is whether the
    // content survives, not whether the trigger phrasing does.
    if (constraint.kind === 'inclusion' || constraint.kind === 'exclusion') {
      const words = key.split(':').slice(1).join(':').split(' ').filter(Boolean)
      if (words.length && words.every((w) => optimizedLower.includes(w))) {
        preservedConstraints += 1
        continue
      }
    }

    issues.push({
      severity: 'critical',
      kind: 'constraint',
      text: constraint.text,
      message: `The ${constraint.label.toLowerCase()} “${truncate(constraint.text)}” was dropped. Restore it or reject the change that removed it.`,
      suggestionId: blame(original, constraint.text, appliedEdits),
    })
  }

  const totalEntities = beforeUnique.size
  const totalConstraints = beforeConstraintUnique.size
  const tracked = totalEntities + totalConstraints
  const kept = preservedEntities + preservedConstraints

  // An empty prompt (or one with nothing to track) is trivially preserved.
  const meaningScore = tracked === 0 ? 1 : kept / tracked
  const ok = !issues.some((i) => i.severity === 'critical')

  return {
    ok,
    meaningScore,
    issues: issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1)),
    preservedEntities,
    preservedConstraints,
    totalEntities,
    totalConstraints,
    validated: true,
  }
}

function truncate(s: string, max = 48): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/**
 * The ids of accepted suggestions that caused a critical loss.
 *
 * Used to auto-repair: rejecting exactly these restores the information
 * without discarding every other saving the user just accepted.
 */
export function culpableSuggestionIds(report: ValidationReport): string[] {
  return [...new Set(
    report.issues
      .filter((i) => i.severity === 'critical' && i.suggestionId)
      .map((i) => i.suggestionId as string),
  )]
}
