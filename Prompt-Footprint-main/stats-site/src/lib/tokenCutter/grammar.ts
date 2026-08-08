// Stage 4a — grammar and spelling.
// ---------------------------------------------------------------------------
// Local-first and deliberately conservative. A full dictionary (Hunspell via
// Typo.js) already ships in the extension; the reason it is *not* used here is
// judgement, not laziness: a nearest-edit-distance suggestion on an unknown
// word confidently renames people, products, and APIs — exactly the failure a
// prompt tool must never make. A curated map of unambiguous misspellings has
// far lower recall and near-perfect precision, which is the correct trade for
// a change the user is being invited to accept in one click.
//
// Everything here produces high-confidence, safe edits — except a/an and
// missing terminal punctuation, which are offered but never pre-accepted.

import type { OptimizationLevel, SuggestionCategory } from './types.ts'
import { AMBIGUOUS_CONTRACTIONS, CONTRACTION_MAP, TYPO_MAP } from './lexicon.ts'
import { TECHNOLOGY_TERMS } from './entities.ts'

export interface RawEdit {
  start: number
  end: number
  replacement: string
  category: SuggestionCategory
  title: string
  reason: string
  score: number
  minLevel: OptimizationLevel
  safe: boolean
  advisory?: boolean
}

const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*/g

/** Words the dictionary would flag but that are correct in a prompt. */
const KNOWN_TERMS = new Set([...TECHNOLOGY_TERMS, 'repo', 'repos', 'auth', 'env', 'config', 'async', 'middleware'])

/** Canonical casing for product names people routinely lowercase. */
const CANONICAL_CASING: Record<string, string> = {
  chatgpt: 'ChatGPT', github: 'GitHub', gitlab: 'GitLab', openai: 'OpenAI',
  javascript: 'JavaScript', typescript: 'TypeScript', postgresql: 'PostgreSQL',
  mongodb: 'MongoDB', graphql: 'GraphQL', nodejs: 'Node.js', mysql: 'MySQL',
  sqlite: 'SQLite', ios: 'iOS', macos: 'macOS',
}

function matchCase(original: string, replacement: string): string {
  if (!original || !replacement) return replacement
  if (original === original.toUpperCase() && original.length > 1) return replacement.toUpperCase()
  if (original[0] === original[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1)
  }
  return replacement
}

/** Misspellings, unambiguous missing apostrophes, and product-name casing. */
export function findSpellingEdits(text: string): RawEdit[] {
  const edits: RawEdit[] = []
  const re = new RegExp(WORD_RE.source, 'g')
  let m: RegExpExecArray | null

  while ((m = re.exec(text)) !== null) {
    const word = m[0]
    const lower = word.toLowerCase()
    const start = m.index
    const end = start + word.length

    const typo = TYPO_MAP[lower]
    if (typo) {
      edits.push({
        start, end, replacement: matchCase(word, typo),
        category: 'spelling', title: 'Spelling',
        reason: `“${word}” is a common misspelling of “${typo}”.`,
        score: 0.96, minLevel: 'light', safe: true,
      })
      continue
    }

    const contraction = CONTRACTION_MAP[lower]
    if (contraction && !AMBIGUOUS_CONTRACTIONS.has(lower)) {
      edits.push({
        start, end, replacement: matchCase(word, contraction),
        category: 'spelling', title: 'Missing apostrophe',
        reason: `“${word}” is missing an apostrophe.`,
        score: 0.9, minLevel: 'light', safe: true,
      })
      continue
    }

    const canonical = CANONICAL_CASING[lower]
    if (canonical && word !== canonical && !KNOWN_TERMS.has(word)) {
      edits.push({
        start, end, replacement: canonical,
        category: 'spelling', title: 'Product name casing',
        reason: `The official spelling is “${canonical}”.`,
        score: 0.88, minLevel: 'light', safe: true,
      })
    }
  }

  return edits
}

/** Doubled words, a/an, and lowercase “i”. */
export function findGrammarEdits(text: string): RawEdit[] {
  const edits: RawEdit[] = []

  // "the the" → "the". Excludes legitimate doubles like "had had".
  const LEGIT_DOUBLES = new Set(['had', 'that', 'is', 'do'])
  const dbl = /\b([A-Za-z]{2,})(\s+)\1\b/gi
  let m: RegExpExecArray | null
  while ((m = dbl.exec(text)) !== null) {
    if (LEGIT_DOUBLES.has(m[1].toLowerCase())) continue
    edits.push({
      start: m.index, end: m.index + m[0].length, replacement: m[1],
      category: 'grammar', title: 'Repeated word',
      reason: `“${m[1]}” appears twice in a row.`,
      score: 0.94, minLevel: 'light', safe: true,
    })
  }

  // Lowercase standalone "i".
  const loneI = /(?<![\w'’])i(?![\w'’])/g
  while ((m = loneI.exec(text)) !== null) {
    edits.push({
      start: m.index, end: m.index + 1, replacement: 'I',
      category: 'grammar', title: 'Capitalization',
      reason: 'The pronoun “I” is always capitalized.',
      score: 0.95, minLevel: 'light', safe: true,
    })
  }

  // a/an. Only clear vowel/consonant cases; u- and h- words are ambiguous
  // ("a user", "an hour"), so they are skipped rather than guessed at.
  const aVowel = /\b(a)(\s+)([aeio][a-z]+)/gi
  while ((m = aVowel.exec(text)) !== null) {
    edits.push({
      start: m.index, end: m.index + m[1].length,
      replacement: m[1] === 'A' ? 'An' : 'an',
      category: 'grammar', title: 'Article agreement',
      reason: `Use “an” before “${m[3]}”.`,
      score: 0.8, minLevel: 'light', safe: false,
    })
  }
  const anCons = /\b(an)(\s+)([bcdfgjklmnpqrstvwxyz][a-z]+)/gi
  while ((m = anCons.exec(text)) !== null) {
    edits.push({
      start: m.index, end: m.index + m[1].length,
      replacement: m[1] === 'An' ? 'A' : 'a',
      category: 'grammar', title: 'Article agreement',
      reason: `Use “a” before “${m[3]}”.`,
      score: 0.8, minLevel: 'light', safe: false,
    })
  }

  return edits
}

/** Spacing and punctuation noise. Free tokens, zero risk. */
export function findWhitespaceEdits(text: string): RawEdit[] {
  const edits: RawEdit[] = []
  let m: RegExpExecArray | null

  // Runs of spaces inside a line (leading indentation is left alone — it may
  // be meaningful in a list or a code sample).
  const runs = /(?<=\S) {2,}(?=\S)/g
  while ((m = runs.exec(text)) !== null) {
    edits.push({
      start: m.index, end: m.index + m[0].length, replacement: ' ',
      category: 'whitespace', title: 'Extra spaces',
      reason: 'Repeated spaces cost tokens and change nothing.',
      score: 0.99, minLevel: 'light', safe: true,
    })
  }

  // Space before punctuation.
  const beforePunct = /[ \t]+(?=[,.;:!?])/g
  while ((m = beforePunct.exec(text)) !== null) {
    edits.push({
      start: m.index, end: m.index + m[0].length, replacement: '',
      category: 'whitespace', title: 'Space before punctuation',
      reason: 'Punctuation attaches to the preceding word.',
      score: 0.98, minLevel: 'light', safe: true,
    })
  }

  // Repeated punctuation ("!!!", "..." is kept — an ellipsis is intentional).
  const repeated = /([,;:!?])\1{1,}/g
  while ((m = repeated.exec(text)) !== null) {
    edits.push({
      start: m.index, end: m.index + m[0].length, replacement: m[1],
      category: 'whitespace', title: 'Repeated punctuation',
      reason: 'One mark is enough.',
      score: 0.93, minLevel: 'light', safe: true,
    })
  }

  // Three or more blank lines.
  const blanks = /\n{4,}/g
  while ((m = blanks.exec(text)) !== null) {
    edits.push({
      start: m.index, end: m.index + m[0].length, replacement: '\n\n',
      category: 'whitespace', title: 'Extra blank lines',
      reason: 'Blank lines beyond one paragraph break cost tokens.',
      score: 0.95, minLevel: 'light', safe: true,
    })
  }

  return edits
}

/** Capitalize the first letter of each sentence. */
export function findCapitalizationEdits(text: string): RawEdit[] {
  const edits: RawEdit[] = []
  const re = /(^|[.!?]["'’)\]]?\s+|\n\s*)([a-z])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const at = m.index + m[1].length
    // Skip list markers and anything that is really a lowercase identifier
    // (a bare word followed by "(" or "." is probably code or a filename).
    const rest = text.slice(at, at + 40)
    if (/^[a-z][\w.]*\s*\(/.test(rest)) continue
    edits.push({
      start: at, end: at + 1, replacement: m[2].toUpperCase(),
      category: 'grammar', title: 'Capitalization',
      reason: 'Sentences start with a capital letter.',
      score: 0.87, minLevel: 'light', safe: true,
    })
  }
  return edits
}

/**
 * The question mark left behind when a polite request becomes an imperative.
 *
 * "Can you please summarize the report?" loses its wrapper and reads
 * "Summarize the report?" — a request punctuated as a question, which is the
 * kind of seam that makes an otherwise correct optimization look careless.
 *
 * Proposed as its own edit rather than folded into the wrapper rule: the two
 * are at opposite ends of the sentence, and keeping them separate means the
 * terminator is only changed when the wrapper removal is actually accepted-
 * looking — a sentence that still opens on "Can you" is left alone.
 */
export function findRequestPunctuation(text: string): RawEdit[] {
  const edits: RawEdit[] = []
  const re = /(?:^|[.!?]\s+)((?:could|can|would|will)\s+you\s+(?:please\s+|kindly\s+)?|please\s+|i\s+was\s+wondering\s+if\s+you\s+could\s+)[^?!.\n]{4,300}(\?)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const at = m.index + m[0].length - 1
    edits.push({
      start: at,
      end: at + 1,
      replacement: '.',
      category: 'grammar',
      title: 'Request punctuation',
      reason: 'Without the polite wrapper this is an instruction, not a question.',
      score: 0.8,
      minLevel: 'balanced',
      safe: false,
    })
  }
  return edits
}
