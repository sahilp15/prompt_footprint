// Stage 6 — non-destructive application.
// ---------------------------------------------------------------------------
// The original text is never mutated. Everything the user sees is derived from
// (original, accepted-id set), so accepting, rejecting, undoing, and restoring
// are all just changes to that set — there is no state to get out of sync and
// no way to lose the user's writing.
//
// Applying edits right-to-left keeps every offset valid without bookkeeping.

import type { DiffPart, ProtectedSpan, Suggestion } from './types.ts'

/** Suggestions whose ids are in `accepted`, in document order, non-overlapping. */
export function acceptedEdits(suggestions: Suggestion[], accepted: Set<string>): Suggestion[] {
  const chosen = suggestions
    .filter((s) => !s.advisory && accepted.has(s.id))
    .sort((a, b) => a.start - b.start)

  // Defensive: the generator already resolves overlaps, but a caller could pass
  // an arbitrary id set, and silently producing corrupt text would be worse
  // than dropping the later edit.
  const out: Suggestion[] = []
  for (const s of chosen) {
    const prev = out[out.length - 1]
    if (prev && s.start < prev.end) continue
    out.push(s)
  }
  return out
}

/**
 * The original text with the accepted edits applied.
 *
 * Three passes, each strictly meaning-preserving:
 *   1. splice the accepted replacements in, right to left,
 *   2. repair the seams each deletion left behind (spacing, orphaned
 *      punctuation, a sentence that now starts lowercase),
 *   3. tidy whitespace outside code blocks.
 */
export function applyEdits(original: string, suggestions: Suggestion[], accepted: Set<string>): string {
  const edits = acceptedEdits(suggestions, accepted)
  if (!edits.length) return original

  let out = original
  for (let i = edits.length - 1; i >= 0; i -= 1) {
    const e = edits[i]
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end)
  }

  // Seam offsets in the NEW string, left to right.
  const seams: number[] = []
  let delta = 0
  for (const e of edits) {
    seams.push(e.start + delta)
    delta += e.replacement.length - (e.end - e.start)
  }

  return tidy(repairSeams(out, seams))
}

/**
 * Fix what a removal exposes at its boundary.
 *
 * Scoped to the exact positions text was cut from, so it can never touch
 * writing the user kept. Only spacing, orphaned punctuation, and the case of a
 * newly-exposed sentence opener change — no word is added or removed.
 */
export function repairSeams(text: string, seams: number[]): string {
  if (!seams.length) return text

  // One slot per original character. A slot may become '' (deleted) or gain an
  // inserted prefix; joining at the end reassembles the string.
  const slots: string[] = [...text]

  const prevFilled = (from: number): number => {
    let i = from
    while (i >= 0 && slots[i] === '') i -= 1
    return i
  }
  const nextFilled = (from: number): number => {
    let i = from
    while (i < slots.length && slots[i] === '') i += 1
    return i
  }
  /** The visible character in a slot, ignoring any inserted prefix. */
  const charAt = (i: number): string => (i >= 0 && i < slots.length ? slots[i].slice(-1) : '')
  const isSpace = (c: string): boolean => c === ' ' || c === '\t'

  for (const seam of seams) {
    const at = Math.max(0, Math.min(seam, slots.length))
    if (at >= slots.length) continue

    // 1. Punctuation orphaned by the removal:
    //    "help me out., I need" → "help me out. I need".
    let back = prevFilled(at - 1)
    while (back >= 0 && isSpace(charAt(back))) back = prevFilled(back - 1)
    if (/[.!?]/.test(charAt(back))) {
      let fwd = nextFilled(at)
      while (fwd < slots.length && isSpace(charAt(fwd))) fwd = nextFilled(fwd + 1)
      while (fwd < slots.length && /[,;:.!?]/.test(charAt(fwd))) {
        slots[fwd] = ''
        fwd = nextFilled(fwd + 1)
      }
    }

    // 2. Removing a whole sentence takes its leading space with it, which would
    //    weld the neighbours together: "…climate change.Make it 500 words."
    const after = nextFilled(at)
    if (after < slots.length
      && /[.,;:!?]/.test(charAt(prevFilled(at - 1)))
      && /[A-Za-z0-9]/.test(charAt(after))) {
      slots[after] = ' ' + slots[after]
    }

    // 3. A sentence that now begins lowercase because its opener was removed.
    let k = nextFilled(at)
    while (k < slots.length && /\s/.test(charAt(k))) k = nextFilled(k + 1)
    const opener = charAt(k)
    if (opener && /[a-z]/.test(opener)) {
      let p = prevFilled(k - 1)
      while (p >= 0 && /\s/.test(charAt(p))) p = prevFilled(p - 1)
      // Only at a real sentence boundary, and never on a word followed by "("
      // — that is an identifier or a call, not a sentence.
      const following = slots.slice(k, k + 40).join('')
      if ((p < 0 || /[.!?]/.test(charAt(p))) && !/^[a-z][\w.]*\s*\(/.test(following)) {
        slots[k] = slots[k].slice(0, -1) + opener.toUpperCase()
      }
    }
  }

  return slots.join('')
}

/** Fenced code regions in `text`, so tidying can skip them. */
function fencedRegions(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  const re = /(?:^|\n)[ \t]*(?:```|~~~)[^\n]*\n[\s\S]*?(?:\n[ \t]*(?:```|~~~)[^\n]*|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push({ start: m.index, end: m.index + m[0].length })
  return out
}

/**
 * Clean up whitespace and doubled punctuation.
 *
 * Never removes a word, so it cannot change meaning — and it skips fenced code
 * entirely, because indentation inside a code sample IS the content.
 */
export function tidy(text: string): string {
  const fences = fencedRegions(text)
  if (!fences.length) return tidySegment(text).replace(/^[\s,;:]+/, '').trim()

  // Tidy the prose between fences and leave the fences byte-identical.
  let out = ''
  let cursor = 0
  for (const f of fences) {
    out += tidySegment(text.slice(cursor, f.start))
    out += text.slice(f.start, f.end)
    cursor = f.end
  }
  out += tidySegment(text.slice(cursor))
  return out.replace(/^[\s,;:]+/, '').replace(/\s+$/, '')
}

/**
 * Whitespace/punctuation cleanup that preserves paragraph structure.
 *
 * Terminators are only collapsed when whitespace separates them. Doing it
 * without that guard eats ellipses — `"..."` becomes `".."` — which silently
 * corrupts JSON templates and quoted placeholders. The no-space seam cases
 * ("words.!") are handled precisely in `repairSeams`, where the edit position
 * is known.
 */
function tidySegment(s: string): string {
  return s
    .replace(/(?<=\S)[^\S\n]{2,}/g, ' ')
    .replace(/[^\S\n]+([,.;:!?])/g, '$1')
    .replace(/([,;:])[^\S\n]*([.,;:!?])/g, '$2')
    .replace(/([.!?])[^\S\n]+([.!?])(?![.!?])/g, '$1')
    .replace(/[^\S\n]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
}

/**
 * A part-by-part diff for the comparison view.
 *
 * Built from the edit list rather than by diffing two strings: we already know
 * exactly what changed and why, so every removed/added part can carry the id of
 * the suggestion responsible and the UI can highlight, focus, and toggle it.
 */
export function buildDiff(
  original: string,
  suggestions: Suggestion[],
  accepted: Set<string>,
  protectedSpans: ProtectedSpan[] = [],
): DiffPart[] {
  const edits = acceptedEdits(suggestions, accepted)
  const parts: DiffPart[] = []
  let cursor = 0

  const pushEqual = (from: number, to: number): void => {
    if (to <= from) return
    // Split the untouched run so protected regions can be styled distinctly.
    const spans = protectedSpans
      .filter((p) => p.start < to && p.end > from)
      .sort((a, b) => a.start - b.start)
    let at = from
    for (const p of spans) {
      const lo = Math.max(p.start, at)
      const hi = Math.min(p.end, to)
      if (hi <= lo) continue
      if (lo > at) parts.push({ kind: 'equal', text: original.slice(at, lo) })
      parts.push({ kind: 'protected', text: original.slice(lo, hi) })
      at = hi
    }
    if (at < to) parts.push({ kind: 'equal', text: original.slice(at, to) })
  }

  for (const e of edits) {
    pushEqual(cursor, e.start)
    if (e.original) parts.push({ kind: 'removed', text: e.original, suggestionId: e.id })
    if (e.replacement) parts.push({ kind: 'added', text: e.replacement, suggestionId: e.id })
    cursor = e.end
  }
  pushEqual(cursor, original.length)

  return parts.filter((p) => p.text.length > 0)
}
