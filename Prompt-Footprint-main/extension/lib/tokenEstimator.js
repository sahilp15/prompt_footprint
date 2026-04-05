// Token estimation using GPT cl100k_base approximation
// ~4 characters per token — more accurate than word-counting for
// code, numbers, punctuation-heavy, and non-English content.
// Source: "A Token-Level Framework for Quantifying ChatGPT's Environmental Impacts"
// by Sahil Parasharami

function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  // cl100k_base (GPT-4/ChatGPT) averages ~4 chars per token.
  // Applying a small code-density correction: code tends to tokenize
  // at ~3.5 chars/token but prose at ~4.5, so 4 is a solid midpoint.
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

function estimateQueryTokens(promptText, responseText) {
  const promptTokens   = estimateTokens(promptText);
  const responseTokens = estimateTokens(responseText);
  return {
    promptTokens,
    responseTokens,
    totalTokens: promptTokens + responseTokens,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { estimateTokens, estimateQueryTokens };
}
