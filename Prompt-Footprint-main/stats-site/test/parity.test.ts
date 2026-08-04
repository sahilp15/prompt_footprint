// The web app and the extension must never disagree about a number.
// ---------------------------------------------------------------------------
// `src/lib/tokenCutter/tokens.ts` is a deliberate mirror of the extension's
// raw-loaded `lib/tokenEstimator.js` + `lib/constants.js` + `lib/
// environmentalModel.js`, which cannot be imported from an ESM bundle. This
// test loads both implementations and asserts they agree, so the mirror can
// never silently drift.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

import { IMPACT_CONSTANTS, PLATFORM_PROFILES, estimateTokens, impactForTokens } from '../src/lib/tokenCutter/tokens.ts'

const require = createRequire(import.meta.url)
const extTokens = require('../../extension/lib/tokenEstimator.js') as {
  estimateTokens(text: string): number
}
const extConstants = require('../../extension/lib/constants.js') as {
  ENERGY_PER_TOKEN_WH: number
  WATER_PER_TOKEN_ML: number
  CO2_PER_TOKEN_G: number
  CLAUDE_RELATIVE_INTENSITY: number
  ANNUAL_TOKENS: number
  AVG_TOKENS_PER_INTERACTION: number
}
const extModel = require('../../extension/lib/environmentalModel.js') as {
  calculateImpact(tokens: number, options: { platform: string }): {
    energyWh: number; waterMl: number; co2G: number
  }
}

const CORPUS = [
  '',
  '   ',
  'a',
  'Hello world',
  'Please write a 200 word summary of the attached report, in a professional tone.',
  'const x = { a: 1, b: [2, 3] }\nconsole.log(x)',
  '🌍 Multi-byte content — ünïcödé, 日本語, and emoji 🚀',
  'x'.repeat(5000),
  'Line one\n\nLine two\n\n\nLine three',
]

test('estimateTokens matches the extension byte for byte', () => {
  for (const text of CORPUS) {
    assert.equal(
      estimateTokens(text),
      extTokens.estimateTokens(text),
      `token estimate diverged for: ${JSON.stringify(text.slice(0, 40))}`,
    )
  }
})

test('per-token intensities match the extension constants', () => {
  assert.equal(IMPACT_CONSTANTS.ENERGY_PER_TOKEN_WH, extConstants.ENERGY_PER_TOKEN_WH)
  assert.equal(IMPACT_CONSTANTS.WATER_PER_TOKEN_ML, extConstants.WATER_PER_TOKEN_ML)
  assert.equal(IMPACT_CONSTANTS.CO2_PER_TOKEN_G, extConstants.CO2_PER_TOKEN_G)
  assert.equal(IMPACT_CONSTANTS.CLAUDE_RELATIVE_INTENSITY, extConstants.CLAUDE_RELATIVE_INTENSITY)
  assert.equal(IMPACT_CONSTANTS.ANNUAL_TOKENS, extConstants.ANNUAL_TOKENS)
  assert.equal(IMPACT_CONSTANTS.AVG_TOKENS_PER_INTERACTION, extConstants.AVG_TOKENS_PER_INTERACTION)
})

test('impactForTokens matches calculateImpact for both platforms', () => {
  for (const platform of ['chatgpt', 'claude'] as const) {
    for (const tokens of [0, 1, 42, 1000, 123_456]) {
      const mine = impactForTokens(tokens, platform)
      const theirs = extModel.calculateImpact(tokens, { platform })
      assert.equal(mine.energyWh, theirs.energyWh, `energy diverged (${platform}, ${tokens})`)
      assert.equal(mine.waterMl, theirs.waterMl, `water diverged (${platform}, ${tokens})`)
      assert.equal(mine.co2G, theirs.co2G, `co2 diverged (${platform}, ${tokens})`)
    }
  }
})

test('Claude is scaled from the ChatGPT anchor, not defined independently', () => {
  const c = PLATFORM_PROFILES.chatgpt
  const cl = PLATFORM_PROFILES.claude
  assert.equal(cl.energyPerTokenWh, c.energyPerTokenWh * IMPACT_CONSTANTS.CLAUDE_RELATIVE_INTENSITY)
  assert.equal(cl.waterPerTokenMl, c.waterPerTokenMl * IMPACT_CONSTANTS.CLAUDE_RELATIVE_INTENSITY)
  assert.equal(cl.co2PerTokenG, c.co2PerTokenG * IMPACT_CONSTANTS.CLAUDE_RELATIVE_INTENSITY)
})

test('an unknown platform falls back to the ChatGPT anchor', () => {
  const unknown = impactForTokens(1000, 'nope' as unknown as 'chatgpt')
  assert.deepEqual(unknown, impactForTokens(1000, 'chatgpt'))
})
