// Stage 3b — constraint extraction.
// ---------------------------------------------------------------------------
// Constraints are the requirements a shorter prompt must still express. They
// are what makes "Please make sure the response is professional, but not too
// formal, and keep it under 200 words" a three-constraint sentence rather than
// a wordy one: the padding can go, all three limits must stay.
//
// Each constraint gets a normalized `key`. Two constraints sharing a key are
// duplicates — the redundancy pass may drop the second occurrence, and the
// validator only complains when a key vanishes entirely.

import type { Constraint, ConstraintKind } from './types.ts'
import { canonicalizeWord } from './lexicon.ts'

interface Rule {
  kind: ConstraintKind
  label: string
  re: RegExp
  /** Builds the identity used for duplicate detection. */
  key: (match: RegExpExecArray) => string
}

const RULES: Rule[] = [
  {
    kind: 'length',
    label: 'Length limit',
    re: /\b(?:under|below|over|above|at most|at least|no more than|no fewer than|fewer than|less than|more than|maximum(?: of)?|minimum(?: of)?|max|min|exactly|around|about|approximately|up to|within|keep it (?:to|under)|limit(?:ed)? to)\s+(\d[\d,]*)\s*(words?|characters?|chars?|sentences?|paragraphs?|bullets?|items?|pages?|lines?|tokens?|steps?|options?|examples?)\b/gi,
    key: (m) => `length:${m[1].replace(/,/g, '')}:${normalizeUnit(m[2])}`,
  },
  {
    kind: 'length',
    label: 'Length limit',
    re: /\b(\d[\d,]*)\s*(?:-|to|–)\s*(\d[\d,]*)\s*(words?|characters?|sentences?|paragraphs?|bullets?|items?|pages?)\b/gi,
    key: (m) => `length:${m[1].replace(/,/g, '')}-${m[2].replace(/,/g, '')}:${normalizeUnit(m[3])}`,
  },
  {
    kind: 'length',
    label: 'Length limit',
    re: /\b(\d[\d,]*)\s+(words?|characters?|sentences?|paragraphs?|bullets?|items?|pages?|lines?|steps?)\b/gi,
    key: (m) => `length:${m[1].replace(/,/g, '')}:${normalizeUnit(m[2])}`,
  },
  {
    kind: 'tone',
    label: 'Tone',
    // The modifier is part of the identity: "formal" and "not too formal" are
    // different requirements, and treating them as one would let the cutter
    // drop a negation while reporting the constraint as preserved.
    re: /\b(not too |not |less |more |slightly |fairly |quite |very )?(professional|formal|informal|casual|friendly|conversational|academic|technical|playful|serious|neutral|persuasive|empathetic|concise|detailed|blunt|warm|witty|authoritative|approachable)\b/gi,
    key: (m) => `tone:${(m[1] || '').trim().replace(/\s+/g, '-').toLowerCase()}${m[1] ? '-' : ''}${m[2].toLowerCase()}`,
  },
  {
    kind: 'format',
    label: 'Output format',
    re: /\b(?:as|in|using|into|to)\s+(?:an?\s+|the\s+)?(json|yaml|xml|csv|markdown|table|bullet points?|bulleted list|numbered list|numbered steps|list|outline|essay|email|paragraphs?|code block|plain text|prose|slide deck|summary)\b/gi,
    key: (m) => `format:${normalizeFormat(m[1])}`,
  },
  {
    kind: 'format',
    label: 'Output format',
    re: /\b(?:output|response|answer|reply|result)\s+(?:format|as|in|should be)\s*:?\s*(json|yaml|xml|csv|markdown|a table|bullet points?|a numbered list|plain text|prose)\b/gi,
    key: (m) => `format:${normalizeFormat(m[1])}`,
  },
  {
    kind: 'audience',
    label: 'Audience',
    re: /\b(?:for|aimed at|targeted at|written for|audience(?: is)?:?)\s+(?:an?\s+|the\s+)?((?:non-?technical|technical|beginner|expert|senior|junior|executive|general|academic|student|developer|engineer|designer|marketing|customer|child|5[- ]year[- ]old)[\w -]{0,24})\b/gi,
    key: (m) => `audience:${m[1].toLowerCase().trim()}`,
  },
  {
    kind: 'deadline',
    label: 'Deadline',
    re: /\b(?:by|before|due|deadline(?: is)?:?|no later than)\s+((?:\d{4}-\d{2}-\d{2})|(?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)|(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?))\b/gi,
    key: (m) => `deadline:${m[1].toLowerCase().replace(/\s+/g, ' ')}`,
  },
  {
    kind: 'exclusion',
    label: 'Must not',
    re: /\b(?:do not|don'?t|never|must not|must never|avoid|without|exclude|omit|refrain from|no)\s+([\w' -]{2,50})/gi,
    key: (m) => `exclude:${contentKey(m[1])}`,
  },
  {
    kind: 'inclusion',
    label: 'Must include',
    re: /\b(?:must|should|needs? to|has to|have to|be sure to|make sure (?:to|you|it)|ensure(?: that)?|always|include|mention|cover)\s+([\w' -]{2,50})/gi,
    key: (m) => `include:${contentKey(m[1])}`,
  },
  {
    kind: 'language',
    label: 'Language',
    re: /\b(?:in|into|translate to|respond in|write in|answer in)\s+(english|spanish|french|german|italian|portuguese|dutch|japanese|chinese|mandarin|korean|hindi|arabic|russian|polish|turkish|swedish|norwegian|danish|finnish|greek|hebrew|vietnamese|thai|indonesian)\b/gi,
    key: (m) => `language:${m[1].toLowerCase()}`,
  },
]

function normalizeUnit(unit: string): string {
  const u = unit.toLowerCase()
  if (u.startsWith('char')) return 'characters'
  return u.endsWith('s') ? u : `${u}s`
}

function normalizeFormat(fmt: string): string {
  const f = fmt.toLowerCase().replace(/^(?:an?|the)\s+/, '').trim()
  if (/^bullet/.test(f) || f === 'bulleted list') return 'bullets'
  if (/^numbered/.test(f)) return 'numbered-list'
  if (f === 'paragraph' || f === 'paragraphs') return 'prose'
  return f
}

const STOP = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'for', 'is', 'are', 'be', 'and', 'or', 'any',
  'it', 'that', 'this', 'with', 'by', 'from', 'you', 'your', 'me', 'my', 'we', 'us', 'our', 'too',
])

/**
 * Content-word signature, so wording changes don't create a phantom duplicate.
 * Words are canonicalized first, so fixing a typo inside a constraint does not
 * make it look like a different — or a missing — constraint.
 */
function contentKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^\w\s'-]/g, ' ')
    .split(/\s+/)
    .map(canonicalizeWord)
    .filter((w) => w && !STOP.has(w))
    .slice(0, 4)
    .join(' ')
}

/**
 * Every constraint in `text` with its position. Overlapping matches from
 * different rules are all kept — "keep it under 200 words and professional"
 * genuinely carries a length constraint *and* a tone constraint.
 */
export function extractConstraints(text: string): Constraint[] {
  if (!text) return []
  const out: Constraint[] = []

  for (const rule of RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags)
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex += 1; continue }
      const key = rule.key(m)
      if (!key || key.endsWith(':')) continue
      out.push({
        start: m.index,
        end: m.index + m[0].length,
        kind: rule.kind,
        key,
        text: m[0].trim(),
        label: rule.label,
      })
    }
  }

  out.sort((a, b) => a.start - b.start)
  return out
}

/**
 * Constraints that contradict each other, phrased for the user.
 *
 * Deliberately narrow: only pairs that cannot both hold. Everything looser is
 * a style choice, and flagging those would train people to ignore the panel.
 */
export function findConflicts(constraints: Constraint[]): string[] {
  const conflicts: string[] = []

  // Two different numeric limits on the same unit.
  const byUnit = new Map<string, { value: number; text: string }[]>()
  for (const c of constraints) {
    if (c.kind !== 'length') continue
    const parts = c.key.split(':')
    const unit = parts[2]
    const value = Number(parts[1].split('-')[0])
    if (!unit || !Number.isFinite(value)) continue
    const list = byUnit.get(unit) || []
    list.push({ value, text: c.text })
    byUnit.set(unit, list)
  }
  for (const [unit, list] of byUnit) {
    const distinct = [...new Set(list.map((l) => l.value))]
    if (distinct.length > 1) {
      conflicts.push(
        `Two different ${unit} limits are given (${list.map((l) => `“${l.text}”`).join(' and ')}). Pick one.`,
      )
    }
  }

  // Opposing tones. Negated modifiers are excluded — "professional but not too
  // formal" is a nuance the author meant, not a contradiction.
  const tones = new Set(
    constraints
      .filter((c) => c.kind === 'tone' && !/^tone:(?:not|less)/.test(c.key))
      .map((c) => c.key.replace(/^tone:(?:more-|very-|quite-|slightly-|fairly-)?/, '')),
  )
  const OPPOSED: [string, string][] = [
    ['formal', 'informal'], ['formal', 'casual'], ['concise', 'detailed'],
    ['technical', 'beginner'], ['playful', 'serious'], ['professional', 'playful'],
  ]
  for (const [a, b] of OPPOSED) {
    if (tones.has(a) && tones.has(b)) {
      conflicts.push(`The prompt asks for both a ${a} and a ${b} tone. Clarify which wins.`)
    }
  }

  // Two mutually exclusive output formats.
  const formats = [...new Set(
    constraints.filter((c) => c.kind === 'format').map((c) => c.key.replace('format:', '')),
  )]
  const EXCLUSIVE = new Set(['json', 'yaml', 'xml', 'csv'])
  const structured = formats.filter((f) => EXCLUSIVE.has(f))
  if (structured.length > 1) {
    conflicts.push(`More than one output format is requested (${structured.join(', ')}). Keep one.`)
  }
  if (structured.length >= 1 && formats.includes('prose')) {
    conflicts.push(`The prompt asks for both ${structured[0]} and prose. These cannot both be the output.`)
  }

  return conflicts
}
