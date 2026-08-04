// Token estimation and the environmental model — the single implementation the
// web app uses.
// ---------------------------------------------------------------------------
// PromptFootprint reports the same numbers everywhere, so this file is a
// deliberate mirror of the extension's `lib/tokenEstimator.js` +
// `lib/constants.js` + `lib/environmentalModel.js`. The extension loads those
// files raw as content-script globals (no bundler, no ESM), so they cannot be
// imported here directly — instead `test/parity.test.ts` loads both this module
// and the extension's originals and asserts they agree, which turns "keep these
// in sync" from a comment into a failing test.
//
// Do not introduce a second conversion factor anywhere in the app. If a figure
// needs to change, change it in the extension and let the parity test tell you
// what to update here.

import type { ImpactFigures } from './types.ts'

// ── Environmental constants (mirror of extension/lib/constants.js) ──────────

/** OpenAI 2025 Sustainability Disclosure (GPT-4o), annual totals. */
const ANNUAL_ENERGY_WH = 390_000_000_000
const ANNUAL_WATER_ML = 1_300_000_000_000
const ANNUAL_CO2_G = 138_000_000_000

const TOKENS_PER_WORD = 1.3
const AVG_PROMPT_WORDS = 41
const AVG_RESPONSE_WORDS = 269
const AVG_TOKENS_PER_INTERACTION = Math.round(
  TOKENS_PER_WORD * (AVG_PROMPT_WORDS + AVG_RESPONSE_WORDS),
)
const DAILY_MESSAGES = 2_500_000_000
const ANNUAL_TOKENS = DAILY_MESSAGES * AVG_TOKENS_PER_INTERACTION * 365

const ENERGY_PER_TOKEN_WH = ANNUAL_ENERGY_WH / ANNUAL_TOKENS
const WATER_PER_TOKEN_ML = ANNUAL_WATER_ML / ANNUAL_TOKENS
const CO2_PER_TOKEN_G = ANNUAL_CO2_G / ANNUAL_TOKENS

/** Claude is expressed relative to the GPT-4o anchor; see METHODOLOGY.md. */
const CLAUDE_RELATIVE_INTENSITY = 1.15

export type PlatformId = 'chatgpt' | 'claude'

export interface PlatformProfile {
  id: PlatformId
  label: string
  energyPerTokenWh: number
  waterPerTokenMl: number
  co2PerTokenG: number
}

export const PLATFORM_PROFILES: Record<PlatformId, PlatformProfile> = {
  chatgpt: {
    id: 'chatgpt',
    label: 'ChatGPT (GPT-4o baseline)',
    energyPerTokenWh: ENERGY_PER_TOKEN_WH,
    waterPerTokenMl: WATER_PER_TOKEN_ML,
    co2PerTokenG: CO2_PER_TOKEN_G,
  },
  claude: {
    id: 'claude',
    label: 'Claude (3.x Sonnet estimate)',
    energyPerTokenWh: ENERGY_PER_TOKEN_WH * CLAUDE_RELATIVE_INTENSITY,
    waterPerTokenMl: WATER_PER_TOKEN_ML * CLAUDE_RELATIVE_INTENSITY,
    co2PerTokenG: CO2_PER_TOKEN_G * CLAUDE_RELATIVE_INTENSITY,
  },
}

// ── Token estimation ────────────────────────────────────────────────────────

/**
 * Estimate cl100k_base tokens for a string.
 *
 * Byte-for-byte the extension's rule: trim, then ~4 characters per token, with
 * a floor of 1 for any non-empty string. Code tokenizes nearer 3.5 chars/token
 * and prose nearer 4.5, so 4 is the midpoint the whole product is calibrated on.
 */
export function estimateTokens(text: string): number {
  if (!text || typeof text !== 'string') return 0
  const trimmed = text.trim()
  if (!trimmed) return 0
  return Math.max(1, Math.ceil(trimmed.length / 4))
}

/** Words, counted the way a person would: runs of non-whitespace. */
export function countWords(text: string): number {
  if (!text) return 0
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

/**
 * Tokens saved by replacing `original` with `optimized`. Clamped at zero — a
 * rewrite that grows the prompt has saved nothing, it has cost something, and
 * the caller decides how to present that.
 */
export function tokensSaved(original: string, optimized: string): number {
  return Math.max(0, estimateTokens(original) - estimateTokens(optimized))
}

// ── Environmental impact ────────────────────────────────────────────────────

/**
 * Energy, water, and CO₂ for a token count on a given platform.
 *
 * Matches `calculateImpact(tokens, { platform })` in the extension. The
 * response-time and heatwave factors deliberately do not apply here: those
 * scale a *measured* response, and a prompt that is never sent has no response
 * time, so the token-only figure is the honest floor.
 */
export function impactForTokens(tokens: number, platform: PlatformId = 'chatgpt'): ImpactFigures {
  const profile = PLATFORM_PROFILES[platform] || PLATFORM_PROFILES.chatgpt
  const n = Number.isFinite(tokens) ? Math.max(0, tokens) : 0
  return {
    energyWh: n * profile.energyPerTokenWh,
    waterMl: n * profile.waterPerTokenMl,
    co2G: n * profile.co2PerTokenG,
  }
}

/** Convenience: the impact avoided by shortening `original` to `optimized`. */
export function savedImpact(
  original: string,
  optimized: string,
  platform: PlatformId = 'chatgpt',
): ImpactFigures {
  return impactForTokens(tokensSaved(original, optimized), platform)
}

/** Exposed for the parity test and for documentation surfaces. */
export const IMPACT_CONSTANTS = {
  ENERGY_PER_TOKEN_WH,
  WATER_PER_TOKEN_ML,
  CO2_PER_TOKEN_G,
  CLAUDE_RELATIVE_INTENSITY,
  ANNUAL_TOKENS,
  AVG_TOKENS_PER_INTERACTION,
} as const
