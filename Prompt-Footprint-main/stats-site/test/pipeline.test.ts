// Integration tests: the whole pipeline, the memory system, the optional
// Gemini path, and the evaluation thresholds.

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { analyzePrompt, computeAnalytics, optimize, recompute } from '../src/lib/tokenCutter/index.ts'
import { buildDiff } from '../src/lib/tokenCutter/apply.ts'
import {
  createMemoryEntry, deriveTriggers, emptyMemory, exportMemory, importMemory,
  loadMemory, normalizeMemory, proposeMemories, relevantMemories, saveMemory,
} from '../src/lib/tokenCutter/memory.ts'
import {
  buildEnhancementInstruction, enhanceWithGemini, extractJsonObject, parseEnhancementResponse,
} from '../src/lib/tokenCutter/gemini.ts'
import { runEvaluation } from '../src/lib/tokenCutter/evaluate.ts'
import { extractConstraints } from '../src/lib/tokenCutter/constraints.ts'
import type { MemoryState } from '../src/lib/tokenCutter/types.ts'

// ── The main workflow ───────────────────────────────────────────────────────

describe('pipeline', () => {
  test('a verbose prompt is reduced and validated', () => {
    const { optimized, result } = optimize(
      'Hi there! I was wondering if you could please write a short summary of the report. Thanks in advance!',
    )
    assert.ok(result.analytics.tokensSaved > 0)
    assert.ok(optimized.includes('summary'))
    assert.ok(optimized.includes('report'))
    assert.equal(result.validation.ok, true)
    assert.equal(result.validation.validated, true)
  })

  test('the original is never mutated', () => {
    const original = 'Please just write it.'
    const result = analyzePrompt(original)
    assert.equal(result.original, original)
    assert.notEqual(result.optimized, original)
  })

  test('rejecting every suggestion restores the original exactly', () => {
    const original = 'Hi! Could you please basically write a summary in order to help me?'
    const result = analyzePrompt(original)
    assert.ok(result.defaultAccepted.length > 0)
    const restored = recompute(result, new Set())
    assert.equal(restored.optimized, original)
    assert.equal(restored.analytics.tokensSaved, 0)
    assert.equal(restored.analytics.suggestionsAccepted, 0)
  })

  test('accepting one suggestion at a time is additive', () => {
    const result = analyzePrompt('Hi there! Please basically write the summary.')
    const ids = result.defaultAccepted
    assert.ok(ids.length >= 2)

    let previous = Infinity
    for (let i = 1; i <= ids.length; i += 1) {
      const partial = recompute(result, new Set(ids.slice(0, i)))
      assert.ok(partial.analytics.optimizedTokens <= previous, 'each accept must not grow the prompt')
      previous = partial.analytics.optimizedTokens
    }
  })

  test('higher levels never propose fewer suggestions', () => {
    const text =
      'Hello! I was wondering whether or not you could quite simply help me draft an email. In addition, please make it friendly.'
    const light = analyzePrompt(text, { level: 'light' }).suggestions.length
    const balanced = analyzePrompt(text, { level: 'balanced' }).suggestions.length
    const maximum = analyzePrompt(text, { level: 'maximum' }).suggestions.length
    assert.ok(balanced >= light)
    assert.ok(maximum >= balanced)
  })

  test('maximum reduces at least as much as light', () => {
    const text =
      'Hello there! I was just wondering if you could possibly, at this point in time, due to the fact that we are busy, go ahead and write a list of five ideas. Thanks so much!'
    const light = analyzePrompt(text, { level: 'light' })
    const maximum = analyzePrompt(text, { level: 'maximum' })
    assert.ok(maximum.analytics.tokensSaved >= light.analytics.tokensSaved)
    assert.ok(maximum.optimized.includes('five ideas'))
  })

  test('low-confidence suggestions are never applied automatically', () => {
    const result = analyzePrompt('It should quite possibly be handled. They will know what that means.', { level: 'maximum' })
    const accepted = new Set(result.defaultAccepted)
    for (const s of result.suggestions) {
      if (s.confidence === 'low' || s.advisory) {
        assert.equal(accepted.has(s.id), false, `${s.id} (${s.confidence}) must not be pre-accepted`)
      }
    }
  })

  test('advisory notes carry no edit and cannot be applied', () => {
    const result = analyzePrompt('It should be handled. They will know what that means and how it works.')
    const advisory = result.suggestions.filter((s) => s.advisory)
    for (const a of advisory) {
      assert.equal(a.tokensSaved, 0)
      assert.equal(recompute(result, new Set([a.id])).optimized, result.original)
    }
  })

  test('code, JSON, and links survive untouched', () => {
    const text = [
      'Could you please refactor this in order to be faster?',
      '',
      '```py',
      'def f(x):',
      '    return x * 2',
      '```',
      '',
      'Return {"code": "..."} and read https://ex.com/docs?a=1 first.',
    ].join('\n')
    const { optimized } = optimize(text, { level: 'maximum' })
    assert.ok(optimized.includes('def f(x):'))
    assert.ok(optimized.includes('    return x * 2'))
    assert.ok(optimized.includes('{"code": "..."}'))
    assert.ok(optimized.includes('https://ex.com/docs?a=1'))
  })

  test('a prompt with nothing to cut is left alone', () => {
    const text = 'Translate to French. Keep proper nouns unchanged.'
    const result = analyzePrompt(text)
    assert.equal(result.optimized, text)
    assert.equal(result.analytics.tokensSaved, 0)
  })

  test('conflicting requirements are surfaced', () => {
    const result = analyzePrompt('Write it in under 100 words. Also keep it under 300 words.')
    assert.ok(result.explanation.conflicts.length > 0)
  })

  test('analytics agree with the text they describe', () => {
    const result = analyzePrompt('Hi there! Please write a 300 word summary of the Q3 report.')
    const a = result.analytics
    assert.equal(a.tokensSaved, a.originalTokens - a.optimizedTokens)
    assert.ok(Math.abs(a.percentReduction - (a.tokensSaved / a.originalTokens) * 100) < 1e-9)
    assert.ok(a.saved.energyWh > 0 && a.saved.waterMl > 0 && a.saved.co2G > 0)
    assert.equal(a.suggestionsAccepted + a.suggestionsRejected, a.suggestionsTotal)
  })

  test('Claude reports a higher saving than ChatGPT for the same cut', () => {
    const text = 'Hi there! Please write a summary. Thanks in advance!'
    const gpt = analyzePrompt(text, { platform: 'chatgpt' }).analytics.saved
    const claude = analyzePrompt(text, { platform: 'claude' }).analytics.saved
    assert.ok(claude.energyWh > gpt.energyWh)
  })

  test('the diff reconstructs the original exactly', () => {
    const text = 'Hi there! Please write a summary of `report.md` in order to help.'
    const result = analyzePrompt(text)
    const parts = buildDiff(text, result.suggestions, new Set(result.defaultAccepted), result.protectedSpans)
    const rebuilt = parts.filter((p) => p.kind !== 'added').map((p) => p.text).join('')
    assert.equal(rebuilt, text)
  })

  test('empty and whitespace-only input is handled without throwing', () => {
    for (const input of ['', '   ', '\n\n']) {
      const result = analyzePrompt(input)
      assert.equal(result.suggestions.length, 0)
      assert.equal(result.analytics.tokensSaved, 0)
      assert.equal(result.validation.ok, true)
    }
  })

  test('malformed and adversarial input does not throw', () => {
    const inputs = [
      '```unclosed fence\nstuff',
      '{"unbalanced": ',
      '"""""""',
      '((((((((((',
      '\u0000\u001b[31m control bytes',   // NUL + an ANSI escape, written as escapes
      '😀'.repeat(200),
      'a'.repeat(20000),
    ]
    for (const input of inputs) {
      assert.doesNotThrow(() => analyzePrompt(input, { level: 'maximum' }))
    }
  })

  test('a multi-page prompt is analyzed in reasonable time', () => {
    const paragraph =
      'Hi there! I was wondering if you could please help me with the report. Basically, I really just need a summary that is professional but not too formal, and it should be under 500 words. Thanks in advance!\n\n'
    const long = paragraph.repeat(60) // ~12k characters
    const started = Date.now()
    const result = analyzePrompt(long, { level: 'balanced' })
    const elapsed = Date.now() - started
    assert.ok(result.analytics.tokensSaved > 0)
    assert.ok(elapsed < 8000, `analysis took ${elapsed}ms`)
  })

  test('mixed-language content is preserved', () => {
    const text = 'Please translate: "El equipo está muy contento." Keep 日本語 terms as they are.'
    const { optimized } = optimize(text, { level: 'maximum' })
    assert.ok(optimized.includes('El equipo está muy contento.'))
    assert.ok(optimized.includes('日本語'))
  })

  test('computeAnalytics is a pure function of its inputs', () => {
    const result = analyzePrompt('Hi! Please write a summary.')
    const args = {
      original: result.original,
      optimized: result.optimized,
      suggestions: result.suggestions,
      accepted: new Set(result.defaultAccepted),
      constraints: result.constraints,
      protectedSpans: result.protectedSpans,
      platform: 'chatgpt' as const,
    }
    assert.deepEqual(computeAnalytics(args), computeAnalytics(args))
  })
})

// ── Memory ──────────────────────────────────────────────────────────────────

describe('memory', () => {
  const store = new Map<string, string>()

  beforeEach(() => {
    store.clear()
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
    }
  })

  test('round-trips through storage', async () => {
    const state: MemoryState = {
      enabled: true,
      entries: [createMemoryEntry('never-remove', 'Northwind Logistics')],
    }
    await saveMemory(state)
    const loaded = await loadMemory()
    assert.equal(loaded.entries.length, 1)
    assert.equal(loaded.entries[0].value, 'Northwind Logistics')
  })

  test('corrupt stored data degrades to an empty state instead of throwing', async () => {
    store.set('pf_cutter_memory', '{not json')
    assert.deepEqual(await loadMemory(), emptyMemory())
  })

  test('normalizeMemory drops entries that are not memories', () => {
    const state = normalizeMemory({ enabled: true, entries: [{ nope: 1 }, null, 'x'] })
    assert.equal(state.entries.length, 0)
  })

  test('a never-remove term is protected in the optimized output', () => {
    const memory: MemoryState = {
      enabled: true,
      entries: [createMemoryEntry('never-remove', 'basically perfect')],
    }
    const withMemory = analyzePrompt('The design is basically perfect. Please just ship it.', { memory, level: 'maximum' })
    assert.ok(withMemory.optimized.includes('basically perfect'))
    assert.ok(withMemory.appliedMemories.length > 0)
    assert.match(withMemory.appliedMemories[0].effect, /Protected|protected/)
  })

  test('memory changes the result compared with memory off', () => {
    const text = 'The design is basically perfect. Please just ship it.'
    const off = analyzePrompt(text, { level: 'maximum' })
    const on = analyzePrompt(text, {
      level: 'maximum',
      memory: { enabled: true, entries: [createMemoryEntry('never-remove', 'basically perfect')] },
    })
    assert.notEqual(off.optimized, on.optimized)
  })

  test('the master switch disables everything', () => {
    const memory: MemoryState = {
      enabled: false,
      entries: [createMemoryEntry('never-remove', 'basically perfect')],
    }
    const result = analyzePrompt('The design is basically perfect.', { memory, level: 'maximum' })
    assert.equal(result.appliedMemories.length, 0)
  })

  test('a disabled entry is ignored', () => {
    const entry = { ...createMemoryEntry('never-remove', 'Northwind'), enabled: false }
    const relevant = relevantMemories({ enabled: true, entries: [entry] }, {
      text: 'Ship the Northwind release.',
      constraints: [],
    })
    assert.equal(relevant.length, 0)
  })

  test('irrelevant memories are not applied', () => {
    const memory: MemoryState = {
      enabled: true,
      entries: [createMemoryEntry('project', 'Northwind Logistics')],
    }
    const relevant = relevantMemories(memory, { text: 'Write a haiku about rain.', constraints: [] })
    assert.equal(relevant.length, 0)
  })

  test('the current prompt overrides a stored preference', () => {
    const memory: MemoryState = { enabled: true, entries: [createMemoryEntry('tone', 'friendly')] }
    const text = 'Write it in a formal tone, friendly is wrong here.'
    const relevant = relevantMemories(memory, { text, constraints: extractConstraints(text) })
    assert.equal(relevant.some((m) => m.category === 'tone'), false)
  })

  test('at most six memories apply to one prompt', () => {
    const entries = Array.from({ length: 20 }, (_, i) => createMemoryEntry('format', `preference ${i}`))
    const relevant = relevantMemories({ enabled: true, entries }, { text: 'Write something.', constraints: [] })
    assert.ok(relevant.length <= 6)
  })

  test('triggers are derived from the value', () => {
    assert.deepEqual(deriveTriggers('never-remove', 'Acme Corp'), ['acme corp'])
    assert.ok(deriveTriggers('style', 'prefer short paragraphs').includes('paragraphs'))
  })

  test('proposals are offered, never saved', () => {
    const proposed = proposeMemories(extractConstraints('Keep it under 200 words and professional.'), [])
    assert.ok(proposed.length > 0)
    assert.ok(proposed.every((p) => p.source === 'learned'))
  })

  test('export and import round-trip', () => {
    const state: MemoryState = { enabled: true, entries: [createMemoryEntry('tone', 'warm')] }
    const reimported = importMemory(exportMemory(state))
    assert.equal(reimported.entries[0].value, 'warm')
  })

  test('importing rubbish reports a readable error', () => {
    assert.throws(() => importMemory('not json'), /not valid JSON/)
    assert.throws(() => importMemory('{"entries":[]}'), /No memories/)
  })
})

// ── Optional Gemini enhancement ─────────────────────────────────────────────

describe('gemini enhancement', () => {
  const realFetch = globalThis.fetch
  const base = {
    text: 'Please write a summary of the report in under 200 words.',
    proxyUrl: 'https://proxy.example.workers.dev',
    level: 'balanced' as const,
    protectedContent: ['200 words'],
    constraints: extractConstraints('Please write a summary of the report in under 200 words.'),
    entities: [],
  }

  const mockFetch = (impl: () => Promise<Response> | Response): void => {
    ;(globalThis as { fetch: unknown }).fetch = async () => impl()
  }
  const restore = (): void => { (globalThis as { fetch: unknown }).fetch = realFetch }
  const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  test('the instruction names the constraints and demands a JSON envelope', () => {
    const instruction = buildEnhancementInstruction(base)
    assert.match(instruction, /You are NOT answering it/)
    assert.match(instruction, /PROTECTED:/)
    assert.match(instruction, /CONSTRAINTS:/)
    assert.match(instruction, /"meaningScore"/)
    assert.match(instruction, /Never remove a negation/)
  })

  test('extractJsonObject survives fences and surrounding prose', () => {
    assert.deepEqual(extractJsonObject('```json\n{"a":1}\n```'), { a: 1 })
    assert.deepEqual(extractJsonObject('Sure! {"a":{"b":2}} Hope that helps.'), { a: { b: 2 } })
    assert.equal(extractJsonObject('no json here'), null)
  })

  test('a malformed payload is rejected rather than partially trusted', () => {
    assert.equal(parseEnhancementResponse({ optimized: '' }), null)
    assert.equal(parseEnhancementResponse(null), null)
    const ok = parseEnhancementResponse({ optimized: 'x', preservedConstraints: 'nope', meaningScore: 'high' })
    assert.deepEqual(ok?.preservedConstraints, [])
    assert.equal(ok?.meaningScore, 0)
  })

  test('with no proxy configured it reports "not configured" and falls back', async () => {
    const out = await enhanceWithGemini({ ...base, proxyUrl: '' })
    assert.equal(out.optimized, null)
    assert.equal(out.report.applied, false)
    assert.match(out.report.fallbackReason ?? '', /local result/)
  })

  test('a network failure falls back to local', async () => {
    mockFetch(() => { throw new Error('offline') })
    const out = await enhanceWithGemini(base)
    restore()
    assert.equal(out.optimized, null)
    assert.match(out.report.status, /unavailable/i)
  })

  test('a 429 is reported as rate limiting, not as an error', async () => {
    mockFetch(() => jsonResponse({ error: 'slow down' }, 429))
    const out = await enhanceWithGemini(base)
    restore()
    assert.match(out.report.status, /Rate limited/)
    assert.equal(out.optimized, null)
  })

  test('non-JSON output falls back to local', async () => {
    mockFetch(() => new Response('<html>nope</html>', { status: 200 }))
    const out = await enhanceWithGemini(base)
    restore()
    assert.equal(out.optimized, null)
    assert.match(out.report.status, /Invalid response/)
  })

  test('a rewrite that mangles protected content is rejected', async () => {
    mockFetch(() => jsonResponse({
      cutter: JSON.stringify({
        optimized: 'Write a summary of the report, briefly.',
        preservedConstraints: [], removedRedundancies: [], uncertainChanges: [],
        protectedContent: [], meaningScore: 0.99,
      }),
    }))
    const out = await enhanceWithGemini(base)
    restore()
    assert.equal(out.optimized, null)
    assert.match(out.report.fallbackReason ?? '', /protected/)
  })

  test('a rewrite that drops a constraint is rejected by local validation', async () => {
    mockFetch(() => jsonResponse({
      cutter: {
        optimized: 'Write a summary of the report. 200 words.',
        preservedConstraints: ['under 200 words'], removedRedundancies: [],
        uncertainChanges: [], protectedContent: ['200 words'], meaningScore: 1,
      },
    }))
    const out = await enhanceWithGemini({
      ...base,
      text: 'Please write a summary of the report in under 200 words and do not mention pricing.',
      constraints: extractConstraints('Please write a summary of the report in under 200 words and do not mention pricing.'),
    })
    restore()
    assert.equal(out.optimized, null)
    assert.match(out.report.fallbackReason ?? '', /lost|dropped|removed/i)
  })

  test('a valid rewrite is accepted and reported', async () => {
    mockFetch(() => jsonResponse({
      cutter: {
        optimized: 'Write a report summary under 200 words.',
        preservedConstraints: ['under 200 words'],
        removedRedundancies: ['polite lead-in'],
        uncertainChanges: [], protectedContent: ['200 words'], meaningScore: 0.97,
      },
    }))
    const out = await enhanceWithGemini(base)
    restore()
    assert.equal(out.optimized, 'Write a report summary under 200 words.')
    assert.equal(out.report.applied, true)
    assert.equal(out.validation?.validated, true)
    assert.equal(out.report.meaningScore, 0.97)
  })

  test('an over-long prompt is not sent at all', async () => {
    let called = false
    mockFetch(() => { called = true; return jsonResponse({}) })
    const out = await enhanceWithGemini({ ...base, text: 'x'.repeat(5000) })
    restore()
    assert.equal(called, false)
    assert.equal(out.optimized, null)
    assert.match(out.report.status, /too long/i)
  })

  test('no API key ever appears in the request path', () => {
    const instruction = buildEnhancementInstruction(base)
    assert.equal(/AIza|api[_-]?key|Authorization/i.test(instruction), false)
  })
})

// ── Evaluation thresholds ───────────────────────────────────────────────────

describe('evaluation dataset', () => {
  test('every case passes, and preservation stays at 100%', () => {
    const report = runEvaluation()
    const failures = report.cases.filter((c) => !c.passed)
    assert.deepEqual(
      failures.map((f) => `${f.id}: ${f.failures.join('; ')}`),
      [],
      'no evaluation case may regress',
    )
    assert.equal(report.constraintPreservation, 1)
    assert.equal(report.entityPreservation, 1)
    assert.equal(report.unsafeSuggestionRate, 0)
    assert.ok(report.averageReduction > 0.1, `average reduction was ${report.averageReduction}`)
  })
})
