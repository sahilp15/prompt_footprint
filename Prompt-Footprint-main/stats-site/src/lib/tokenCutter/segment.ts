// Stage 2 — segmentation and prompt-structure analysis.
// ---------------------------------------------------------------------------
// A prompt is not a paragraph of prose; it is a small document with parts. The
// cutter has to know which part it is looking at before it decides what is safe
// to remove: a hedge inside a constraint ("keep it *fairly* short") carries
// meaning, the same hedge inside a greeting does not.
//
// Two passes:
//   1. Blocks   — paragraphs, list items, headings, code. Never split a fence.
//   2. Segments — sentences inside each non-code block, with absolute offsets
//                 back into the original text, then classified into a role.
//
// All offsets are into the ORIGINAL string. Nothing here mutates text.

import type { Block, ProtectedSpan, Segment, SegmentRole } from './types.ts'
import { overlapsProtected } from './protect.ts'

/** Blocks are separated by blank lines; list items and headings stand alone. */
export function splitBlocks(text: string, protectedSpans: ProtectedSpan[] = []): Block[] {
  const blocks: Block[] = []
  if (!text) return blocks

  const codeSpans = protectedSpans.filter((s) => s.kind === 'code-block' || s.kind === 'json')
  const inCode = (pos: number): ProtectedSpan | undefined =>
    codeSpans.find((s) => pos >= s.start && pos < s.end)

  const lines: { text: string; start: number }[] = []
  let cursor = 0
  for (const line of text.split('\n')) {
    lines.push({ text: line, start: cursor })
    cursor += line.length + 1
  }

  let buffer: { text: string; start: number }[] = []

  const flush = (): void => {
    if (!buffer.length) return
    const start = buffer[0].start
    const last = buffer[buffer.length - 1]
    const end = last.start + last.text.length
    const raw = text.slice(start, end)
    if (raw.trim()) {
      blocks.push({ start, end, text: raw, kind: classifyBlock(raw) })
    }
    buffer = []
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const code = inCode(line.start)
    if (code) {
      flush()
      // Emit the whole protected block at once and skip past it.
      blocks.push({ start: code.start, end: code.end, text: text.slice(code.start, code.end), kind: 'code' })
      while (i + 1 < lines.length && lines[i + 1].start < code.end) i += 1
      continue
    }
    if (!line.text.trim()) { flush(); continue }
    // A new list item or heading always starts its own block.
    if (buffer.length && /^\s*(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s+|>\s+)/.test(line.text)) flush()
    buffer.push(line)
  }
  flush()

  return blocks
}

function classifyBlock(raw: string): Block['kind'] {
  const t = raw.trimStart()
  if (/^#{1,6}\s+/.test(t)) return 'heading'
  if (/^(?:[-*+]\s+|\d+[.)]\s+)/.test(t)) return 'list-item'
  if (!raw.trim()) return 'blank'
  return 'paragraph'
}

// Sentence boundary: terminal punctuation, optional closer, then whitespace and
// something that looks like a new sentence. Abbreviations are excluded so
// "e.g. this" and "Dr. Chen" don't split.
const ABBREVIATIONS = new Set([
  'e.g', 'i.e', 'etc', 'vs', 'approx', 'dr', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr',
  'st', 'no', 'fig', 'al', 'inc', 'ltd', 'co', 'dept', 'est', 'min', 'max',
])

function isAbbreviation(text: string, dotIndex: number): boolean {
  let i = dotIndex - 1
  while (i >= 0 && /[A-Za-z.]/.test(text[i])) i -= 1
  const word = text.slice(i + 1, dotIndex).toLowerCase()
  if (!word) return false
  if (ABBREVIATIONS.has(word)) return true
  // Single initials: "J. Smith".
  return word.length === 1
}

/** Split one block into sentences, returning absolute offsets. */
function splitSentences(text: string, blockStart: number, blockEnd: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  let start = blockStart
  for (let i = blockStart; i < blockEnd; i += 1) {
    const ch = text[i]
    if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== '\n') continue
    if (ch === '.' && isAbbreviation(text, i)) continue
    if (ch === '\n') {
      // A hard line break inside a block ends a segment only if the next line
      // starts a new thought (bullet, capital, digit).
      if (!/^\s*(?:[-*+]\s|\d+[.)]\s|[A-Z0-9])/.test(text.slice(i + 1, i + 6))) continue
      if (i + 1 >= blockEnd) continue
    }
    let end = i + 1
    // Absorb the closing quote/bracket and any repeated terminators.
    while (end < blockEnd && /[.!?"')\]]/.test(text[end])) end += 1
    if (text.slice(start, end).trim()) out.push({ start, end })
    while (end < blockEnd && /\s/.test(text[end])) end += 1
    start = end
    i = end - 1
  }
  if (start < blockEnd && text.slice(start, blockEnd).trim()) out.push({ start, end: blockEnd })
  return out
}

// ── Role classification ─────────────────────────────────────────────────────
// Cheap, explainable, and deterministic. Each rule is a pattern a prompt author
// would recognize; the first match wins, most specific first.

const ROLE_RULES: { role: SegmentRole; test: RegExp }[] = [
  // Politeness / greeting / sign-off — the only class we treat as disposable.
  { role: 'meta', test: /^\s*(?:hi|hey|hello|greetings|good (?:morning|afternoon|evening))\b/i },
  { role: 'meta', test: /^\s*(?:thanks?|thank you|many thanks|cheers|appreciate it|much appreciated)\b/i },
  { role: 'meta', test: /^\s*(?:that'?s (?:it|all)|let me know if)\b/i },

  // Persona assignment.
  { role: 'role', test: /\b(?:you are|you're|act as|behave as|assume the role of|pretend to be|imagine you are|as an? (?:expert|experienced|senior|professional))\b/i },

  // Output format.
  { role: 'format', test: /\b(?:respond|reply|answer|output|return|format|structure|write it|give it to me|present it)\b[^.!?]{0,60}\b(?:as|in|using|with|like)\b[^.!?]{0,60}\b(?:json|xml|yaml|csv|markdown|table|bullet|bullets|list|numbered|paragraphs?|code block|plain text|prose|essay|email|outline)\b/i },
  { role: 'format', test: /\b(?:in|as|using)\s+(?:json|yaml|xml|csv|markdown|a table|bullet points?|a numbered list|a bulleted list)\b/i },
  { role: 'format', test: /\b(?:output format|response format|format:|structure:)/i },

  // Examples.
  { role: 'example', test: /^\s*(?:for example|for instance|e\.g\.|example\s*[:\-—]|here'?s an example|such as[:,])/i },
  { role: 'example', test: /\b(?:input|output|example)\s*\d*\s*:/i },

  // Constraints — length, tone, must/must not, exclusions.
  { role: 'constraint', test: /\b(?:must not|must never|do not|don'?t|never|avoid|without|exclude|no more than|at most|at least|under|over|between|maximum|minimum|max|min|limit|keep it|no longer than|within)\b/i },
  { role: 'constraint', test: /\b(?:must|should|needs? to|has to|have to|required|ensure|make sure)\b/i },
  { role: 'constraint', test: /\b(?:tone|voice|style|formal|informal|casual|professional|friendly|concise|detailed|technical|simple)\b/i },
  { role: 'constraint', test: /\b\d+\s*(?:words?|characters?|chars?|sentences?|paragraphs?|bullets?|items?|pages?|lines?|tokens?)\b/i },

  // Direct questions.
  { role: 'question', test: /\?\s*$/ },
  { role: 'question', test: /^\s*(?:what|why|how|when|where|who|which|can you|could you|is it|are there|do you|does)\b/i },

  // The ask.
  { role: 'task', test: /^\s*(?:please\s+)?(?:write|create|generate|make|build|draft|summar(?:ize|ise)|explain|analyz|analys|review|translate|rewrite|refactor|list|compare|design|plan|outline|describe|convert|extract|classify|fix|debug|implement|suggest|recommend|help me)\b/i },
  { role: 'task', test: /\b(?:i (?:need|want|would like)|your task is|the goal is|the objective is|i'?m trying to)\b/i },

  // Background.
  { role: 'context', test: /\b(?:context|background|for context|note that|currently|we are|we're|our team|the project|i am working|i'?m working|here is|here'?s (?:the|my))\b/i },
]

export function classifyRole(sentence: string): SegmentRole {
  const s = sentence.trim()
  if (!s) return 'context'
  for (const rule of ROLE_RULES) if (rule.test.test(s)) return rule.role
  return 'context'
}

/** Split `text` into classified sentences with absolute offsets. */
export function segmentPrompt(text: string, protectedSpans: ProtectedSpan[] = []): Segment[] {
  const blocks = splitBlocks(text, protectedSpans)
  const segments: Segment[] = []

  blocks.forEach((block, blockIndex) => {
    if (block.kind === 'code') {
      segments.push({
        start: block.start,
        end: block.end,
        text: block.text,
        role: 'example',
        blockIndex,
        protectedSegment: true,
      })
      return
    }

    for (const s of splitSentences(text, block.start, block.end)) {
      const raw = text.slice(s.start, s.end)
      if (!raw.trim()) continue
      segments.push({
        start: s.start,
        end: s.end,
        text: raw,
        role: classifyRole(raw),
        blockIndex,
        protectedSegment: overlapsProtected(
          protectedSpans.filter((p) => p.kind === 'code-block' || p.kind === 'json'),
          s,
        ),
      })
    }
  })

  return segments
}

/** How many sentences fall into each role — used by the explanation panel. */
export function roleHistogram(segments: Segment[]): { role: SegmentRole; count: number }[] {
  const counts = new Map<SegmentRole, number>()
  for (const s of segments) counts.set(s.role, (counts.get(s.role) || 0) + 1)
  return [...counts.entries()]
    .map(([role, count]) => ({ role, count }))
    .sort((a, b) => b.count - a.count)
}
