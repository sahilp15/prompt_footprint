// Server-side copy of environmental constants
const TOKENS_PER_WORD = 1.3;
const AVG_PROMPT_WORDS = 41;
const AVG_RESPONSE_WORDS = 269;
const AVG_TOKENS_PER_INTERACTION = Math.round(TOKENS_PER_WORD * (AVG_PROMPT_WORDS + AVG_RESPONSE_WORDS));

const DAILY_MESSAGES = 2_500_000_000;
const ANNUAL_TOKENS = DAILY_MESSAGES * AVG_TOKENS_PER_INTERACTION * 365;

const ANNUAL_ENERGY_WH = 390_000_000_000;
const ANNUAL_WATER_ML = 1_300_000_000_000;
const ANNUAL_CO2_G = 138_000_000_000;

const ENERGY_PER_TOKEN_WH = ANNUAL_ENERGY_WH / ANNUAL_TOKENS;
const WATER_PER_TOKEN_ML = ANNUAL_WATER_ML / ANNUAL_TOKENS;
const CO2_PER_TOKEN_G = ANNUAL_CO2_G / ANNUAL_TOKENS;

const REASONING_MULTIPLIERS = {
  none: 1.0,
  minimal: 1.9,
  moderate: 6.0,
  high: 14.0
};

function calculateImpact(totalTokens, multiplier = 1.0) {
  return {
    energyWh: totalTokens * ENERGY_PER_TOKEN_WH * multiplier,
    waterMl: totalTokens * WATER_PER_TOKEN_ML * multiplier,
    co2G: totalTokens * CO2_PER_TOKEN_G * multiplier
  };
}

module.exports = {
  TOKENS_PER_WORD, ANNUAL_TOKENS,
  ENERGY_PER_TOKEN_WH, WATER_PER_TOKEN_ML, CO2_PER_TOKEN_G,
  REASONING_MULTIPLIERS, calculateImpact
};
