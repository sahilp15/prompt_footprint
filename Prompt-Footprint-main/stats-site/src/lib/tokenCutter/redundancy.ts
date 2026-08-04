// Stage 4b — redundancy detection.
// ---------------------------------------------------------------------------
// The largest safe savings in a real prompt are not individual words: they are
// the instruction the author gave twice, the constraint restated three
// paragraphs later, and the second example that teaches nothing the first one
// did not.
//
// Detection is similarity-based rather than exact-match, because people restate
// things in different words. Two sentences are near-duplicates when their
// content-word sets overlap heavily AND neither adds an entity the other lacks
// — that second condition is what stops "summarize in 3 bullets" and
// "summarize in 5 bullets" being treated as the same instruction.

import type { Constraint, Segment } from './types.ts'
import type { RawEdit } from './grammar.ts'
import { extractEntities } from './entities.ts'

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'so', 'as', 'of', 'to', 'in', 'on', 'at',
  'for', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'can', 'could', 'should',
  'shall', 'may', 'might', 'must', 'i', 'me', 'my', 'you', 'your', 'we', 'our', 'it', 'its',
  'this', 'that', 'these', 'those', 'there', 'here', 'please', 'also', 'just', 'very',
  'really', 'about', 'into', 'over', 'under', 'than', 'too', 'more', 'most', 'some', 'any',
])

/** Content words of a sentence, lower-cased and de-duplicated. */
export function contentWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s'-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  return new Set(words)
}

/** Jaccard similarity of two word sets: |A ∩ B| / |A ∪ B|. */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let shared = 0
  for (const w of a) if (b.has(w)) shared += 1
  return shared / (a.size + b.size - shared)
}

/**
 * How much of `inner` is already contained in `outer`: |A ∩ B| / |B|.
 *
 * This, not Jaccard, is the redundancy signal. "Write a blog post about climate
 * change" followed by "The post should be about climate change" scores only
 * 0.6 on Jaccard — the first sentence is simply longer — but the second adds no
 * word the first did not, which is precisely what makes it a repeat.
 */
export function containment(outer: Set<string>, inner: Set<string>): number {
  if (!inner.size) return 0
  let shared = 0
  for (const w of inner) if (outer.has(w)) shared += 1
  return shared / inner.size
}

/** Entity keys a segment carries — used to veto a "duplicate" that isn't one. */
function entityKeys(text: string): Set<string> {
  return new Set(extractEntities(text).map((e) => `${e.kind}|${e.key}`))
}

function hasUniqueEntity(a: Set<string>, b: Set<string>): boolean {
  for (const k of a) if (!b.has(k)) return true
  return false
}

export interface RedundancyOptions {
  /** Minimum Jaccard overlap to call two sentences duplicates. */
  threshold?: number
  /** Ignore sentences shorter than this (in content words). */
  minWords?: number
}

/**
 * Sentences that restate an earlier sentence. The *later* occurrence is
 * proposed for removal so the prompt keeps its original opening.
 */
export function findDuplicateSegments(
  segments: Segment[],
  text: string,
  { threshold = 0.8, minWords = 3 }: RedundancyOptions = {},
): RawEdit[] {
  const edits: RawEdit[] = []
  const candidates = segments.filter(
    (s) => !s.protectedSegment && s.role !== 'meta' && contentWords(s.text).size >= minWords,
  )

  const words = candidates.map((s) => contentWords(s.text))
  const ents = candidates.map((s) => entityKeys(s.text))
  const removed = new Set<number>()

  for (let i = 0; i < candidates.length; i += 1) {
    if (removed.has(i)) continue
    for (let j = i + 1; j < candidates.length; j += 1) {
      if (removed.has(j)) continue

      const covered = containment(words[i], words[j])
      if (covered < threshold) continue
      // If the later sentence carries information the earlier one does not,
      // it is a refinement, not a repeat. Leave it alone.
      if (hasUniqueEntity(ents[j], ents[i])) continue

      const mutual = similarity(words[i], words[j])
      const nearIdentical = covered >= 0.99 && mutual >= 0.6

      const later = candidates[j]
      // Swallow the whitespace in front so removal doesn't leave a double space.
      let start = later.start
      while (start > 0 && /[ \t]/.test(text[start - 1])) start -= 1

      removed.add(j)
      edits.push({
        start,
        end: later.end,
        replacement: '',
        category: 'repeated-instruction',
        title: 'Repeated instruction',
        reason:
          mutual >= 0.9
            ? 'This sentence repeats an earlier one almost word for word.'
            : `Everything this sentence says was already said earlier (${Math.round(covered * 100)}% overlap).`,
        score: nearIdentical ? 0.88 : 0.76,
        minLevel: nearIdentical ? 'balanced' : 'maximum',
        safe: nearIdentical,
      })
    }
  }

  return edits
}

/**
 * Sentences that exist only to restate requirements already given.
 *
 * Deliberately operates on whole sentences rather than on the constraint
 * fragment. Cutting "500 words" out of "Remember to keep it 500 words and
 * friendly" leaves "Remember to keep it and friendly" — fewer tokens and
 * broken English. Either the whole restatement goes or nothing does.
 *
 * A sentence qualifies when every constraint it states was already stated
 * earlier AND it introduces no entity the earlier text did not have, so the
 * prompt loses nothing by dropping it. The validator re-checks that afterwards.
 */
export function findRestatedConstraints(
  segments: Segment[],
  constraints: Constraint[],
  text: string,
): RawEdit[] {
  const edits: RawEdit[] = []
  const seenConstraintKeys = new Set<string>()
  const seenEntityKeys = new Set<string>()

  for (const seg of segments) {
    const own = constraints.filter((c) => c.start >= seg.start && c.end <= seg.end)
    const ownKeys = new Set(own.map((c) => c.key))
    const ownEntities = entityKeys(seg.text)

    const isRestatement =
      !seg.protectedSegment &&
      seg.role !== 'meta' &&
      ownKeys.size > 0 &&
      [...ownKeys].every((k) => seenConstraintKeys.has(k)) &&
      ![...ownEntities].some((k) => !seenEntityKeys.has(k))

    if (isRestatement) {
      let start = seg.start
      while (start > 0 && /[ \t]/.test(text[start - 1])) start -= 1
      const stated = own.map((c) => `“${c.text.trim()}”`)
      edits.push({
        start,
        end: seg.end,
        replacement: '',
        category: 'repeated-instruction',
        title: 'Repeated constraint',
        reason:
          stated.length === 1
            ? `${stated[0]} was already stated earlier in the prompt.`
            : `${stated.join(' and ')} were already stated earlier in the prompt.`,
        score: 0.86,
        minLevel: 'balanced',
        safe: true,
      })
      // A dropped sentence contributes nothing to what counts as "already seen".
      continue
    }

    for (const k of ownKeys) seenConstraintKeys.add(k)
    for (const k of ownEntities) seenEntityKeys.add(k)
  }

  return edits
}

/**
 * Examples beyond the first that demonstrate the same shape.
 *
 * Examples are the most dangerous thing to cut — one example often *is* the
 * spec for the output format — so this only fires from the third example on,
 * only when the extras are structurally similar to the first, and never at the
 * `light` level.
 */
export function findRedundantExamples(segments: Segment[], text: string): RawEdit[] {
  const examples = segments.filter((s) => s.role === 'example' && !s.protectedSegment)
  if (examples.length < 3) return []

  const first = contentWords(examples[0].text)
  const edits: RawEdit[] = []

  for (const ex of examples.slice(2)) {
    const sim = similarity(first, contentWords(ex.text))
    if (sim < 0.4) continue
    let start = ex.start
    while (start > 0 && /\s/.test(text[start - 1])) start -= 1
    edits.push({
      start,
      end: ex.end,
      replacement: '',
      category: 'redundant-example',
      title: 'Redundant example',
      reason: 'Two earlier examples already show this pattern. A third rarely changes the output.',
      score: 0.6,
      minLevel: 'maximum',
      safe: false,
    })
  }
  return edits
}

/**
 * Consecutive short sentences that share a subject and could be one sentence.
 * Advisory only — merging is a judgement call, so it is surfaced rather than
 * applied, and the suggested replacement is shown for the user to accept.
 */
export function findMergeableSentences(segments: Segment[]): RawEdit[] {
  const edits: RawEdit[] = []

  for (let i = 0; i < segments.length - 1; i += 1) {
    const a = segments[i]
    const b = segments[i + 1]
    if (a.protectedSegment || b.protectedSegment) continue
    if (a.blockIndex !== b.blockIndex) continue
    if (a.role !== b.role) continue
    if (a.role !== 'constraint' && a.role !== 'format') continue

    const aWords = a.text.trim().split(/\s+/).length
    const bWords = b.text.trim().split(/\s+/).length
    if (aWords > 12 || bWords > 12) continue

    const aBody = a.text.trim().replace(/[.!?]+$/, '')
    const bBody = b.text.trim().replace(/^\s*(?:also|and|additionally)[,\s]+/i, '')
    const bTail = bBody.charAt(0).toLowerCase() + bBody.slice(1)
    const merged = `${aBody}, and ${bTail}`
    // Only worth offering when it actually saves something.
    if (merged.length >= a.text.length + b.text.length) continue

    edits.push({
      start: a.start,
      end: b.end,
      replacement: merged,
      category: 'sentence-merge',
      title: 'Safe sentence combination',
      reason: 'Two short requirements of the same kind read as one sentence and cost fewer tokens.',
      score: 0.66,
      minLevel: 'maximum',
      safe: false,
    })
    i += 1 // don't chain a merge into the next pair
  }

  return edits
}

/**
 * Sentences vague enough that shortening them would make the prompt ambiguous.
 * Reported as advice, never as an edit — the fix is the user's to make.
 */
export function findAmbiguity(segments: Segment[]): RawEdit[] {
  const edits: RawEdit[] = []
  const VAGUE = /\b(?:it|this|that|they|them|these|those)\b/gi

  for (const s of segments) {
    if (s.protectedSegment) continue
    const body = s.text.trim()
    if (body.split(/\s+/).length < 5) continue

    // A sentence that opens on an unanchored pronoun.
    if (/^\s*(?:it|this|that|they|these|those)\b/i.test(body)) {
      edits.push({
        start: s.start, end: s.end, replacement: s.text,
        category: 'ambiguous', title: 'Ambiguous wording',
        reason: 'This sentence opens on a pronoun with no clear referent. Naming the thing avoids a guess.',
        score: 0.5, minLevel: 'light', safe: false, advisory: true,
      })
      continue
    }

    const vagueCount = (body.match(VAGUE) || []).length
    if (vagueCount >= 4 && body.split(/\s+/).length < 40) {
      edits.push({
        start: s.start, end: s.end, replacement: s.text,
        category: 'ambiguous', title: 'Ambiguous wording',
        reason: `This sentence leans on ${vagueCount} pronouns. Shortening it further would make it unclear.`,
        score: 0.45, minLevel: 'light', safe: false, advisory: true,
      })
    }
  }

  return edits
}
