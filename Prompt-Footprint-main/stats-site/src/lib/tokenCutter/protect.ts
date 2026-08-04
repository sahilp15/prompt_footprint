// Stage 1 — text protection.
// ---------------------------------------------------------------------------
// Before anything is allowed to propose a deletion, we work out which parts of
// the prompt are off-limits. A prompt is not prose: it routinely carries code,
// JSON, URLs, exact wording the model must reproduce, and placeholders that a
// template engine will fill in later. Rewriting any of those is not "shorter",
// it is broken.
//
// Everything downstream consults the mask this stage produces, so a span
// registered here can never be edited unless the user explicitly opts in via
// `allowProtectedEdits`.
//
// Order matters: code fences are claimed first and later scanners skip anything
// already claimed, so a URL inside a code block stays a code block.
//
// Performance: claiming is tracked with a byte mask rather than by scanning the
// span list, so the whole stage is O(text length) regardless of how many
// numbers, links, or quotes a prompt contains.

import type { ProtectedKind, ProtectedSpan, Range } from './types.ts'

interface Scanner {
  kind: ProtectedKind
  reason: string
  pattern: RegExp
  /** Strip this leading pattern from the match before claiming it. */
  trimLead?: RegExp
}

const SCANNERS: Scanner[] = [
  {
    kind: 'code-block',
    reason: 'Fenced code block — kept exactly as written',
    pattern: /(?:^|\n)[ \t]*(?:```|~~~)[^\n]*\n[\s\S]*?(?:\n[ \t]*(?:```|~~~)[^\n]*|$)/g,
    trimLead: /^\n/,
  },
  {
    kind: 'code-block',
    reason: 'Indented code block — kept exactly as written',
    pattern: /(?:^|\n)(?:(?:[ ]{4}|\t)[^\n]*(?:\n|$)){2,}/g,
    trimLead: /^\n/,
  },
  {
    kind: 'inline-code',
    reason: 'Inline code — kept exactly as written',
    pattern: /`[^`\n]+`/g,
  },
  {
    kind: 'markdown',
    reason: 'Markdown link — label and target kept together',
    pattern: /!?\[[^\]\n]*\]\([^)\s]+(?:\s+"[^"]*")?\)/g,
  },
  {
    kind: 'url',
    reason: 'Link — must resolve to the same address',
    pattern: /\bhttps?:\/\/[^\s<>()[\]{}"']+/g,
  },
  {
    kind: 'url',
    reason: 'Link — must resolve to the same address',
    pattern: /\bwww\.[^\s<>()[\]{}"']+\.[a-z]{2,}/gi,
  },
  {
    kind: 'email',
    reason: 'Email address — kept exactly as written',
    pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,
  },
  {
    kind: 'placeholder',
    reason: 'Template placeholder — filled in later, must not be reworded',
    pattern:
      /\{\{[^{}\n]{1,80}\}\}|\{[A-Za-z_][\w .-]{0,60}\}|<\/?[A-Za-z_][\w .:-]{0,60}>|\[[A-Z][A-Z0-9_ -]{1,40}\]|\$\{[^}\n]{1,60}\}|\$[A-Z_][A-Z0-9_]{1,40}|%[sdif]\b/g,
  },
  {
    kind: 'math',
    reason: 'Mathematical expression — kept exactly as written',
    pattern: /\$\$[\s\S]*?\$\$|\$[^$\n]{1,120}\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g,
  },
  {
    kind: 'quote',
    reason: 'Quoted text — exact wording must be preserved',
    pattern: /"[^"\n]{2,400}"|“[^”\n]{2,400}”|«[^»\n]{2,400}»/g,
  },
  {
    kind: 'file-path',
    reason: 'File path or filename — kept exactly as written',
    pattern:
      /\b(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,8}\b|\b[\w-]+\.(?:jsx?|tsx?|py|rb|go|rs|java|cpp|cs|php|sh|sql|json|ya?ml|toml|md|txt|csv|pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|svg|webp|zip|tar|gz|env|html?|css|scss)\b/gi,
  },
  {
    kind: 'date',
    reason: 'Date — must not shift',
    pattern:
      /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?(?:,?\s+\d{4})?\b/gi,
  },
  {
    kind: 'number',
    reason: 'Number — must not change',
    pattern:
      /\b\d[\d,]*(?:\.\d+)?(?:\s?(?:%|kb|mb|gb|tb|ms|sec(?:onds?)?|min(?:utes?)?|hours?|days?|weeks?|months?|years?|px|em|rem|words?|characters?|chars?|tokens?|items?|bullets?|paragraphs?|sentences?|pages?|lines?|steps?|rows?|columns?))?/gi,
  },
]

/**
 * Balanced-brace JSON detection. A regex cannot match nested braces, and the
 * naive lazy version silently truncates nested objects — so this walks the
 * string instead. Only regions that actually contain a `"key":` pair count, so
 * ordinary prose braces are left alone.
 */
function findJsonSpans(text: string): Range[] {
  const out: Range[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch !== '{' && ch !== '[') { i += 1; continue }
    const open = ch
    const close = open === '{' ? '}' : ']'
    let depth = 0
    let inString = false
    let escaped = false
    let j = i
    for (; j < text.length; j += 1) {
      const c = text[j]
      if (escaped) { escaped = false; continue }
      if (c === '\\') { escaped = true; continue }
      if (c === '"') { inString = !inString; continue }
      if (inString) continue
      if (c === open) depth += 1
      else if (c === close) {
        depth -= 1
        if (depth === 0) break
      }
    }
    if (depth !== 0 || j >= text.length) { i += 1; continue }
    const candidate = text.slice(i, j + 1)
    // Require a quoted key so `{some thought}` in prose isn't treated as data.
    if (/"[^"\n]+"\s*:/.test(candidate)) {
      out.push({ start: i, end: j + 1 })
      i = j + 1
    } else {
      i += 1
    }
  }
  return out
}

/**
 * Find every region of `text` that must not be rewritten.
 *
 * `neverRemoveTerms` comes from user memory; each is matched case-insensitively
 * on word boundaries and protected in place.
 */
export function findProtectedSpans(text: string, neverRemoveTerms: string[] = []): ProtectedSpan[] {
  if (!text) return []

  const claimedMask = new Uint8Array(text.length)
  const spans: ProtectedSpan[] = []

  const isFree = (start: number, end: number): boolean => {
    for (let i = start; i < end; i += 1) if (claimedMask[i]) return false
    return true
  }

  const claim = (start: number, end: number, kind: ProtectedKind, reason: string): void => {
    if (end <= start || start < 0 || end > text.length) return
    if (!isFree(start, end)) return
    claimedMask.fill(1, start, end)
    spans.push({ start, end, kind, text: text.slice(start, end), reason })
  }

  // JSON first: it is the only structure whose extent regexes get wrong.
  for (const r of findJsonSpans(text)) {
    claim(r.start, r.end, 'json', 'JSON structure — keys and values must survive verbatim')
  }

  for (const scanner of SCANNERS) {
    const re = new RegExp(scanner.pattern.source, scanner.pattern.flags)
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex += 1; continue }
      let start = m.index
      let raw = m[0]
      if (scanner.trimLead) {
        const stripped = raw.replace(scanner.trimLead, '')
        start += raw.length - stripped.length
        raw = stripped
      }
      // Trailing whitespace is not part of the protected content.
      const trailing = raw.length - raw.replace(/\s+$/, '').length
      claim(start, start + raw.length - trailing, scanner.kind, scanner.reason)
    }
  }

  for (const term of neverRemoveTerms) {
    const trimmed = term.trim()
    if (trimmed.length < 2) continue
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'gi')
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex += 1; continue }
      claim(m.index, m.index + m[0].length, 'memory-term', `“${trimmed}” is on your never-remove list`)
    }
  }

  spans.sort((a, b) => a.start - b.start)
  return spans
}

/**
 * A byte mask of protected positions. Detectors call this once and then answer
 * "may I edit here?" in O(edit length) instead of O(span count).
 */
export function buildProtectionMask(length: number, spans: ProtectedSpan[]): Uint8Array {
  const mask = new Uint8Array(Math.max(0, length))
  for (const s of spans) {
    const lo = Math.max(0, s.start)
    const hi = Math.min(s.end, mask.length)
    if (hi > lo) mask.fill(1, lo, hi)
  }
  return mask
}

/** True when any character in `[start, end)` is protected. */
export function maskOverlaps(mask: Uint8Array, start: number, end: number): boolean {
  const hi = Math.min(end, mask.length)
  for (let i = Math.max(0, start); i < hi; i += 1) if (mask[i]) return true
  return false
}

/** True when `[start, end)` touches any protected span. */
export function overlapsProtected(spans: ProtectedSpan[], range: Range): boolean {
  return spans.some((s) => range.start < s.end && range.end > s.start)
}
/** Distinct protected fragments, for the "protected terms" statistic. */
export function countProtectedTerms(spans: ProtectedSpan[]): number {
  return new Set(spans.map((s) => s.text.trim().toLowerCase())).size
}
