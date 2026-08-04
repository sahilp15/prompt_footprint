// Unit tests for the Token Cutter's text-processing stages.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { buildProtectionMask, countProtectedTerms, findProtectedSpans, maskOverlaps } from '../src/lib/tokenCutter/protect.ts'
import { classifyRole, roleHistogram, segmentPrompt, splitBlocks } from '../src/lib/tokenCutter/segment.ts'
import { countNegations, extractEntities } from '../src/lib/tokenCutter/entities.ts'
import { extractConstraints, findConflicts } from '../src/lib/tokenCutter/constraints.ts'
import { containment, contentWords, similarity } from '../src/lib/tokenCutter/redundancy.ts'
import { findGrammarEdits, findSpellingEdits, findWhitespaceEdits } from '../src/lib/tokenCutter/grammar.ts'
import { applyEdits, buildDiff, repairSeams, tidy } from '../src/lib/tokenCutter/apply.ts'
import { validateMeaning } from '../src/lib/tokenCutter/validate.ts'
import { readability, syllables } from '../src/lib/tokenCutter/readability.ts'
import { countWords, estimateTokens, savedImpact, tokensSaved } from '../src/lib/tokenCutter/tokens.ts'
import { explainPrompt } from '../src/lib/tokenCutter/explain.ts'
import type { Suggestion } from '../src/lib/tokenCutter/types.ts'

const kinds = (text: string): string[] => findProtectedSpans(text).map((s) => s.kind)

// ── Protection ──────────────────────────────────────────────────────────────

describe('protection', () => {
  test('claims fenced code blocks whole', () => {
    const src = 'Do this:\n\n```js\nconst a = 1\n  const b = 2\n```\n\nThen stop.'
    const span = findProtectedSpans(src).find((s) => s.kind === 'code-block')
    assert.ok(span, 'expected a code-block span')
    assert.ok(span.text.includes('const a = 1'))
    assert.ok(span.text.includes('  const b = 2'), 'indentation must be inside the span')
  })

  test('claims inline code, URLs, emails, and placeholders', () => {
    const src = 'Call `render()` at https://ex.com/a?b=1, mail a@b.co, use {{name}}.'
    const found = kinds(src)
    assert.ok(found.includes('inline-code'))
    assert.ok(found.includes('url'))
    assert.ok(found.includes('email'))
    assert.ok(found.includes('placeholder'))
  })

  test('matches nested JSON with balanced braces, not a truncated prefix', () => {
    const src = 'Return {"a": {"b": [1, 2]}, "c": true} exactly.'
    const json = findProtectedSpans(src).find((s) => s.kind === 'json')
    assert.ok(json)
    assert.equal(json.text, '{"a": {"b": [1, 2]}, "c": true}')
  })

  test('leaves prose braces alone', () => {
    assert.equal(findProtectedSpans('Use {this idea} loosely.').filter((s) => s.kind === 'json').length, 0)
  })

  test('a URL inside a code fence stays part of the code block', () => {
    const src = '```\nfetch("https://ex.com")\n```'
    const found = findProtectedSpans(src)
    assert.equal(found.filter((s) => s.kind === 'url').length, 0)
    assert.equal(found.filter((s) => s.kind === 'code-block').length, 1)
  })

  test('quoted text, numbers, and dates are protected', () => {
    const found = kinds('Say "exactly this" before 2026-01-05 in 200 words.')
    assert.ok(found.includes('quote'))
    assert.ok(found.includes('date'))
    assert.ok(found.includes('number'))
  })

  test('memory terms are protected verbatim', () => {
    const spans = findProtectedSpans('Ship the Northwind rollout.', ['Northwind'])
    const mem = spans.find((s) => s.kind === 'memory-term')
    assert.ok(mem)
    assert.equal(mem.text, 'Northwind')
    assert.match(mem.reason, /never-remove/)
  })

  test('spans never overlap', () => {
    const spans = findProtectedSpans('`a` "b" https://c.d {"e": 1} 5 words')
    for (let i = 1; i < spans.length; i += 1) {
      assert.ok(spans[i].start >= spans[i - 1].end, 'spans must be disjoint')
    }
  })

  test('the mask answers overlap queries consistently', () => {
    const src = 'Keep `code` intact.'
    const spans = findProtectedSpans(src)
    const mask = buildProtectionMask(src.length, spans)
    const at = src.indexOf('`code`')
    assert.equal(maskOverlaps(mask, at, at + 6), true)
    assert.equal(maskOverlaps(mask, 0, 4), false)
  })

  test('empty input produces no spans', () => {
    assert.deepEqual(findProtectedSpans(''), [])
    assert.equal(countProtectedTerms([]), 0)
  })
})

// ── Segmentation and structure ──────────────────────────────────────────────

describe('segmentation', () => {
  test('splits paragraphs, list items, and code into blocks', () => {
    const src = '# Title\n\nDo the thing.\n\n- one\n- two\n\n```\ncode\n```'
    const blocks = splitBlocks(src, findProtectedSpans(src))
    const byKind = blocks.map((b) => b.kind)
    assert.ok(byKind.includes('heading'))
    assert.ok(byKind.includes('paragraph'))
    assert.equal(byKind.filter((k) => k === 'list-item').length, 2)
    assert.ok(byKind.includes('code'))
  })

  test('does not split on abbreviations or initials', () => {
    const segs = segmentPrompt('Ask Dr. Chen about e.g. the pricing. Then stop.')
    assert.equal(segs.length, 2)
  })

  test('offsets point back into the original text', () => {
    const src = 'First sentence. Second sentence.'
    for (const s of segmentPrompt(src)) {
      assert.equal(src.slice(s.start, s.end), s.text)
    }
  })

  test('classifies the standard prompt roles', () => {
    assert.equal(classifyRole('You are a senior copy editor.'), 'role')
    assert.equal(classifyRole('Write a summary of the report.'), 'task')
    assert.equal(classifyRole('Keep it under 200 words.'), 'constraint')
    assert.equal(classifyRole('Respond as JSON.'), 'format')
    assert.equal(classifyRole('For example: input A gives output B.'), 'example')
    assert.equal(classifyRole('What is the deadline?'), 'question')
    assert.equal(classifyRole('Thanks in advance!'), 'meta')
  })

  test('roleHistogram counts every segment once', () => {
    const segs = segmentPrompt('You are an editor. Write a summary. Keep it short.')
    const total = roleHistogram(segs).reduce((sum, r) => sum + r.count, 0)
    assert.equal(total, segs.length)
  })
})

// ── Entities and constraints ────────────────────────────────────────────────

describe('entity extraction', () => {
  test('finds numbers, dates, links, and file types', () => {
    const found = extractEntities('Send report.pdf to https://x.co by 2026-03-01 — all 12 pages.')
    const k = found.map((e) => e.kind)
    assert.ok(k.includes('url'))
    assert.ok(k.includes('date'))
    assert.ok(k.includes('file-type'))
    assert.ok(found.some((e) => e.kind === 'length-limit' || e.kind === 'number'))
  })

  test('does not mistake sentence casing for a name', () => {
    const found = extractEntities('Basically, this works. Thanks!')
    assert.equal(found.filter((e) => e.kind === 'proper-noun').length, 0)
  })

  test('does find real names, including alphanumeric ones', () => {
    const keys = extractEntities('Ask Priya Raman about the Q3 numbers.').map((e) => e.key)
    assert.ok(keys.includes('priya raman'))
    assert.ok(keys.includes('q3'))
  })

  test('counts negations but ignores idiomatic ones', () => {
    const sum = (t: string): number => [...countNegations(t).values()].reduce((a, b) => a + b, 0)
    assert.ok(sum('Do not do that.') >= 1)
    assert.equal(sum('whether or not you can'), 0)
  })

  test('“dont” and “don’t” are the same negation', () => {
    const a = extractEntities('dont miss anything').filter((e) => e.kind === 'negation').length
    const b = extractEntities("don't miss anything").filter((e) => e.kind === 'negation').length
    assert.equal(a, b)
  })
})

describe('constraint extraction', () => {
  test('finds three constraints in one sentence', () => {
    const c = extractConstraints('Make it professional, but not too formal, and keep it under 200 words.')
    const keys = c.map((x) => x.key)
    assert.ok(keys.includes('tone:professional'))
    assert.ok(keys.includes('tone:not-too-formal'))
    assert.ok(keys.some((k) => k.startsWith('length:200:words')))
  })

  test('a negated tone is a different constraint from the plain one', () => {
    const keys = extractConstraints('not too formal').map((c) => c.key)
    assert.ok(!keys.includes('tone:formal'))
  })

  test('flags genuinely contradictory limits', () => {
    const conflicts = findConflicts(extractConstraints('Keep it under 100 words. Also keep it under 300 words.'))
    assert.equal(conflicts.length, 1)
    assert.match(conflicts[0], /words limits/)
  })

  test('does not flag a nuance as a conflict', () => {
    assert.deepEqual(findConflicts(extractConstraints('Professional but not too formal.')), [])
  })

  test('flags two structured output formats', () => {
    const conflicts = findConflicts(extractConstraints('Respond as JSON. Actually respond as CSV.'))
    assert.ok(conflicts.some((c) => /more than one output format/i.test(c)))
  })
})

// ── Similarity ──────────────────────────────────────────────────────────────

describe('similarity', () => {
  test('containment detects a sentence that adds nothing', () => {
    const a = contentWords('Write a blog post about climate change.')
    const b = contentWords('The post should be about climate change.')
    assert.ok(containment(a, b) >= 0.99)
    assert.ok(similarity(a, b) < 0.8, 'Jaccard alone would miss this')
  })

  test('unrelated sentences score near zero', () => {
    assert.ok(containment(contentWords('Translate to French.'), contentWords('Deploy the server.')) < 0.3)
  })
})

// ── Grammar ─────────────────────────────────────────────────────────────────

describe('grammar and spelling', () => {
  test('corrects unambiguous misspellings only', () => {
    const edits = findSpellingEdits('recieve the enviroment')
    assert.equal(edits.length, 2)
    assert.deepEqual(edits.map((e) => e.replacement), ['receive', 'environment'])
  })

  test('preserves the original capitalization of a corrected word', () => {
    assert.equal(findSpellingEdits('Recieve it')[0].replacement, 'Receive')
  })

  test('leaves ambiguous contractions alone', () => {
    assert.equal(findSpellingEdits('its ill wont').length, 0)
  })

  test('leaves British spellings alone', () => {
    assert.equal(findSpellingEdits('analyse the colour and summarise it').length, 0)
  })

  test('flags repeated words but not legitimate doubles', () => {
    assert.equal(findGrammarEdits('the the report').length, 1)
    assert.equal(findGrammarEdits('had had enough').length, 0)
  })

  test('collapses runs of spaces without touching indentation', () => {
    assert.equal(findWhitespaceEdits('a  b').length, 1)
    assert.equal(findWhitespaceEdits('    indented').length, 0)
  })
})

// ── Application ─────────────────────────────────────────────────────────────

const sug = (over: Partial<Suggestion>): Suggestion => ({
  id: 'x', start: 0, end: 0, category: 'filler', original: '', replacement: '',
  title: 't', reason: 'r', confidence: 'high', score: 0.9, minLevel: 'light',
  safe: true, tokensSaved: 0, ...over,
})

describe('apply', () => {
  test('applies nothing when nothing is accepted', () => {
    const src = 'Please write it.'
    const s = [sug({ id: 'a', start: 0, end: 7, original: 'Please ' })]
    assert.equal(applyEdits(src, s, new Set()), src)
  })

  test('applies multiple edits without corrupting offsets', () => {
    const src = 'Please write it in order to help.'
    const s = [
      sug({ id: 'a', start: 0, end: 7, original: 'Please ' }),
      sug({ id: 'b', start: 16, end: 27, original: 'in order to', replacement: 'to' }),
    ]
    assert.equal(applyEdits(src, s, new Set(['a', 'b'])), 'Write it to help.')
  })

  test('drops an overlapping edit rather than corrupting text', () => {
    const src = 'abcdef'
    const s = [
      sug({ id: 'a', start: 0, end: 4, original: 'abcd', replacement: 'X' }),
      sug({ id: 'b', start: 2, end: 6, original: 'cdef', replacement: 'Y' }),
    ]
    assert.equal(applyEdits(src, s, new Set(['a', 'b'])), 'Xef')
  })

  test('repairSeams removes punctuation orphaned by a deletion', () => {
    assert.equal(repairSeams('Help me out., I need this.', [12]), 'Help me out. I need this.')
  })

  test('repairSeams re-capitalizes an exposed sentence opener', () => {
    assert.equal(repairSeams('help me out.', [0]), 'Help me out.')
  })

  test('repairSeams inserts the space a removed sentence took with it', () => {
    assert.equal(repairSeams('One thing.Another thing.', [10]), 'One thing. Another thing.')
  })

  test('tidy leaves fenced code byte-identical', () => {
    const src = 'Do it:\n\n```py\ndef f():\n    return  1\n```\n\nDone.'
    assert.ok(tidy(src).includes('    return  1'), 'code indentation and spacing must survive')
  })

  test('tidy does not eat an ellipsis', () => {
    assert.ok(tidy('Return {"a": "..."} exactly.').includes('"..."'))
  })

  test('buildDiff marks removed, added, and protected parts', () => {
    const src = 'Please run `npm test` now.'
    const spans = findProtectedSpans(src)
    const s = [sug({ id: 'a', start: 0, end: 7, original: 'Please ' })]
    const parts = buildDiff(src, s, new Set(['a']), spans)
    assert.equal(parts[0].kind, 'removed')
    assert.ok(parts.some((p) => p.kind === 'protected' && p.text === '`npm test`'))
    assert.equal(parts.map((p) => p.text).join(''), src)
  })
})

// ── Validation ──────────────────────────────────────────────────────────────

describe('validation', () => {
  test('reports a dropped number as a critical loss', () => {
    const r = validateMeaning({ original: 'Keep it under 200 words.', optimized: 'Keep it short.' })
    assert.equal(r.ok, false)
    assert.ok(r.issues.some((i) => i.severity === 'critical'))
    assert.equal(r.validated, true)
  })

  test('reports a dropped negation as a critical loss', () => {
    const r = validateMeaning({ original: 'Do not mention pricing.', optimized: 'Mention pricing.' })
    assert.equal(r.ok, false)
  })

  test('accepts a rewrite that keeps everything', () => {
    const r = validateMeaning({
      original: 'Please write a summary under 200 words.',
      optimized: 'Write a summary under 200 words.',
    })
    assert.equal(r.ok, true)
    assert.equal(r.meaningScore, 1)
  })

  test('an entity stated twice and now once is preserved, not lost', () => {
    const r = validateMeaning({
      original: 'Keep it to 100 words. Remember: 100 words.',
      optimized: 'Keep it to 100 words.',
    })
    assert.equal(r.ok, true)
  })

  test('a spelling fix inside an instruction is not a loss', () => {
    const r = validateMeaning({
      original: 'You should definately reconsider the pricing page.',
      optimized: 'You should definitely reconsider the pricing page.',
    })
    assert.equal(r.ok, true)
  })

  test('empty input validates trivially and still reports being validated', () => {
    const r = validateMeaning({ original: '', optimized: '' })
    assert.equal(r.ok, true)
    assert.equal(r.meaningScore, 1)
    assert.equal(r.validated, true)
  })
})

// ── Metrics ─────────────────────────────────────────────────────────────────

describe('tokens and readability', () => {
  test('token estimate is stable and floors at one for non-empty text', () => {
    assert.equal(estimateTokens(''), 0)
    assert.equal(estimateTokens('  '), 0)
    assert.equal(estimateTokens('a'), 1)
    assert.equal(estimateTokens('x'.repeat(400)), 100)
  })

  test('tokensSaved never goes negative', () => {
    assert.equal(tokensSaved('short', 'a much longer replacement string'), 0)
  })

  test('word count ignores surrounding whitespace', () => {
    assert.equal(countWords('  one two   three '), 3)
    assert.equal(countWords(''), 0)
  })

  test('saved impact is zero when nothing was saved', () => {
    const i = savedImpact('same', 'same')
    assert.equal(i.energyWh, 0)
    assert.equal(i.waterMl, 0)
    assert.equal(i.co2G, 0)
  })

  test('readability rises when a sentence gets shorter and simpler', () => {
    const before = readability('Notwithstanding the aforementioned considerations, the implementation necessitates substantial architectural reconsideration.')
    const after = readability('We need to rethink the design.')
    assert.ok(after.score > before.score)
  })

  test('syllable estimate is sane', () => {
    assert.equal(syllables('cat'), 1)
    assert.ok(syllables('environment') >= 3)
    assert.equal(syllables(''), 0)
  })
})

// ── Explanation ─────────────────────────────────────────────────────────────

describe('explain', () => {
  test('identifies task, tone, and format', () => {
    const text = 'You are an editor. Summarize the report as JSON. Keep it professional and under 100 words.'
    const segments = segmentPrompt(text)
    const constraints = extractConstraints(text)
    const e = explainPrompt({ segments, constraints, entities: extractEntities(text) })
    assert.equal(e.task, 'Summarize something')
    assert.match(e.tone, /professional/)
    assert.match(e.format, /json/)
    assert.ok(e.sections.length > 0)
  })

  test('finds the task even when it is buried mid-sentence', () => {
    const text = 'Basically, I really just need you to write a summary of the Q3 report.'
    const e = explainPrompt({
      segments: segmentPrompt(text),
      constraints: extractConstraints(text),
      entities: extractEntities(text),
    })
    assert.equal(e.task, 'Write new content')
  })

  test('says so plainly when there is no prompt', () => {
    const e = explainPrompt({ segments: [], constraints: [], entities: [] })
    assert.equal(e.task, 'No clear task detected')
  })
})
