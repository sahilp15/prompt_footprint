// Stage 3a — entity extraction.
// ---------------------------------------------------------------------------
// These are the facts a shortened prompt is not allowed to lose. Every entity
// found here is re-extracted from the optimized text in `validate.ts`; anything
// that disappears is reported as information loss, not celebrated as savings.
//
// Extraction is deliberately recall-oriented: a false positive costs a little
// caution, a false negative costs the user a broken prompt.

import type { Entity, EntityKind } from './types.ts'
import { canonicalizeWord } from './lexicon.ts'

/** Technology and product names the cutter must never "correct" or drop. */
export const TECHNOLOGY_TERMS = [
  'javascript', 'typescript', 'python', 'java', 'kotlin', 'swift', 'ruby', 'rust', 'golang', 'php',
  'react', 'vue', 'angular', 'svelte', 'next.js', 'nextjs', 'nuxt', 'node', 'node.js', 'deno', 'bun',
  'django', 'flask', 'fastapi', 'rails', 'laravel', 'spring', 'express',
  'postgres', 'postgresql', 'mysql', 'sqlite', 'mongodb', 'redis', 'supabase', 'firebase',
  'docker', 'kubernetes', 'terraform', 'ansible', 'nginx', 'graphql', 'rest', 'grpc',
  'aws', 'gcp', 'azure', 'cloudflare', 'vercel', 'netlify',
  'chatgpt', 'gpt', 'claude', 'gemini', 'llama', 'openai', 'anthropic', 'huggingface',
  'tensorflow', 'pytorch', 'numpy', 'pandas', 'sklearn', 'scikit-learn',
  'html', 'css', 'sass', 'scss', 'tailwind', 'bootstrap', 'webpack', 'vite', 'rollup', 'esbuild',
  'git', 'github', 'gitlab', 'jira', 'figma', 'notion', 'slack', 'excel', 'sql', 'json', 'yaml', 'xml', 'csv',
  'api', 'sdk', 'cli', 'ui', 'ux', 'seo', 'crm', 'saas',
]

const TECH_SET = new Set(TECHNOLOGY_TERMS)

/** Words whose removal flips the meaning of a sentence. */
export const NEGATION_WORDS = [
  'not', "don't", 'do not', 'never', 'no', 'without', 'avoid', 'exclude', 'except',
  'neither', 'nor', 'none', 'cannot', "can't", "won't", "shouldn't", "doesn't", "isn't",
  "aren't", "wasn't", 'must not', "mustn't", 'refrain', 'omit', 'skip', 'ignore',
]

const FILE_TYPE_RE = /\.(?:jsx?|tsx?|py|rb|go|rs|java|cpp|cs|php|sh|sql|json|ya?ml|toml|md|txt|csv|pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|svg|webp|zip|tar|gz|env|html?|css|scss)\b/gi

const PATTERNS: { kind: EntityKind; re: RegExp }[] = [
  { kind: 'url', re: /\bhttps?:\/\/[^\s<>()[\]{}"']+|\bwww\.[^\s<>()[\]{}"']+\.[a-z]{2,}/gi },
  { kind: 'email', re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
  {
    kind: 'date',
    re: /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi,
  },
  {
    // Relative day words are only a date when something anchors them in time.
    // "Summarize the news from today" carries a date; "I hope you're doing well
    // today" does not, and treating the second as information would make every
    // removed pleasantry look like a lost deadline.
    kind: 'date',
    re: /\b(?:by|before|after|due|until|till|on|for|from|since|during|no later than|deadline(?:\s+is)?:?|starting|as of)\s+(?:this\s+|next\s+|last\s+)?(?:today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
  },
  { kind: 'file-type', re: FILE_TYPE_RE },
  { kind: 'quoted', re: /"[^"\n]{2,200}"|“[^”\n]{2,200}”/g },
  {
    kind: 'length-limit',
    re: /\b(?:under|below|over|above|at most|at least|no more than|no fewer than|fewer than|less than|more than|maximum(?: of)?|minimum(?: of)?|max|min|exactly|around|about|approximately|up to|within)\s+\d[\d,]*\s*(?:words?|characters?|chars?|sentences?|paragraphs?|bullets?|items?|pages?|lines?|tokens?|steps?|options?|examples?|minutes?|hours?|days?)\b|\b\d[\d,]*\s*(?:-|to|–)\s*\d[\d,]*\s*(?:words?|characters?|sentences?|paragraphs?|bullets?|items?|pages?)\b|\b\d[\d,]*\s*(?:words?|characters?|chars?|sentences?|paragraphs?|bullets?|items?|pages?|lines?|tokens?|steps?)\b/gi,
  },
  {
    kind: 'imperative',
    re: /\b(?:must not|must never|must|should not|should never|shall not|never|always|do not|don'?t|required to|it is (?:critical|essential|mandatory|required))\b[^.!?;\n]{0,90}/gi,
  },
  { kind: 'number', re: /\b\d[\d,]*(?:\.\d+)?%?\b/g },
]

/** Capitalized words that are not sentence-initial and not common vocabulary. */
const SENTENCE_START_STOPWORDS = new Set([
  'the', 'a', 'an', 'i', 'you', 'we', 'they', 'he', 'she', 'it', 'this', 'that', 'these', 'those',
  'please', 'write', 'make', 'create', 'use', 'do', 'don', 'if', 'when', 'while', 'for', 'and',
  'but', 'or', 'so', 'then', 'also', 'however', 'note', 'here', 'there', 'my', 'your', 'our',
  'keep', 'give', 'add', 'remove', 'ensure', 'avoid', 'include', 'explain', 'summarize', 'summarise',
  'first', 'second', 'third', 'next', 'finally', 'lastly', 'now', 'today', 'yes', 'no', 'each',
  'every', 'all', 'some', 'any', 'both', 'either', 'neither', 'once', 'again', 'still',
  // Imperative verbs that routinely open a prompt sentence.
  'ask', 'send', 'draft', 'review', 'translate', 'check', 'tell', 'share', 'confirm',
  'list', 'describe', 'compare', 'generate', 'build', 'design', 'plan', 'convert',
  'extract', 'classify', 'fix', 'debug', 'implement', 'suggest', 'recommend', 'help',
  'focus', 'start', 'return', 'respond', 'reply', 'output', 'format', 'analyze', 'analyse',
  'rewrite', 'edit', 'proofread', 'refactor', 'optimize', 'optimise', 'update', 'change',
])

/**
 * Proper nouns, without the sentence-casing false positives.
 *
 * The hard part is that "Basically, ..." and "Thanks!" look exactly like names
 * to a capitalization rule, and reporting them as lost information every time a
 * filler word is removed would train the user to ignore the safety panel. So a
 * sentence-initial capital only counts when the SAME token also appears
 * capitalized somewhere it could not be sentence casing — which is what
 * actually distinguishes "Acme" from "Basically".
 */
function extractProperNouns(text: string): Entity[] {
  const re = /\b[A-Z][a-z]{1,}(?:[ -][A-Z][a-z]+)*\b|\b[A-Z]{2,}(?:\.[A-Z]{2,})*\b|\b[A-Z][A-Za-z]*\d+(?:[.-]\w+)*\b/g

  interface Hit { word: string; lower: string; sentenceInitial: boolean }
  const hits: Hit[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    let word = m[0]
    const before = text.slice(0, m.index).replace(/[ \t]+$/, '')
    let sentenceInitial =
      before === '' || /[.!?:;\n]$/.test(before) || /[-*+>]$/.test(before)

    // "Ask Priya Raman" opens with an imperative verb that is capitalized only
    // because the sentence starts there — the name is what follows it.
    if (sentenceInitial && /[ -]/.test(word)) {
      const parts = word.split(/([ -])/)
      if (SENTENCE_START_STOPWORDS.has(parts[0].toLowerCase())) {
        word = parts.slice(2).join('')
        sentenceInitial = false
        if (!word) continue
      }
    }

    hits.push({ word, lower: word.toLowerCase(), sentenceInitial })
  }

  // Tokens seen mid-sentence with a capital are names wherever they appear.
  const confirmed = new Set(hits.filter((h) => !h.sentenceInitial).map((h) => h.lower))

  const out: Entity[] = []
  const seen = new Set<string>()
  for (const h of hits) {
    if (seen.has(h.lower)) continue
    const multiWord = /[ -]/.test(h.word)
    const allCaps = h.word.length > 1 && h.word === h.word.toUpperCase()
    const hasDigit = /\d/.test(h.word)          // Q3, GPT-4, v2 — never sentence casing

    if (h.sentenceInitial && !confirmed.has(h.lower) && !multiWord && !allCaps && !hasDigit) {
      // Could be ordinary vocabulary that simply opened a sentence.
      if (SENTENCE_START_STOPWORDS.has(h.lower) || !TECH_SET.has(h.lower)) continue
    }

    seen.add(h.lower)
    out.push({ kind: TECH_SET.has(h.lower) ? 'technology' : 'proper-noun', key: h.lower, text: h.word })
  }
  return out
}

function extractTechnologies(text: string): Entity[] {
  const out: Entity[] = []
  const seen = new Set<string>()
  const lower = text.toLowerCase()
  for (const term of TECHNOLOGY_TERMS) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'g')
    if (re.test(lower) && !seen.has(term)) {
      seen.add(term)
      out.push({ kind: 'technology', key: term, text: term })
    }
  }
  return out
}

/**
 * Idioms in which a negation word carries no negative meaning.
 *
 * "Whether or not you can help" negates nothing — it is a fixed phrase that
 * shortens to "whether". Counting its "not" would make that safe rewrite look
 * like the loss of a requirement, so these are neutralized before counting.
 */
const NEGATION_IDIOMS = /\b(?:whether or not|if or not|not only|no matter|last but not least|none other than)\b/gi

/** Negation occurrences per word, ignoring idiomatic uses. */
export function countNegations(text: string): Map<string, number> {
  const counts = new Map<string, number>()
  // Blank the idioms (preserving offsets) so their words are simply not there.
  const lower = text.toLowerCase().replace(NEGATION_IDIOMS, (m) => ' '.repeat(m.length))

  for (const word of NEGATION_WORDS) {
    // Apostrophe-optional: "dont" and "don't" are the same negation, so fixing
    // the spelling must not read as having removed one.
    const escaped = word
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/'/g, "['’]?")
    const re = new RegExp(`(?<![\\w'’-])${escaped}(?![\\w'’-])`, 'g')
    const n = (lower.match(re) || []).length
    if (n > 0) counts.set(word, n)
  }
  return counts
}

function extractNegations(text: string): Entity[] {
  const out: Entity[] = []
  const counts = countNegations(text)
  // Count matters: dropping one of three "never"s is still a loss, so each
  // occurrence gets its own keyed entity.
  for (const [word, n] of counts) {
    for (let i = 0; i < n; i += 1) {
      out.push({ kind: 'negation', key: `${word}#${i}`, text: word })
    }
  }
  return out
}

/**
 * Apostrophes are noise for identity purposes: fixing "dont" to "don't" is a
 * spelling correction, not the loss of an instruction, so both forms have to
 * key the same way.
 */
function stripApostrophes(s: string): string {
  return s.replace(/['’]/g, '')
}

function normalizeKey(kind: EntityKind, raw: string): string {
  const collapsed = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  if (kind === 'number' || kind === 'length-limit') return collapsed.replace(/,/g, '')
  if (kind === 'url') return collapsed.replace(/\/+$/, '')
  if (kind === 'imperative') {
    // Compare on content words so a filler removal inside the clause doesn't
    // read as a lost instruction.
    return stripApostrophes(collapsed)
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .map(canonicalizeWord)
      .filter((w) => w && !FUNCTION_WORDS.has(w))
      .slice(0, 8)
      .join(' ')
  }
  return collapsed
}

const FUNCTION_WORDS = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'for', 'is', 'are', 'be', 'and', 'or',
  'that', 'this', 'it', 'as', 'with', 'by', 'from', 'you', 'your', 'i', 'me', 'my', 'we',
  'please', 'just', 'really', 'very', 'quite', 'basically', 'actually', 'simply',
])

/**
 * Every entity in `text`, de-duplicated by (kind, key).
 *
 * Numbers are only kept when they are not already covered by a richer entity
 * (a date, a length limit) so "under 200 words" reports one limit rather than
 * a limit plus a naked 200.
 */
export function extractEntities(text: string): Entity[] {
  if (!text) return []
  const found: Entity[] = []
  const claimed: { start: number; end: number }[] = []

  const isClaimed = (start: number, end: number): boolean =>
    claimed.some((c) => start < c.end && end > c.start)

  for (const { kind, re: source } of PATTERNS) {
    const re = new RegExp(source.source, source.flags)
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex += 1; continue }
      const start = m.index
      const end = start + m[0].length
      // Bare numbers lose to any earlier, more specific match at that position.
      if (kind === 'number' && isClaimed(start, end)) continue
      claimed.push({ start, end })
      found.push({ kind, key: normalizeKey(kind, m[0]), text: m[0].trim() })
    }
  }

  found.push(...extractTechnologies(text))
  found.push(...extractProperNouns(text))
  found.push(...extractNegations(text))

  const seen = new Set<string>()
  return found.filter((e) => {
    if (!e.key) return false
    const id = `${e.kind}|${e.key}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

/** Entities whose loss is unacceptable rather than merely worth a warning. */
export const CRITICAL_ENTITY_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  'number', 'date', 'url', 'email', 'file-type', 'length-limit', 'negation', 'imperative', 'quoted',
])
