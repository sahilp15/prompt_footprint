// "Explain my prompt" — the understanding check.
// ---------------------------------------------------------------------------
// Everything the cutter decides rests on how it read the prompt, so this panel
// shows that reading back. If the cutter thinks the task is "summarize" when
// the user meant "translate", they can see that before accepting a single
// suggestion — which is far more useful than a confidence percentage.
//
// Derived entirely from the segmentation and constraint stages. No model, no
// network, and no claims beyond what those stages actually found.

import type {
  Constraint, Entity, PromptExplanation, Segment,
} from './types.ts'
import { findConflicts } from './constraints.ts'
import { roleHistogram } from './segment.ts'

const TASK_VERBS: [RegExp, string][] = [
  [/\b(?:summar(?:ize|ise)|tl;?dr|condense)\b/i, 'Summarize something'],
  [/\b(?:translate|translation)\b/i, 'Translate text'],
  [/\b(?:rewrite|rephrase|reword|paraphrase|edit|proofread)\b/i, 'Rewrite or edit text'],
  [/\b(?:refactor|debug|fix|optimi[sz]e|implement|code|program)\b/i, 'Write or change code'],
  [/\b(?:explain|clarify|teach|walk me through|describe how)\b/i, 'Explain a topic'],
  [/\b(?:analy[sz]e|evaluate|assess|critique|review|compare)\b/i, 'Analyze or evaluate'],
  [/\b(?:brainstorm|ideate|suggest ideas|come up with)\b/i, 'Generate ideas'],
  [/\b(?:draft|write|compose|create|generate|produce)\b/i, 'Write new content'],
  [/\b(?:plan|outline|roadmap|schedule|organi[sz]e)\b/i, 'Plan or outline'],
  [/\b(?:extract|parse|pull out|identify|classify|categori[sz]e|label)\b/i, 'Extract or classify data'],
  [/\b(?:convert|transform|reformat|migrate)\b/i, 'Convert between formats'],
  [/\b(?:list|enumerate)\b/i, 'Produce a list'],
]

/**
 * What the prompt is actually asking for.
 *
 * Segments classified as `task` are checked first, but the ask is often buried
 * mid-sentence ("Basically, I just need you to write a summary…"), so every
 * non-pleasantry sentence is scanned in order before giving up.
 */
function primaryTask(segments: Segment[]): string {
  const ranked = [
    ...segments.filter((s) => s.role === 'task'),
    ...segments.filter((s) => s.role === 'question'),
    ...segments.filter((s) => s.role !== 'task' && s.role !== 'question' && s.role !== 'meta'),
  ]

  for (const seg of ranked) {
    for (const [re, label] of TASK_VERBS) {
      if (re.test(seg.text)) return label
    }
  }

  if (segments.some((s) => s.role === 'question')) return 'Answer a question'
  return segments.some((s) => s.text.trim())
    ? 'Follow the instructions in the prompt'
    : 'No clear task detected'
}

/**
 * Constraint keys are normalized for comparison ("tone:not-too-formal"), which
 * is exactly the wrong thing to show a person. These describe helpers read the
 * matched text instead, de-duplicated by key.
 */
function uniqueByKey(constraints: Constraint[], kind: Constraint['kind']): Constraint[] {
  const seen = new Map<string, Constraint>()
  for (const c of constraints) {
    if (c.kind === kind && !seen.has(c.key)) seen.set(c.key, c)
  }
  return [...seen.values()]
}

function describeTone(constraints: Constraint[]): string {
  const tones = uniqueByKey(constraints, 'tone')
  if (!tones.length) return 'Not specified — the model will pick a default'
  return tones.map((c) => c.text.trim().toLowerCase()).join(', ')
}

function describeFormat(constraints: Constraint[], segments: Segment[]): string {
  const formats = [...new Set(
    constraints.filter((c) => c.kind === 'format').map((c) => c.key.replace('format:', '')),
  )]
  if (formats.length) return formats.join(', ')
  if (segments.some((s) => s.role === 'format')) return 'Described in the prompt but not in a recognized format keyword'
  return 'Not specified — free-form response'
}

function describeAudience(constraints: Constraint[]): string {
  const audiences = uniqueByKey(constraints, 'audience')
  if (!audiences.length) return 'Not specified'
  return audiences.map((c) => c.text.trim()).join(', ')
}

function describeIntent(segments: Segment[], constraints: Constraint[]): string {
  const hasRole = segments.some((s) => s.role === 'role')
  const hasExamples = segments.some((s) => s.role === 'example')
  const hasContext = segments.some((s) => s.role === 'context')
  const constraintCount = new Set(constraints.map((c) => c.key)).size

  const parts: string[] = []
  if (hasRole) parts.push('assigns the model a persona')
  if (hasContext) parts.push('supplies background')
  if (hasExamples) parts.push('shows examples of the expected output')
  if (constraintCount > 0) parts.push(`sets ${constraintCount} requirement${constraintCount === 1 ? '' : 's'}`)

  if (!parts.length) return 'A direct request with no persona, examples, or stated requirements.'
  const last = parts.pop() as string
  const joined = parts.length ? `${parts.join(', ')} and ${last}` : last
  return `The prompt ${joined}.`
}

export interface ExplainInput {
  segments: Segment[]
  constraints: Constraint[]
  entities: Entity[]
}

/** Build the explanation shown in the expandable panel. */
export function explainPrompt({ segments, constraints, entities }: ExplainInput): PromptExplanation {
  // Show the entities a person would want to eyeball, in a stable order.
  const INTERESTING = ['length-limit', 'date', 'number', 'url', 'proper-noun', 'technology', 'file-type', 'quoted']
  const shown = [...entities]
    .filter((e) => INTERESTING.includes(e.kind))
    .sort((a, b) => INTERESTING.indexOf(a.kind) - INTERESTING.indexOf(b.kind))
    .slice(0, 24)

  // One constraint per key — repeats are the redundancy pass's business.
  const uniqueConstraints = [...new Map(constraints.map((c) => [c.key, c])).values()]

  return {
    task: primaryTask(segments),
    audience: describeAudience(constraints),
    tone: describeTone(constraints),
    format: describeFormat(constraints, segments),
    intent: describeIntent(segments, constraints),
    constraints: uniqueConstraints,
    entities: shown,
    conflicts: findConflicts(constraints),
    sections: roleHistogram(segments),
  }
}

/** Human labels for the structure histogram. */
export const ROLE_LABELS: Record<string, string> = {
  role: 'Persona',
  task: 'Task',
  context: 'Context',
  constraint: 'Constraints',
  example: 'Examples',
  format: 'Output format',
  question: 'Questions',
  meta: 'Pleasantries',
}
