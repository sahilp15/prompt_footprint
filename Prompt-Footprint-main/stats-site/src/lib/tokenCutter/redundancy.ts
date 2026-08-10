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
 * Sentences that restate an earlier sentence.
 *
 * Two directions, because repetition runs both ways in real prompts:
 *
 *   • FORWARD — the later sentence adds nothing the earlier one did not say.
 *     The later copy goes, so the prompt keeps its original opening.
 *   • BACKWARD — the later sentence says everything the earlier one did AND
 *     more ("Keep it engaging." … "Keep it engaging for a general audience.").
 *     Here the EARLIER sentence is the redundant one; removing the later would
 *     throw away the extra detail. This case is why a forward-only scan reports
 *     verbose prompts as concise: neither sentence is a plain duplicate of the
 *     other, but one of them is still pure cost.
 *
 * The containment floor is 0.75 rather than 0.8. At 0.8 a single incidental
 * word ("the report" vs "that report") in a six-word restatement drops the
 * score below the line, which is exactly the near-miss that made the old
 * detector quiet on prompts a reader would call obviously repetitive.
 */
export function findDuplicateSegments(
  segments: Segment[],
  text: string,
  // Two content words, not three. "Look for bugs." repeated verbatim is a
  // duplicate by any reading, and a three-word floor was quietly excluding
  // exactly the short imperative sentences prompts repeat most often.
  { threshold = 0.75, minWords = 2 }: RedundancyOptions = {},
): RawEdit[] {
  const edits: RawEdit[] = []
  const candidates = segments.filter(
    (s) => !s.protectedSegment && s.role !== 'meta' && contentWords(s.text).size >= minWords,
  )

  const words = candidates.map((s) => contentWords(s.text))
  const ents = candidates.map((s) => entityKeys(s.text))
  const removed = new Set<number>()

  /** Drop `victim`, keeping `keeper`, with the reason spelled out. */
  const propose = (victim: number, covered: number, mutual: number, backward: boolean): void => {
    const seg = candidates[victim]
    let start = seg.start
    while (start > 0 && /[ \t]/.test(text[start - 1])) start -= 1
    const nearIdentical = covered >= 0.99 && mutual >= 0.6
    removed.add(victim)
    edits.push({
      start,
      end: seg.end,
      replacement: '',
      category: 'repeated-instruction',
      title: 'Repeated instruction',
      reason: backward
        ? 'A later sentence says everything this one says, and more.'
        : mutual >= 0.9
          ? 'This sentence repeats an earlier one almost word for word.'
          : `Everything this sentence says was already said earlier (${Math.round(covered * 100)}% overlap).`,
      // A backward removal is the more surprising edit — it deletes the sentence
      // the user wrote FIRST — so it scores lower and is held back to `maximum`.
      // A plain forward duplicate is offered from `balanced`: dropping a sentence
      // that says nothing new is the definition of what that tier is for, and
      // gating it at `maximum` is a large part of why Balanced used to leave
      // visibly repetitive prompts almost untouched.
      score: nearIdentical ? 0.88 : backward ? 0.72 : 0.76,
      minLevel: backward ? 'maximum' : 'balanced',
      safe: nearIdentical && !backward,
    })
  }

  for (let i = 0; i < candidates.length; i += 1) {
    if (removed.has(i)) continue
    for (let j = i + 1; j < candidates.length; j += 1) {
      if (removed.has(j)) continue

      const forward = containment(words[i], words[j])
      const backward = containment(words[j], words[i])
      const mutual = similarity(words[i], words[j])

      // The later sentence adds nothing: drop it.
      if (forward >= threshold && !hasUniqueEntity(ents[j], ents[i])) {
        propose(j, forward, mutual, false)
        continue
      }
      // The later sentence subsumes the earlier one: drop the earlier one, but
      // only when it contributes no entity of its own and both are the same kind
      // of statement — otherwise "Write a summary." followed by "Write a summary
      // of the Q3 report." would lose the standalone task line it is refining.
      if (
        backward >= 0.95 &&
        candidates[i].role === candidates[j].role &&
        !hasUniqueEntity(ents[i], ents[j]) &&
        words[j].size > words[i].size
      ) {
        propose(i, backward, mutual, true)
        break
      }
    }
  }

  return edits
}

/**
 * Clause-level repetition inside a sentence.
 *
 * "Write a blog post about climate change. The post should be about climate
 * change and around 800 words." is not two duplicate SENTENCES — the second one
 * carries a word limit the first does not — so the sentence-level scan
 * correctly leaves it alone. It is still repetitive, and the repetition is
 * exactly one clause wide.
 *
 * Coordinated clauses are split on `and` / `but` / `;` and each is tested for
 * containment against everything already said. A clause is removable only when
 * it introduces no entity and no constraint of its own, which is what keeps
 * "and around 800 words" — the whole reason the sentence survived — in place.
 */
export function findRedundantClauses(
  segments: Segment[],
  constraints: Constraint[],
  { threshold = 0.9, minWords = 3 }: RedundancyOptions = {},
): RawEdit[] {
  const edits: RawEdit[] = []
  const seen = new Set<string>()
  const seenEntities = new Set<string>()

  const addSeen = (s: string): void => {
    for (const w of contentWords(s)) seen.add(w)
    for (const k of entityKeys(s)) seenEntities.add(k)
  }

  for (const seg of segments) {
    if (seg.protectedSegment || seg.role === 'meta' || seg.role === 'example') { addSeen(seg.text); continue }

    const clauses = splitClauses(seg.text, seg.start)
    if (clauses.length < 2) { addSeen(seg.text); continue }

    for (const clause of clauses) {
      const own = contentWords(clause.text)
      if (own.size < minWords) { addSeen(clause.text); continue }

      const covered = containment(seen, own)
      // An `imperative` entity is minted by the modal ("should be about climate
      // change"), not by the content. When every content word was already said,
      // the modal is the only new thing in the clause — which is what makes it a
      // restatement rather than a new requirement. Negations are never waived.
      const ownEntities = [...entityKeys(clause.text)]
        .filter((k) => !(k.startsWith('imperative|') && covered >= threshold))
      const carriesEntity = ownEntities.some((k) => !seenEntities.has(k))
      // A must/must-not constraint blocks the cut UNLESS the thing it requires is
      // already stated in the surviving text — "the post should be about climate
      // change" after "write a blog post about climate change" adds a constraint
      // key but no requirement. That is the same test the validator applies, so
      // a clause allowed through here cannot fail validation for this reason.
      const carriesConstraint = constraints.some((c) => {
        if (c.start >= clause.end || c.end <= clause.start) return false
        if (c.kind !== 'inclusion' && c.kind !== 'exclusion') return true
        // Constraint keys keep function words that `contentWords` drops, so the
        // comparison has to allow for that — otherwise a single "about" in the
        // key makes a fully-restated requirement look like a new one.
        const words = c.key.split(':').slice(1).join(':').split(' ').filter(Boolean)
        return !words.length || !words.every((w) => seen.has(w) || STOPWORDS.has(w))
      })

      if (covered < threshold || carriesConstraint || carriesEntity) {
        addSeen(clause.text)
        continue
      }

      edits.push({
        start: clause.cutStart,
        end: clause.end,
        replacement: '',
        category: 'repeated-instruction',
        title: 'Repeated context',
        reason: 'This clause repeats something the prompt already said, and adds no new detail.',
        score: 0.78,
        minLevel: 'balanced',
        safe: false,
      })
    }
  }

  return edits
}

interface Clause {
  text: string
  start: number
  end: number
  /** Where the cut begins — includes the conjunction that introduced it. */
  cutStart: number
}

/** Coordinated clauses of a sentence, with the joining word folded into the cut. */
function splitClauses(sentence: string, offset: number): Clause[] {
  const out: Clause[] = []
  const re = /\s*(?:,\s*)?(?:\band\b|\bbut\b|;)\s+/gi
  let cursor = 0
  let m: RegExpExecArray | null
  let joinerStart = -1

  while ((m = re.exec(sentence)) !== null) {
    if (m.index <= cursor) continue
    out.push({
      text: sentence.slice(cursor, m.index),
      start: offset + cursor,
      end: offset + m.index,
      cutStart: offset + (joinerStart >= 0 ? joinerStart : cursor),
    })
    joinerStart = m.index
    cursor = m.index + m[0].length
  }
  if (cursor > 0 && cursor < sentence.length) {
    out.push({
      text: sentence.slice(cursor),
      start: offset + cursor,
      end: offset + sentence.length,
      cutStart: offset + (joinerStart >= 0 ? joinerStart : cursor),
    })
  }
  return out
}

/**
 * A trailing clause that explains WHY the user wants something.
 *
 * "…keep it short, because I would prefer something easier to read" states a
 * preference the instruction before it already encodes. Justifications are
 * meta-commentary: they change nothing about the output, and they are among the
 * most reliable large savings in a conversational prompt.
 *
 * Removed only when the clause carries no constraint, no entity the prompt does
 * not already have, and no negation — so "because I must not exceed 500 words"
 * and "because the client is Northwind" both survive untouched.
 */
export function findRedundantJustifications(
  segments: Segment[],
  constraints: Constraint[],
  text: string,
): RawEdit[] {
  const edits: RawEdit[] = []
  const JUSTIFICATION = /[,;]?\s+(?:because|since|as|given that)\s+(?:i|we)\s+(?:would |'?d |just |really )*(?:prefer|like|want|need|find|think|feel)\b/i

  for (const seg of segments) {
    if (seg.protectedSegment || seg.role === 'example') continue
    const m = JUSTIFICATION.exec(seg.text)
    if (!m) continue

    const start = seg.start + m.index
    const body = seg.text.slice(m.index).replace(/[.!?]+\s*$/, '')
    // Keep the sentence's terminator; only the clause goes.
    const end = seg.start + m.index + body.length
    if (end <= start) continue

    if (constraints.some((c) => c.start < end && c.end > start)) continue
    if (/\b(?:not|never|no|without|must|only|except|unless)\b/i.test(body)) continue

    const before = text.slice(0, start)
    const known = entityKeys(before)
    if ([...entityKeys(body)].some((k) => !known.has(k))) continue

    edits.push({
      start,
      end,
      replacement: '',
      category: 'meta-commentary',
      title: 'Stated preference',
      reason: 'Explaining why you want it does not change what the model produces — the instruction already does.',
      score: 0.74,
      minLevel: 'balanced',
      safe: false,
    })
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
    if (aWords > 16 || bWords > 16) continue

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
 * Consecutive instructions that repeat the same verb phrase.
 *
 * "Look for bugs. Look for performance issues. Look for security issues." says
 * the verb three times to carry three objects. Folding them into one list keeps
 * every object — which is where all the information is — and drops the repeats.
 *
 * This is the transform that gives Maximum its character: it does not delete
 * anything the user asked for, it states it once. Guarded hard, because a bad
 * merge is a bad prompt: identical verb phrase, no negation anywhere in the run
 * (merging "Do not X" with "Do not Y" would change one prohibition into two
 * under a single scope), no protected content, and short objects only.
 */
export function findParallelImperatives(segments: Segment[]): RawEdit[] {
  const edits: RawEdit[] = []
  const NEGATED = /\b(?:not|never|no|without|except|unless|avoid)\b/i

  /** Leading verb phrase (1–3 words) and its object, for a plain imperative. */
  const split = (raw: string): { verb: string; object: string } | null => {
    const body = raw.trim().replace(/[.!?]+$/, '').trim()
    if (!body || NEGATED.test(body)) return null
    const m = /^([A-Za-z]+(?:\s+(?:for|at|to|on|out|up|about|through|into))?(?:\s+the)?)\s+(.{2,60})$/.exec(body)
    if (!m) return null
    const object = m[2].trim()
    if (object.split(/\s+/).length > 6) return null
    if (/[,;:]/.test(object)) return null
    return { verb: m[1].trim(), object }
  }

  let i = 0
  while (i < segments.length - 1) {
    const first = segments[i]
    const head = first.protectedSegment ? null : split(first.text)
    if (!head) { i += 1; continue }

    const run = [first]
    const objects = [head.object]
    let j = i + 1
    while (j < segments.length) {
      const next = segments[j]
      if (next.protectedSegment || next.blockIndex !== first.blockIndex || next.role !== first.role) break
      const part = split(next.text)
      if (!part || part.verb.toLowerCase() !== head.verb.toLowerCase()) break
      run.push(next)
      objects.push(part.object)
      j += 1
    }

    if (run.length < 2) { i += 1; continue }

    const last = objects.pop() as string
    // Two objects take no comma ("A and B"); three or more take the serial one.
    const merged = objects.length === 1
      ? `${head.verb} ${objects[0]} and ${last}.`
      : `${head.verb} ${objects.join(', ')}, and ${last}.`
    const end = run[run.length - 1].end
    const span = run.reduce((n, s) => n + (s.end - s.start), 0)
    if (merged.length < span) {
      edits.push({
        start: first.start,
        end,
        replacement: merged,
        category: 'sentence-merge',
        title: 'Merged parallel instructions',
        reason: `“${head.verb}” is repeated ${run.length} times for ${run.length} things. One list says the same.`,
        score: 0.7,
        minLevel: 'maximum',
        safe: false,
      })
    }
    i = j
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
