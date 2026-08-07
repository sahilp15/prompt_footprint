// PromptFootprint Required Disclosure Copy
// ---------------------------------------------------------------------------
// The sentences the UI is required to show alongside an estimate. They live in
// one place so the popup, the in-page panel, and the tests cannot drift apart,
// and so a wording change is a single reviewable diff rather than a hunt through
// three surfaces.
//
// Rule of thumb behind every string here: say what the number IS, and say what
// it is not. A user should never be able to read a modelled range as provider
// telemetry.

(function (root) {
  'use strict';

  const PROVIDER = {
    google: 'Google measured a median Gemini Apps text interaction at 0.24 Wh in May 2025. This is a product median, not a measurement of the selected model.',
    openai: 'OpenAI reported ~0.34 Wh for an average ChatGPT query but did not disclose model or methodology details.',
    anthropic: 'Anthropic has not published a per-query footprint. This is an independent modelled range.',
    unknown: 'The provider for this page could not be identified. This is a generic frontier-model range, not a provider figure.',
  };

  const ROUTING_AUTO = 'The app may route this request dynamically. PromptFootprint can see the selected mode but not always the backend model.';
  const WATER_BOUNDARIES = 'Cooling and broader operational water use different boundaries and are shown separately.';
  const SAVINGS = 'Fewer input tokens do not imply the same percentage reduction in total interaction energy.';
  const UNKNOWN_MODEL = 'Unknown model — PromptFootprint will not guess a flagship. Showing a provider-level range instead.';
  const PRE_SEND = 'Output and reasoning are not known yet.';
  const HIDDEN_CALLS = 'One prompt can trigger tools, retries, and sub-agents that this page does not expose. Treat this as a lower bound.';
  const TOKENIZER = 'Token counts are not comparable across model generations: a newer tokenizer can produce a different count for the same text.';

  const EVIDENCE_LABEL = {
    MEASURED: 'Measured',
    REPORTED: 'Reported',
    MODELED: 'Modelled',
    ENGINEERING_PRIOR: 'Assumption',
  };

  const EVIDENCE_EXPLANATION = {
    MEASURED: 'Production instrumentation published with a disclosed methodology.',
    REPORTED: 'A provider figure published without enough methodology to reproduce it.',
    MODELED: 'An independent estimate from hardware, latency, throughput, or token assumptions.',
    ENGINEERING_PRIOR: 'A PromptFootprint assumption for a current model that nobody has measured. Not a measurement.',
  };

  // Pre-send wording. Nothing here may claim a saving: before the response exists
  // the output length, the reasoning depth, and any retries are all unknown.
  const PRE_SEND_LABELS = {
    tokensAvoided: 'Potential input tokens avoided',
    inputReduction: 'Estimated input-processing reduction',
    projectedRange: 'Projected interaction range',
    unknownOutput: PRE_SEND,
  };

  // Post-response wording, once output and call counts have been observed.
  const POST_RESPONSE_LABELS = {
    footprint: 'Estimated interaction footprint',
    reduction: 'Modelled reduction versus the original-prompt scenario',
    carbonWater: 'Estimated carbon/water under the stated scope',
  };

  /** The provider disclosure line for an observation. */
  function providerCopy(provider) {
    return PROVIDER[provider] || PROVIDER.unknown;
  }

  /** Every line that must accompany a given estimate, deduplicated and ordered. */
  function disclosuresFor(observation, estimate) {
    const obs = observation || {};
    const est = estimate || {};
    const out = [providerCopy(obs.provider)];
    if (obs.routing === 'auto' && !obs.effectiveModel) out.push(ROUTING_AUTO);
    if (!obs.canonicalModel) out.push(UNKNOWN_MODEL);
    if (est.evidence === 'ENGINEERING_PRIOR') out.push(EVIDENCE_EXPLANATION.ENGINEERING_PRIOR);
    if (est.lowerBound) out.push(HIDDEN_CALLS);
    if (est.phase === 'draft') out.push(PRE_SEND);
    out.push(WATER_BOUNDARIES);
    return Array.from(new Set(out));
  }

  const PFEnvCopy = {
    PROVIDER,
    ROUTING_AUTO,
    WATER_BOUNDARIES,
    SAVINGS,
    UNKNOWN_MODEL,
    PRE_SEND,
    HIDDEN_CALLS,
    TOKENIZER,
    EVIDENCE_LABEL,
    EVIDENCE_EXPLANATION,
    PRE_SEND_LABELS,
    POST_RESPONSE_LABELS,
    providerCopy,
    disclosuresFor,
  };

  if (root) root.PFEnvCopy = PFEnvCopy;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFEnvCopy;
})(typeof self !== 'undefined' ? self : this);
