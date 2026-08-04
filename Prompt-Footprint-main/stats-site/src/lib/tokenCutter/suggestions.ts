// Stage 5 — suggestion generation.
// ---------------------------------------------------------------------------
// Runs every detector, applies the safety vetoes, resolves overlaps, and turns
// raw edits into the `Suggestion` objects the UI renders.
//
// The vetoes are the important part. A raw edit is discarded when it:
//   • touches protected content (code, quotes, URLs, numbers, placeholders),
//   • would delete or damage a constraint,
//   • removes a negation, or
//   • removes a filler word that is doing real work in its context
//     ("just the code", "not really", "keep it very short").
//
// What survives is ranked, de-duplicated by position, and gated by the chosen
// optimization level.

import type {
  Constraint, OptimizationLevel, ProtectedSpan, Segment, Suggestion,
} from './types.ts'
import type { RawEdit } from './grammar.ts'
import {
  findCapitalizationEdits, findGrammarEdits, findSpellingEdits, findWhitespaceEdits,
} from './grammar.ts'
import {
  findAmbiguity, findDuplicateSegments, findMergeableSentences,
  findRedundantExamples, findRestatedConstraints,
} from './redundancy.ts'
import { ALL_LEXICON_RULES, MEANING_ANCHORS, TONE_WORDS } from './lexicon.ts'
import { buildProtectionMask, maskOverlaps } from './protect.ts'
import { NEGATION_WORDS, countNegations } from './entities.ts'
import { estimateTokens } from './tokens.ts'

const LEVEL_ORDER: Record<OptimizationLevel, number> = { light: 0, balanced: 1, maximum: 2 }

/** True when `level` is at least as aggressive as `minLevel`. */
export function levelAllows(level: OptimizationLevel, minLevel: OptimizationLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel]
}

const NEGATION_SET = new Set(NEGATION_WORDS.map((w) => w.toLowerCase()))

/** Total non-idiomatic negations in a fragment. */
function negationCount(text: string): number {
  let total = 0
  for (const n of countNegations(text).values()) total += n
  return total
}

/** Words around an edit, used by the context vetoes. */
function neighborhood(text: string, start: number, end: number, radius = 40): string {
  return text.slice(Math.max(0, start - radius), Math.min(text.length, end + radius)).toLowerCase()
}

/**
 * Context veto for filler/hedge deletions.
 *
 * "just", "only", "really" and friends flip from noise to signal depending on
 * what sits next to them. Rather than encode dozens of special cases in the
 * lexicon, the decision is made here where the surrounding text is available.
 */
function fillerIsMeaningful(text: string, start: number, end: number): boolean {
  const word = text.slice(start, end).trim().toLowerCase()
  const after = text.slice(end, end + 30).toLowerCase()
  const before = text.slice(Math.max(0, start - 30), start).toLowerCase()

  // "just" meaning "only": "just the code", "just three bullets".
  if (word === 'just' && /^\s*(?:the|a|an|these|those|this|that|\d|one|two|three|four|five)\b/.test(after)) {
    return true
  }
  // Any filler sitting immediately after a negation reverses that negation's
  // scope if removed: "not really", "never simply".
  const lastWord = before.trim().split(/\s+/).pop() || ''
  if (NEGATION_SET.has(lastWord)) return true

  // An intensifier attached to a tone word is part of the constraint:
  // "very concise", "quite formal", "not too detailed".
  const nextWord = (after.trim().split(/\s+/)[0] || '').replace(/[^a-z]/g, '')
  if (TONE_WORDS.has(nextWord)) return true

  // Anything adjacent to an explicit meaning anchor gets the benefit of doubt.
  const ctx = neighborhood(text, start, end, 18)
  for (const anchor of MEANING_ANCHORS) {
    if (new RegExp(`\\b${anchor}\\b`).test(ctx) && ctx.indexOf(anchor) < ctx.length / 2) {
      // Only vetoes when the anchor is genuinely before the word.
      if (word === 'very' || word === 'quite' || word === 'really' || word === 'just') return true
    }
  }
  return false
}

/** Raw edits from the curated lexicon. */
function lexiconEdits(text: string): RawEdit[] {
  const edits: RawEdit[] = []
  for (const r of ALL_LEXICON_RULES) {
    const re = new RegExp(r.pattern.source, r.pattern.flags.includes('g') ? r.pattern.flags : `${r.pattern.flags}g`)
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex += 1; continue }
      edits.push({
        start: m.index,
        end: m.index + m[0].length,
        replacement: r.replacement,
        category: r.category,
        title: r.title,
        reason: r.reason,
        score: r.score,
        minLevel: r.minLevel,
        safe: r.score >= 0.85,
      })
      if (!re.global) break
    }
  }
  return edits
}

export interface GenerateInput {
  text: string
  segments: Segment[]
  constraints: Constraint[]
  protectedSpans: ProtectedSpan[]
  level: OptimizationLevel
  allowProtectedEdits: boolean
  /** Never-remove terms from memory, already folded into `protectedSpans`. */
  memoryTermIds?: Map<string, string>
}

/** Confidence bucket for a numeric score. */
export function bucket(score: number): Suggestion['confidence'] {
  if (score >= 0.85) return 'high'
  if (score >= 0.62) return 'medium'
  return 'low'
}

/**
 * Resolve overlapping edits. Higher score wins; on a tie the longer edit wins
 * (it usually subsumes the shorter one), and advisory items never displace a
 * real edit because they are kept in a separate list.
 */
function resolveOverlaps(edits: RawEdit[]): RawEdit[] {
  const sorted = [...edits].sort(
    (a, b) => b.score - a.score || (b.end - b.start) - (a.end - a.start) || a.start - b.start,
  )
  const kept: RawEdit[] = []
  for (const e of sorted) {
    if (kept.some((k) => e.start < k.end && e.end > k.start)) continue
    kept.push(e)
  }
  return kept.sort((a, b) => a.start - b.start)
}

/**
 * Grow a deletion's range so removing it leaves clean text.
 *
 * A deletion that leaves "Write  a summary", "help me out., I need" or
 * "…200 words.!" behind reads as a bug even when the reduction itself was
 * correct. Three cases are handled here, where the surrounding characters are
 * still available:
 *   • one adjacent space, so words don't collide,
 *   • a comma orphaned at the start of a sentence,
 *   • a terminator orphaned at the end of one.
 */
function tidyDeletionRange(text: string, edit: RawEdit): RawEdit {
  if (edit.replacement !== '') return edit
  let { start, end } = edit

  const atSentenceStart = (pos: number): boolean => {
    const before = text.slice(0, pos).replace(/\s+$/, '')
    return before === '' || /[.!?\n]$/.test(before)
  }

  // Swallow trailing spaces so words don't collide.
  while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end += 1

  // "Hello. Basically, the report…" → removing " Basically" must take the comma
  // with it, or the sentence starts on punctuation.
  if (atSentenceStart(start) && (text[end] === ',' || text[end] === ';')) {
    end += 1
    while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end += 1
  }

  // "…words. Thanks in advance!" → removing the sign-off must take its
  // terminator, or the previous sentence ends ".!".
  if (atSentenceStart(start) && /^[.!?]+/.test(text.slice(end))) {
    end += (text.slice(end).match(/^[.!?]+/) as RegExpMatchArray)[0].length
  }

  // If the removal now abuts punctuation, take the leading space instead so we
  // don't leave " ." behind.
  if (end >= text.length || /[.,;:!?]/.test(text[end])) {
    while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) start -= 1
  }

  return { ...edit, start, end }
}

/** Run every detector and return the suggestions the UI should show. */
export function generateSuggestions(input: GenerateInput): Suggestion[] {
  const { text, segments, constraints, protectedSpans, level, allowProtectedEdits } = input
  if (!text.trim()) return []

  // Two masks, because protection means two different things.
  //
  // HARD kinds (code, quotes, links, placeholders…) must survive character for
  // character — nothing may touch them. SOFT kinds (numbers and dates) are
  // protected so a rewrite cannot *alter* them, but removing a sentence that
  // restates "500 words" for the third time is exactly the saving the user
  // wants, and the validator independently confirms the value still appears.
  // Structural edits therefore check only the hard mask.
  const SOFT: ReadonlySet<ProtectedSpan['kind']> = new Set<ProtectedSpan['kind']>(['number', 'date'])
  const empty = new Uint8Array(0)
  const mask = allowProtectedEdits ? empty : buildProtectionMask(text.length, protectedSpans)
  const hardMask = allowProtectedEdits
    ? empty
    : buildProtectionMask(text.length, protectedSpans.filter((s) => !SOFT.has(s.kind)))

  const STRUCTURAL: ReadonlySet<string> = new Set([
    'repeated-instruction', 'redundant-example', 'sentence-merge',
  ])

  const raw: RawEdit[] = [
    ...findWhitespaceEdits(text),
    ...findSpellingEdits(text),
    ...findGrammarEdits(text),
    ...findCapitalizationEdits(text),
    ...lexiconEdits(text),
    ...findDuplicateSegments(segments, text),
    ...findRestatedConstraints(segments, constraints, text),
    ...findRedundantExamples(segments, text),
    ...findMergeableSentences(segments),
  ]

  const advisory = findAmbiguity(segments)

  const survivors: RawEdit[] = []
  for (const edit of raw) {
    if (edit.end <= edit.start) continue
    if (edit.start < 0 || edit.end > text.length) continue

    // Veto 1 — protected content. Whitespace fixes are exempt because they
    // never alter a token's characters, only the gap between them.
    if (edit.category !== 'whitespace') {
      const applicable = STRUCTURAL.has(edit.category) ? hardMask : mask
      if (maskOverlaps(applicable, edit.start, edit.end)) continue
    }

    const original = text.slice(edit.start, edit.end)
    if (original === edit.replacement) continue

    // Veto 2 — an edit may never reduce the number of negations. This covers
    // deletions AND replacements, so a rewrite cannot quietly drop a "not".
    // Idiomatic negations ("whether or not") are not counted, which is what
    // lets that phrase legitimately shorten to "whether".
    if (negationCount(original) > negationCount(edit.replacement)) continue

    // Veto 3 — never damage a constraint. Duplicate-constraint removals are
    // exempt: they are *about* constraints and the validator re-checks the key.
    const isConstraintAware =
      edit.category === 'repeated-instruction' || edit.category === 'sentence-merge'
    if (!isConstraintAware && edit.replacement === '') {
      const damages = constraints.some((c) => edit.start < c.end && edit.end > c.start)
      if (damages) continue
    }

    // Veto 4 — context makes this filler meaningful.
    if (
      (edit.category === 'filler' || edit.category === 'hedge') &&
      edit.replacement === '' &&
      fillerIsMeaningful(text, edit.start, edit.end)
    ) {
      continue
    }

    survivors.push(tidyDeletionRange(text, edit))
  }

  const resolved = resolveOverlaps(survivors)

  const suggestions: Suggestion[] = resolved
    .filter((e) => levelAllows(level, e.minLevel))
    .map((e, i) => {
      const original = text.slice(e.start, e.end)
      return {
        id: `s${i}-${e.start}-${e.end}`,
        start: e.start,
        end: e.end,
        category: e.category,
        original,
        replacement: e.replacement,
        title: e.title,
        reason: e.reason,
        score: e.score,
        confidence: bucket(e.score),
        minLevel: e.minLevel,
        safe: e.safe,
        tokensSaved: Math.max(0, estimateTokens(original) - estimateTokens(e.replacement)),
      }
    })

  // Advisory notes carry no edit, so they never conflict and are appended last.
  advisory.forEach((a, i) => {
    suggestions.push({
      id: `a${i}-${a.start}-${a.end}`,
      start: a.start,
      end: a.end,
      category: a.category,
      original: text.slice(a.start, a.end),
      replacement: text.slice(a.start, a.end),
      title: a.title,
      reason: a.reason,
      score: a.score,
      confidence: bucket(a.score),
      minLevel: a.minLevel,
      safe: false,
      tokensSaved: 0,
      advisory: true,
    })
  })

  return suggestions.sort((a, b) => a.start - b.start)
}

/**
 * Which suggestions are accepted before the user touches anything.
 *
 * Only `safe` edits at or below the chosen level, and never an advisory note.
 * Low-confidence changes are always presented, never pre-applied — the user
 * stays in control of anything the system is not sure about.
 */
export function defaultAcceptedIds(suggestions: Suggestion[], level: OptimizationLevel): string[] {
  return suggestions
    .filter((s) => !s.advisory && s.safe && s.confidence !== 'low' && levelAllows(level, s.minLevel))
    .map((s) => s.id)
}
