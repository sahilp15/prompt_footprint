// "What changed, and what did you check?"
// ---------------------------------------------------------------------------
// Aggressive compression is only usable if it is auditable. A user who is shown
// a prompt 40% shorter than the one they wrote needs two lists to trust it:
// what went, and what was verified to still be there.
//
// Both are built from what actually happened — the applied edits and the
// validator's own tallies — so neither list can describe work that was not
// done. In particular the "Preserved" side is derived from the ValidationReport
// and is empty when the validator did not run.

import type {
  ChangeSummary, ChangeSummaryItem, Constraint, Entity, RefinementPass, Suggestion,
  ValidationReport,
} from './types.ts'

/** Plural label for a category, as a user would describe it. */
const CATEGORY_LABEL: Record<string, [string, string]> = {
  'repeated-instruction': ['repeated instruction', 'repeated instructions'],
  'redundant-example': ['redundant example', 'redundant examples'],
  'sentence-merge': ['merged instruction', 'merged instructions'],
  'instruction-collapse': ['verbose instruction wrapper', 'verbose instruction wrappers'],
  'meta-commentary': ['meta-comment', 'meta-comments'],
  politeness: ['politeness phrase', 'politeness phrases'],
  filler: ['filler phrase', 'filler phrases'],
  hedge: ['hedge', 'hedges'],
  'wordy-phrase': ['wordy phrase', 'wordy phrases'],
  transition: ['filler transition', 'filler transitions'],
  whitespace: ['formatting fix', 'formatting fixes'],
  spelling: ['spelling fix', 'spelling fixes'],
  grammar: ['grammar fix', 'grammar fixes'],
}

function label(category: string, n: number): string {
  const pair = CATEGORY_LABEL[category]
  if (!pair) return category
  return n === 1 ? pair[0] : pair[1]
}

/** Entity kinds worth naming in the preserved list, in the order shown. */
const PRESERVED_ENTITY_LABEL: [string, string][] = [
  ['negation', 'every “do not” / “never”'],
  ['length-limit', 'length limits'],
  ['number', 'numbers'],
  ['date', 'dates'],
  ['url', 'links'],
  ['email', 'email addresses'],
  ['quoted', 'quoted wording'],
  ['proper-noun', 'names'],
  ['file-type', 'file names'],
  ['technology', 'technical terms'],
  ['imperative', 'explicit must/must-not instructions'],
]

const PRESERVED_CONSTRAINT_LABEL: Record<string, string> = {
  length: 'length limit',
  tone: 'tone',
  format: 'response format',
  audience: 'audience',
  deadline: 'deadline',
  inclusion: 'must-include requirements',
  exclusion: 'must-not requirements',
  language: 'language',
}

export interface SummaryInput {
  suggestions: Suggestion[]
  accepted: Set<string>
  refinements: RefinementPass[]
  constraints: Constraint[]
  entities: Entity[]
  validation: ValidationReport
}

/**
 * The two lists shown under an optimization.
 *
 * Refinement-round edits are folded into the same category tallies as the first
 * pass: from the user's point of view "3 filler phrases" is one fact, not a
 * per-round breakdown of the pipeline's internals.
 */
export function summarizeChanges({
  suggestions, accepted, refinements, constraints, entities, validation,
}: SummaryInput): ChangeSummary {
  const counts = new Map<string, number>()
  const bump = (category: string): void => { counts.set(category, (counts.get(category) || 0) + 1) }

  for (const s of suggestions) {
    if (!s.advisory && accepted.has(s.id)) bump(s.category)
  }
  for (const pass of refinements) {
    if (pass.rejected) continue
    for (const e of pass.edits) bump(e.category)
  }

  const removed: ChangeSummaryItem[] = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category, n]) => ({ label: label(category, n), count: n }))

  const preserved: ChangeSummaryItem[] = []
  const verified = validation.validated === true && validation.ok

  if (verified) {
    const constraintKinds = new Set(constraints.map((c) => c.kind))
    const total = new Set(constraints.map((c) => c.key)).size
    if (total > 0) {
      preserved.push({ label: `all ${total} requirement${total === 1 ? '' : 's'}`, count: total })
    }
    const entityKinds = new Set(entities.map((e) => e.kind))
    for (const [kind, text] of PRESERVED_ENTITY_LABEL) {
      if (entityKinds.has(kind as Entity['kind'])) {
        preserved.push({ label: text, count: entities.filter((e) => e.kind === kind).length })
      }
    }
    for (const [kind, text] of Object.entries(PRESERVED_CONSTRAINT_LABEL)) {
      // Requirement kinds are already counted above; only the ones a user thinks
      // of by name (tone, format, audience) are worth repeating individually.
      if (!['tone', 'format', 'audience', 'language', 'deadline'].includes(kind)) continue
      if (constraintKinds.has(kind as Constraint['kind'])) preserved.push({ label: text, count: 1 })
    }
  }

  return { removed, preserved, verified }
}
