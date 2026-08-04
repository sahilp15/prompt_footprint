// Clarity scoring.
// ---------------------------------------------------------------------------
// Flesch Reading Ease, clamped to 0–100. It is a rough instrument — it measures
// sentence and word length, not whether an instruction is clear — but it is
// transparent, deterministic, needs no model, and it moves in the right
// direction when a prompt genuinely gets tighter. It is presented in the UI as
// "clarity", with the caveat that it is a readability proxy.
//
// Reference: Flesch, R. (1948), "A new readability yardstick".

const VOWEL_GROUPS = /[aeiouy]+/g

/** Syllable estimate for a single word. Heuristic, English-only. */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return 0
  if (w.length <= 3) return 1
  const trimmed = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
    .replace(/^y/, '')
  const groups = trimmed.match(VOWEL_GROUPS)
  return Math.max(1, groups ? groups.length : 1)
}

export interface ReadabilityStats {
  score: number
  words: number
  sentences: number
  syllablesPerWord: number
  wordsPerSentence: number
}

/** Flesch Reading Ease over the prose in `text`, ignoring fenced code. */
export function readability(text: string): ReadabilityStats {
  const prose = text.replace(/```[\s\S]*?(?:```|$)/g, ' ').replace(/`[^`\n]*`/g, ' ')
  const words = prose.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) || []
  if (words.length < 3) {
    return { score: 100, words: words.length, sentences: 0, syllablesPerWord: 0, wordsPerSentence: 0 }
  }

  // Bullet points and line breaks end a "sentence" for scoring purposes; a list
  // of five bullets is not one 60-word sentence.
  const sentenceCount = Math.max(
    1,
    (prose.match(/[.!?]+(?:\s|$)/g) || []).length + (prose.match(/\n\s*(?:[-*+]|\d+[.)])\s/g) || []).length,
  )

  const totalSyllables = words.reduce((sum, w) => sum + syllables(w), 0)
  const wordsPerSentence = words.length / sentenceCount
  const syllablesPerWord = totalSyllables / words.length

  const raw = 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord
  return {
    score: Math.max(0, Math.min(100, Math.round(raw))),
    words: words.length,
    sentences: sentenceCount,
    syllablesPerWord,
    wordsPerSentence,
  }
}

/** Plain-language band for a score, shown next to the number. */
export function readabilityLabel(score: number): string {
  if (score >= 80) return 'Very easy to read'
  if (score >= 60) return 'Easy to read'
  if (score >= 45) return 'Fairly readable'
  if (score >= 30) return 'Dense'
  return 'Hard to read'
}
