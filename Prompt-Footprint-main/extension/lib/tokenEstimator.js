// Token estimation using BPE heuristic: ~1.3 tokens per English word
// Based on empirical relationship with GPT-style Byte Pair Encoding tokenizers

function countWords(text) {
  if (!text || typeof text !== 'string') return 0;
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

function estimateTokens(text) {
  return Math.ceil(countWords(text) * TOKENS_PER_WORD);
}

function estimateQueryTokens(promptText, responseText) {
  const promptTokens = estimateTokens(promptText);
  const responseTokens = estimateTokens(responseText);
  return {
    promptTokens,
    responseTokens,
    totalTokens: promptTokens + responseTokens
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { countWords, estimateTokens, estimateQueryTokens };
}
