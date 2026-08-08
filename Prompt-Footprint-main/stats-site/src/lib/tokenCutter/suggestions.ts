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
  Constraint, OptimizationLevel, ProtectedSpan, Segment, Suggestion, TargetModel,
} from './types.ts'
import type { RawEdit } from './grammar.ts'
import {
  findCapitalizationEdits, findGrammarEdits, findRequestPunctuation, findSpellingEdits,
  findWhitespaceEdits,
} from './grammar.ts'
import {
  findAmbiguity, findDuplicateSegments, findMergeableSentences, findParallelImperatives,
  findRedundantClauses, findRedundantExamples, findRedundantJustifications,
  findRestatedConstraints,
} from './redundancy.ts'
import {
  ALL_LEXICON_RULES, CONSTRAINT_AWARE_CATEGORIES, MEANING_ANCHORS, TONE_WORDS,
} from './lexicon.ts'
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

  // An explicit meaning anchor IMMEDIATELY around the word makes it load-bearing
  // ("not just the summary", "only very short answers").
  //
  // This used to scan a 36-character window, which meant any "not" anywhere in
  // the clause vetoed every intensifier after it: "do not give me a really long
  // response" kept "really" because of a "not" five words earlier. The window is
  // now one word on each side, which is the case the rule was written for.
  if (word === 'very' || word === 'quite' || word === 'really' || word === 'just') {
    const prevWords = before.trim().split(/\s+/)
    const nextWords = after.trim().split(/\s+/)
    const adjacent = [prevWords[prevWords.length - 1] || '', nextWords[0] || '']
      .map((w) => w.replace(/[^a-z']/g, ''))
    if (adjacent.some((w) => MEANING_ANCHORS.has(w))) return true
  }
  return false
}

/** Raw edits from the curated lexicon. */
function lexiconEdits(text: string): RawEdit[] {
  const edits: RawEdit[] = []
  for (const r of ALL_LEXICON_RULES) {
    const re = new RegExp(r.pattern.source, r.pattern.flags.includes('g') ? r.pattern.flags : `${r.pattern.flags}g`)
    // A rule may keep part of what it matched ("very important" -> "important").
    // Expanding the reference against the matched text — rather than against the
    // whole prompt — keeps the edit local and its offsets exact.
    const expand = r.replacement.includes('$')
      ? new RegExp(r.pattern.source, r.pattern.flags.replace(/g/g, ''))
      : null
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex += 1; continue }
      edits.push({
        start: m.index,
        end: m.index + m[0].length,
        replacement: expand ? m[0].replace(expand, r.replacement) : r.replacement,
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
    'repeated-instruction', 'redundant-example', 'sentence-merge', 'meta-commentary',
  ])

  const raw: RawEdit[] = [
    ...findWhitespaceEdits(text),
    ...findSpellingEdits(text),
    ...findGrammarEdits(text),
    ...findCapitalizationEdits(text),
    ...findRequestPunctuation(text),
    ...lexiconEdits(text),
    ...findDuplicateSegments(segments, text),
    ...findRedundantClauses(segments, constraints),
    ...findRedundantJustifications(segments, constraints, text),
    ...findRestatedConstraints(segments, constraints, text),
    ...findRedundantExamples(segments, text),
    ...findMergeableSentences(segments),
    ...findParallelImperatives(segments),
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

    // Veto 3 — never damage a constraint. Deduplication and wrapper collapse are
    // exempt: they are *about* constraints, they leave the payload in place, and
    // the validator re-checks the key afterwards.
    const isConstraintAware = CONSTRAINT_AWARE_CATEGORIES.has(edit.category)
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
 * Confidence floor for auto-applying an edit, per level.
 *
 * This is the single number that decides how aggressive the optimizer is, and
 * the old policy — "apply only edits scoring ≥ 0.85" at every level — is why
 * Balanced and Maximum produced nearly identical, nearly unchanged text. The
 * detectors were finding the repetition and the wrappers; the acceptance rule
 * was throwing almost all of it away, and the result was reported as "Already
 * concise".
 *
 * Being aggressive here is safe because it is not the last word: everything
 * applied is re-checked by the validator against the original, and any edit
 * that actually lost information is rolled back individually.
 */
const ACCEPT_FLOOR: Record<OptimizationLevel, number> = {
  light: 0.85,      // only what cannot change meaning at all
  balanced: 0.7,    // strong compression, still natural to read
  maximum: 0.55,    // everything the detectors are more than half sure of
}

/**
 * Model-awareness, and the only place the target model influences anything.
 *
 * A dense, telegraphic prompt is read correctly by a current frontier model and
 * is a real risk with one we cannot identify — so an unrecognised or efficiency
 * -tier target keeps a little more explicit structure by holding the two
 * *rewriting* categories (sentence merging, wrapper collapse) to a higher bar.
 * Deletions of filler and repetition are unaffected: those do not make a prompt
 * harder to read for anyone.
 */
function floorFor(
  suggestion: Suggestion,
  level: OptimizationLevel,
  target: TargetModel | null | undefined,
): number {
  const base = ACCEPT_FLOOR[level]
  const restructures = suggestion.category === 'sentence-merge' ||
    suggestion.category === 'instruction-collapse'
  // Light already refuses everything not marked meaning-preserving, so there is
  // nothing left for the model nudge to protect against — applying it there only
  // made Light quieter than it was before.
  if (!restructures || level === 'light') return base
  // A nudge, not a veto. Making the unknown-model case a hard 0.8 floor would
  // mean the chosen level stopped deciding anything for these categories, which
  // is not what "consider the target model" should buy: the user picked Maximum,
  // and an unidentified model is a reason to be slightly choosier, not to
  // silently behave like Light.
  if (!target || !target.known) return base + 0.08
  if (target.tier === 'efficient') return base + 0.05
  return base
}

export interface DefaultAcceptOptions {
  targetModel?: TargetModel | null
}

/**
 * Which suggestions are accepted before the user touches anything.
 *
 * Advisory notes never are — they carry no edit. Everything else is judged on
 * its score against the level's floor.
 */
export function defaultAcceptedIds(
  suggestions: Suggestion[],
  level: OptimizationLevel,
  options: DefaultAcceptOptions = {},
): string[] {
  return suggestions
    .filter((s) => {
      if (s.advisory) return false
      if (!levelAllows(level, s.minLevel)) return false
      // Light is the "keep my voice" tier: it applies only edits the rule set
      // marks as unable to change meaning, regardless of score.
      if (level === 'light' && !s.safe) return false
      return s.score >= floorFor(s, level, options.targetModel)
    })
    .map((s) => s.id)
}
