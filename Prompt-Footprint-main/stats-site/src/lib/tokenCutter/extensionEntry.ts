// Token Cutter — content-script entry point.
// ---------------------------------------------------------------------------
// The extension's in-page assistant must run the SAME engine as the dashboard's
// Token Cutter. Content scripts have no bundler and no ESM, so this file is the
// single entry esbuild bundles into `extension/lib/tokenCutter.bundle.js` as an
// IIFE that publishes the global `PFTokenCutter` (see extension/package.json →
// `npm run build:cutter`).
//
// Nothing new is implemented here. This is a re-export surface: exactly the
// functions the in-page assistant needs, and no more, so the bundle stays small
// and there is only ever one implementation of the pipeline to maintain.

export { analyzePrompt, recompute, optimize, computeAnalytics, DEFAULT_OPTIONS } from './index.ts'
// The in-page assistant's "Already concise" decision and its Removed/Preserved
// breakdown are the SAME assessment the dashboard shows, not a second opinion.
export { assessConcision, NEGLIGIBLE_PERCENT, NEGLIGIBLE_TOKENS } from './concision.ts'
export { summarizeChanges } from './summary.ts'
export { buildDiff, acceptedEdits } from './apply.ts'
// `validateMeaning` is what lets the in-page assistant hold an OPTIONAL remote
// rewrite to exactly the same standard as a local suggestion.
export { culpableSuggestionIds, validateMeaning } from './validate.ts'
export { extractEntities } from './entities.ts'
export { extractConstraints } from './constraints.ts'
export { countWords, estimateTokens, impactForTokens, tokensSaved } from './tokens.ts'
export { emptyMemory, loadMemory, normalizeMemory } from './memory.ts'

/** Bundle marker, so a stale build is obvious in the console and in tests. */
export const ENGINE = 'token-cutter'
