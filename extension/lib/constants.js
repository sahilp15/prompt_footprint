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

// Export for use in both extension and module contexts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TOKENS_PER_WORD,
    ANNUAL_ENERGY_WH, ANNUAL_WATER_ML, ANNUAL_CO2_G, ANNUAL_TOKENS,
    ENERGY_PER_TOKEN_WH, WATER_PER_TOKEN_ML, CO2_PER_TOKEN_G,
    ENERGY_PER_1K_TOKENS_WH, WATER_PER_1K_TOKENS_ML, CO2_PER_1K_TOKENS_G,
    REASONING_MULTIPLIERS,
    AVG_PROMPT_WORDS, AVG_RESPONSE_WORDS, AVG_TOKENS_PER_INTERACTION,
    DAILY_MESSAGES
  };
}
