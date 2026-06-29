// PromptFootprint Environmental Constants
// Source: "A Token-Level Framework for Quantifying ChatGPT's Environmental Impacts"
// by Sahil Parasharami

// Annual global quantities (OpenAI 2025 Sustainability Disclosure, GPT-4o)
const ANNUAL_ENERGY_WH = 390_000_000_000;       // 390,000 MWh = 390 billion Wh
const ANNUAL_WATER_ML = 1_300_000_000_000;       // 1,300,000 kL = 1.3 trillion mL
const ANNUAL_CO2_G = 138_000_000_000;            // 138,000 metric tons = 138 billion g

// Token estimation
const TOKENS_PER_WORD = 1.3;
const AVG_PROMPT_WORDS = 41;
const AVG_RESPONSE_WORDS = 269;
const AVG_TOKENS_PER_INTERACTION = Math.round(TOKENS_PER_WORD * (AVG_PROMPT_WORDS + AVG_RESPONSE_WORDS)); // 403

// Daily and annual token volumes
const DAILY_MESSAGES = 2_500_000_000;
const ANNUAL_TOKENS = DAILY_MESSAGES * AVG_TOKENS_PER_INTERACTION * 365; // ~367,737,500,000,000

// Per-token environmental intensities (GPT-4o baseline)
const ENERGY_PER_TOKEN_WH = ANNUAL_ENERGY_WH / ANNUAL_TOKENS;   // ~1.0607e-3 Wh/token
const WATER_PER_TOKEN_ML = ANNUAL_WATER_ML / ANNUAL_TOKENS;     // ~3.536e-3 mL/token
const CO2_PER_TOKEN_G = ANNUAL_CO2_G / ANNUAL_TOKENS;           // ~3.753e-4 g/token

// Per 1,000 tokens (for display/validation)
const ENERGY_PER_1K_TOKENS_WH = ENERGY_PER_TOKEN_WH * 1000;    // ~1.065 Wh
const WATER_PER_1K_TOKENS_ML = WATER_PER_TOKEN_ML * 1000;       // ~3.536 mL
const CO2_PER_1K_TOKENS_G = CO2_PER_TOKEN_G * 1000;             // ~0.3753 g

// GPT-5 reasoning multipliers (Jegham et al. hardware benchmarks)
const REASONING_MULTIPLIERS = {
  none: 1.0,       // GPT-4o baseline
  minimal: 1.9,    // GPT-5 minimal reasoning
  moderate: 6.0,   // GPT-5 moderate reasoning
  high: 14.0       // GPT-5 high reasoning
};

// ─────────────────────────────────────────────────────────────────────────--
// Per-platform environmental profiles
// ─────────────────────────────────────────────────────────────────────────--
// The ChatGPT/GPT-4o per-token intensities above are derived top-down from
// OpenAI's 2025 sustainability disclosure (annual energy/water/CO2 ÷ annual
// tokens) and are treated as the ANCHOR. Other platforms are expressed
// relative to that anchor via `relativeIntensity`.
//
// CLAUDE SCALING — assumptions, method, sources, limitations
//   Anthropic does NOT publish a per-prompt energy/water/CO2 figure, so a
//   defensible Claude estimate must be derived indirectly. We anchor to the
//   GPT-4o per-token baseline and apply a relative-intensity factor:
//
//     claude_perToken = gpt4o_perToken × CLAUDE_RELATIVE_INTENSITY
//
//   CLAUDE_RELATIVE_INTENSITY = 1.15 (central estimate). Basis:
//     • Independent benchmarking (Jegham et al. 2025, "How Hungry is AI?",
//       arXiv:2505.09598) finds Claude 3.x Sonnet to be among the MOST
//       energy-efficient frontier models per task, yet a capable dense model
//       broadly comparable in per-token compute to GPT-4o.
//     • Empirical inference measurements place output-token energy in the
//       0.0001–0.002 Wh/token range; the GPT-4o anchor (~0.00106 Wh/token)
//       and the scaled Claude value (~0.00122 Wh/token) both sit inside it.
//   LIMITATION: this is an order-of-magnitude estimate with an uncertainty
//   band of roughly 0.8×–3× the anchor. Water/CO2 are scaled by the same
//   factor under the assumption that Claude runs on hyperscale cloud data
//   centers (AWS/GCP) with PUE/WUE/grid-intensity comparable to the GPT-4o
//   baseline. Treat absolute Claude numbers as indicative, not authoritative.
const CLAUDE_RELATIVE_INTENSITY = 1.15;

const PLATFORM_PROFILES = {
  chatgpt: {
    id: 'chatgpt',
    label: 'ChatGPT (GPT-4o baseline)',
    energyPerTokenWh: ENERGY_PER_TOKEN_WH,
    waterPerTokenMl: WATER_PER_TOKEN_ML,
    co2PerTokenG: CO2_PER_TOKEN_G,
    // Typical sustained output generation rate (tokens/sec), used as the
    // reference throughput for the response-time model. ~55 tok/s for GPT-4o.
    baselineTokensPerSec: 55,
    sources: [
      'OpenAI 2025 Sustainability Disclosure (GPT-4o)',
      "Parasharami, 'A Token-Level Framework for Quantifying ChatGPT's Environmental Impacts' (Vanderbilt YSJ)",
    ],
  },
  claude: {
    id: 'claude',
    label: 'Claude (3.x Sonnet estimate)',
    energyPerTokenWh: ENERGY_PER_TOKEN_WH * CLAUDE_RELATIVE_INTENSITY,
    waterPerTokenMl: WATER_PER_TOKEN_ML * CLAUDE_RELATIVE_INTENSITY,
    co2PerTokenG: CO2_PER_TOKEN_G * CLAUDE_RELATIVE_INTENSITY,
    baselineTokensPerSec: 45,
    sources: [
      'Jegham et al. 2025, "How Hungry is AI?" arXiv:2505.09598 (relative scaling)',
      'GPT-4o anchor scaled by CLAUDE_RELATIVE_INTENSITY = 1.15 (see notes)',
    ],
  },
};

// Response-time-aware model parameters.
//   Energy/water/CO2 = token estimate × timeFactor, where timeFactor scales up
//   for responses that stream SLOWER than the platform baseline (a proxy for
//   heavier per-token compute — e.g. reasoning or server load). The token
//   estimate is always the FLOOR: fast responses are never scaled below 1×.
//   LIMITATION: measured response time includes network/queue/time-to-first-
//   token, not just GPU work, so timeFactor is a bounded heuristic, not a
//   physical measurement. Hence the cap.
const RESPONSE_TIME_MODEL = {
  TIME_FACTOR_CAP: 3.0,    // max energy inflation from timing alone
  MIN_RESPONSE_SEC: 0.5,   // below this duration, skip timing adjustment (too noisy)
};

// Export for use in both extension and module contexts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TOKENS_PER_WORD,
    ANNUAL_ENERGY_WH, ANNUAL_WATER_ML, ANNUAL_CO2_G, ANNUAL_TOKENS,
    ENERGY_PER_TOKEN_WH, WATER_PER_TOKEN_ML, CO2_PER_TOKEN_G,
    ENERGY_PER_1K_TOKENS_WH, WATER_PER_1K_TOKENS_ML, CO2_PER_1K_TOKENS_G,
    REASONING_MULTIPLIERS,
    AVG_PROMPT_WORDS, AVG_RESPONSE_WORDS, AVG_TOKENS_PER_INTERACTION,
    DAILY_MESSAGES,
    CLAUDE_RELATIVE_INTENSITY, PLATFORM_PROFILES, RESPONSE_TIME_MODEL
  };
}
