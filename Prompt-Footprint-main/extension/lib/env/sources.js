// PromptFootprint Source Ledger
// ---------------------------------------------------------------------------
// Every environmental number this extension shows traces back to an entry here.
// Nothing in lib/env/ may carry a value without at least one source id, and the
// UI never prints a figure without also being able to print its source.
//
// `kind` records WHAT the source is, which is what decides the evidence class a
// profile is allowed to claim:
//   measurement  — production instrumentation with a disclosed methodology
//   statement    — a provider figure published without a reproducible method
//   research     — independent peer-reviewed / preprint modelling
//   docs         — provider product/model documentation (capabilities, not energy)

(function (root) {
  'use strict';

  const SOURCES = {
    S1: {
      id: 'S1',
      label: 'Google — Measuring the Environmental Impact of Delivering AI at Google Scale',
      url: 'https://services.google.com/fh/files/misc/measuring_the_environmental_impact_of_delivering_ai_at_google_scale.pdf',
      kind: 'measurement',
      date: '2025-08',
      note: 'Production Gemini Apps median text prompt, May 2025: energy boundary, component breakdown, market-based carbon, cooling water.',
    },
    S2: {
      id: 'S2',
      label: 'Sam Altman — The Gentle Singularity',
      url: 'https://blog.samaltman.com/the-gentle-singularity',
      kind: 'statement',
      date: '2025-06',
      note: 'Average ChatGPT query ~0.34 Wh and 0.000085 US gallons. No methodology disclosed.',
    },
    S3: {
      id: 'S3',
      label: 'OpenAI Academy — Environmental Impact of AI',
      url: 'https://academy.openai.com/public/clubs/higher-education-05x4z/resources/environmental-impact-of-ai',
      kind: 'statement',
      date: '2025',
      note: 'States model-level energy benchmarks are proprietary and unpublished; cites an independent ~0.3 Wh GPT-4o estimate.',
    },
    S4: {
      id: 'S4',
      label: 'Oviedo et al. — Energy use of AI inference, efficiency pathways, and test-time scaling (Joule)',
      url: 'https://www.cell.com/joule/fulltext/S2542-4351%2826%2900114-5',
      altUrl: 'https://arxiv.org/abs/2509.20241',
      kind: 'research',
      date: '2026',
      note: 'Conventional frontier query 0.34 Wh median (IQR 0.18-0.67); test-time-scaling query 4.32 Wh median (IQR 2.38-7.38).',
    },
    S5: {
      id: 'S5',
      label: 'Jegham et al. — How Hungry is AI? v6',
      url: 'https://arxiv.org/html/2505.09598v6',
      kind: 'research',
      date: '2025',
      note: 'GPT-4o / Claude 3.7 Sonnet scenario estimates, Azure and AWS PUE/WUE/CIF assumptions, GPT-5 adaptive-routing case study.',
    },
    S6: {
      id: 'S6',
      label: 'Anthropic Transparency Hub',
      url: 'https://www.anthropic.com/transparency/system-trust-reporting',
      kind: 'docs',
      date: '2026',
      note: 'No per-query Claude energy/carbon/water measurement identified as of the cutoff.',
    },
    S7: {
      id: 'S7',
      label: 'Anthropic — Models overview',
      url: 'https://platform.claude.com/docs/en/about-claude/models/overview',
      kind: 'docs',
      date: '2026',
    },
    S8: {
      id: 'S8',
      label: "Anthropic — What's new in Claude Sonnet 5",
      url: 'https://platform.claude.com/docs/en/about-claude/models/whats-new-sonnet-5',
      kind: 'docs',
      date: '2026',
      note: 'New tokenizer may produce ~30% more tokens for the same text than Sonnet 4.6.',
    },
    S9: {
      id: 'S9',
      label: 'Anthropic — Introducing Claude Fable 5 and Claude Mythos 5',
      url: 'https://platform.claude.com/docs/en/about-claude/models/introducing-claude-fable-5-and-claude-mythos-5',
      kind: 'docs',
      date: '2026',
    },
    S10: {
      id: 'S10',
      label: 'Anthropic — Adaptive thinking / effort / Opus 5',
      url: 'https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking',
      kind: 'docs',
      date: '2026',
      note: 'Thinking defaults and restrictions; effort levels low/medium/high/xhigh/max.',
    },
    S11: {
      id: 'S11',
      label: 'Anthropic — Choosing the right model',
      url: 'https://platform.claude.com/docs/en/about-claude/models/choosing-a-model',
      kind: 'docs',
      date: '2026',
    },
    S12: {
      id: 'S12',
      label: 'Anthropic — Thinking overview',
      url: 'https://platform.claude.com/docs/en/about-claude/models/extended-thinking-models',
      kind: 'docs',
      date: '2026',
    },
    S13: {
      id: 'S13',
      label: 'OpenAI API — Models',
      url: 'https://developers.openai.com/api/docs/models',
      kind: 'docs',
      date: '2026',
      note: 'GPT-5.6 Sol/Terra/Luna, the gpt-5.6 alias, reasoning levels, context/output limits.',
    },
    S14: {
      id: 'S14',
      label: 'OpenAI — GPT-5.6 model guidance / reasoning',
      url: 'https://developers.openai.com/api/docs/guides/latest-model',
      kind: 'docs',
      date: '2026',
    },
    S15: {
      id: 'S15',
      label: 'OpenAI Help — Model release notes / retired ChatGPT models',
      url: 'https://help.openai.com/en/articles/9624314-model-release-notes',
      kind: 'docs',
      date: '2026',
      note: 'ChatGPT product model migrations; existing chats can move to newer models.',
    },
    S16: {
      id: 'S16',
      label: 'OpenAI Help — Legacy model access',
      url: 'https://help.openai.com/en/articles/11954883-legacy-model-access-for-enterprise-and-edu-users',
      kind: 'docs',
      date: '2026',
      note: 'The model picker / workspace settings are the source of truth for selectable models.',
    },
    S17: {
      id: 'S17',
      label: 'Google DeepMind — Gemini 3.1 Pro model card',
      url: 'https://deepmind.google/models/model-cards/gemini-3-1-pro/',
      kind: 'docs',
      date: '2026',
    },
    S18: {
      id: 'S18',
      label: 'Google DeepMind — Gemini 3.1 Deep Think',
      url: 'https://deepmind.google/models/gemini/deep-think/',
      kind: 'docs',
      date: '2026',
    },
    S19: {
      id: 'S19',
      label: 'Google DeepMind — Gemini 3.6 Flash model card',
      url: 'https://deepmind.google/models/model-cards/gemini-3-6-flash/',
      kind: 'docs',
      date: '2026-07',
    },
    S20: {
      id: 'S20',
      label: 'Google Gemini Apps Help — switch models',
      url: 'https://support.google.com/gemini/answer/14517446?hl=en',
      kind: 'docs',
      date: '2026',
      note: 'The model name appears inside/under the text box and is the UI switch point.',
    },
    S21: {
      id: 'S21',
      label: 'Johnson — The Compression Paradox in LLM Inference',
      url: 'https://arxiv.org/abs/2603.23528',
      kind: 'research',
      date: '2026',
      note: '28,421 successful trials; provider-dependent effects, output expansion, quality loss. Input compression alone is not a reliable energy optimization.',
    },
  };

  function get(id) {
    return SOURCES[id] || null;
  }

  /** Resolve a list of ids to source records, dropping unknown ids. */
  function list(ids) {
    return (ids || []).map(get).filter(Boolean);
  }

  /** "[S1] Google — ... (2025-08)" lines for the expanded UI and diagnostics. */
  function cite(ids) {
    return list(ids).map((s) => `[${s.id}] ${s.label} (${s.date})`);
  }

  /** The newest source date backing a set of ids — shown as "evidence as of". */
  function latestDate(ids) {
    return list(ids).map((s) => s.date).sort().pop() || null;
  }

  const PFEnvSources = { SOURCES, get, list, cite, latestDate };

  if (root) root.PFEnvSources = PFEnvSources;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFEnvSources;
})(typeof self !== 'undefined' ? self : this);
