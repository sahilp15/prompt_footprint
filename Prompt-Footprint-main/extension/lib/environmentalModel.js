// Environmental impact calculator
// Converts token counts to energy (Wh), water (mL), and CO2 (g) estimates

function calculateImpact(totalTokens, multiplier = 1.0) {
  const energyWh = totalTokens * ENERGY_PER_TOKEN_WH * multiplier;
  const waterMl = totalTokens * WATER_PER_TOKEN_ML * multiplier;
  const co2G = totalTokens * CO2_PER_TOKEN_G * multiplier;

  return { energyWh, waterMl, co2G };
}

function calculateQueryImpact(promptText, responseText, multiplier = 1.0) {
  const { promptTokens, responseTokens, totalTokens } = estimateQueryTokens(promptText, responseText);
  const impact = calculateImpact(totalTokens, multiplier);

  return {
    promptTokens,
    responseTokens,
    totalTokens,
    ...impact
  };
}

function getMultiplierForLevel(reasoningLevel) {
  return REASONING_MULTIPLIERS[reasoningLevel] || REASONING_MULTIPLIERS.none;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { calculateImpact, calculateQueryImpact, getMultiplierForLevel };
}
