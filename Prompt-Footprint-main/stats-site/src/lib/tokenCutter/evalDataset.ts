// The evaluation dataset.
// ---------------------------------------------------------------------------
// Token reduction on its own is a misleading metric: deleting the whole prompt
// scores 100%. Each case therefore states what the optimized prompt MUST still
// contain, and `evaluate.ts` fails a case that loses any of it — no matter how
// many tokens it saved.
//
// Cases are drawn from the failure modes that actually matter for prompts:
// repetition, filler, typos, names and dates, code and JSON, negative
// instructions, hard word limits, conflicting requirements, prompts that should
// barely change, and prompts where aggressive cutting is safe.

import type { OptimizationLevel } from './types.ts'

export interface EvalCase {
  id: string
  /** What this case is testing, for the report. */
  description: string
  prompt: string
  level: OptimizationLevel
  /** Substrings that must survive verbatim (case-insensitive). */
  mustContain: string[]
  /** Substrings that must be gone. */
  mustNotContain?: string[]
  /** Minimum acceptable token reduction, as a fraction. */
  minReduction: number
  /** Maximum acceptable token reduction — guards against over-cutting. */
  maxReduction: number
  /** When set, the case expects the cutter to surface a conflict. */
  expectsConflict?: boolean
}

export const EVAL_CASES: EvalCase[] = [
  {
    id: 'filler-heavy',
    description: 'Excessive politeness and filler around a simple ask',
    prompt:
      'Hi there! I was wondering if you could please help me out. Basically, I really just need you to write a short summary of the attached quarterly report. Thank you so much in advance!',
    level: 'balanced',
    mustContain: ['summary', 'quarterly report'],
    mustNotContain: ['I was wondering', 'Thank you so much', 'Hi there'],
    minReduction: 0.3,
    maxReduction: 0.75,
  },
  {
    id: 'three-constraints',
    description: 'Three constraints in one wordy sentence — all must survive',
    prompt:
      'Please make sure the response is professional, but not too formal, and keep it under 200 words.',
    level: 'balanced',
    mustContain: ['professional', 'not too formal', '200 words'],
    minReduction: 0.02,
    maxReduction: 0.35,
  },
  {
    id: 'repeated-instruction',
    description: 'The same instruction given three times',
    prompt:
      'Write a product description for our new running shoe. The description should be for our new running shoe. Keep it to 100 words. Use an energetic tone. Remember, keep it to 100 words and energetic.',
    level: 'balanced',
    mustContain: ['running shoe', '100 words', 'energetic'],
    minReduction: 0.25,
    maxReduction: 0.7,
  },
  {
    id: 'spelling',
    description: 'Common misspellings corrected with high confidence',
    prompt:
      'Can you pleae recieve teh document and seperate it into three sections? It is definately neccessary that you do not miss anything.',
    level: 'balanced',
    mustContain: ['receive', 'the document', 'separate', 'three sections', 'definitely', 'necessary', 'not miss anything'],
    mustNotContain: ['recieve', 'seperate', 'definately', 'neccessary'],
    minReduction: 0,
    maxReduction: 0.35,
  },
  {
    id: 'names-and-dates',
    description: 'Proper nouns, a date, and a number must all survive',
    prompt:
      'I was hoping you could draft an email to Priya Raman at Northwind Logistics confirming that the Q3 audit is scheduled for 2026-09-14 and that the budget is 45,000 USD.',
    level: 'balanced',
    mustContain: ['Priya Raman', 'Northwind Logistics', 'Q3', '2026-09-14', '45,000'],
    minReduction: 0.05,
    maxReduction: 0.4,
  },
  {
    id: 'code-and-json',
    description: 'Fenced code and a JSON shape must be reproduced verbatim',
    prompt:
      'Could you please refactor the function below in order to make it faster?\n\n```python\ndef slow(items):\n    return [x * 2 for x in items if x > 0]\n```\n\nReturn your answer as {"code": "...", "notes": "..."} and do not rename the function.',
    level: 'balanced',
    mustContain: [
      'def slow(items):',
      '    return [x * 2 for x in items if x > 0]',
      '{"code": "...", "notes": "..."}',
      'do not rename the function',
    ],
    minReduction: 0.02,
    maxReduction: 0.3,
  },
  {
    id: 'negations',
    description: 'Every negative instruction must be preserved',
    prompt:
      'Please write the announcement. Do not mention the layoffs. Never use the word "restructuring". Avoid speculation about next quarter, and do not exceed 150 words.',
    level: 'maximum',
    mustContain: ['not mention the layoffs', 'Never use the word "restructuring"', 'Avoid speculation', '150 words'],
    minReduction: 0.02,
    maxReduction: 0.35,
  },
  {
    id: 'strict-word-limit',
    description: 'A hard word limit is a constraint, not a number to drop',
    prompt:
      'I would really like you to summarize this article in exactly 50 words. Not 49, not 51. Exactly 50 words please.',
    level: 'maximum',
    mustContain: ['50 words'],
    minReduction: 0.1,
    maxReduction: 0.7,
  },
  {
    id: 'conflicting',
    description: 'Contradictory limits are surfaced rather than silently resolved',
    prompt:
      'Write a summary in under 100 words. Make it formal. Also keep it under 300 words and make it casual.',
    level: 'balanced',
    mustContain: ['100 words', '300 words'],
    minReduction: 0,
    maxReduction: 0.35,
    expectsConflict: true,
  },
  {
    id: 'already-tight',
    description: 'A prompt with nothing to remove should barely change',
    prompt: 'Translate the following paragraph into French. Keep all proper nouns unchanged.',
    level: 'balanced',
    mustContain: ['Translate', 'French', 'proper nouns unchanged'],
    minReduction: 0,
    maxReduction: 0.1,
  },
  {
    id: 'aggressive-safe',
    description: 'A verbose prompt where heavy reduction is safe',
    prompt:
      'Hello! I hope you are doing well today. I was just wondering whether or not you might be able to help me with something. Basically, at this point in time, due to the fact that our team is quite busy, I would really like you to essentially just go ahead and create a simple list of the top five productivity tips. Thanks so much in advance, I really appreciate it!',
    level: 'maximum',
    mustContain: ['five productivity tips'],
    mustNotContain: ['I hope you are doing well', 'Thanks so much', 'due to the fact that'],
    minReduction: 0.45,
    maxReduction: 0.92,
  },
  {
    id: 'urls-and-quotes',
    description: 'Links and quoted wording are reproduced exactly',
    prompt:
      'Please review the page at https://example.com/docs/getting-started?v=2 and tell me whether the phrase "install the extension" appears above the fold. Do not paraphrase it.',
    level: 'balanced',
    mustContain: [
      'https://example.com/docs/getting-started?v=2',
      '"install the extension"',
      'not paraphrase',
    ],
    minReduction: 0.01,
    maxReduction: 0.3,
  },
  {
    id: 'format-and-examples',
    description: 'A required output format and its example both survive',
    prompt:
      'Extract the entities from each sentence and respond as JSON. For example: {"name": "Ada", "role": "engineer"}. Please make sure you use exactly those two keys.',
    level: 'balanced',
    mustContain: ['JSON', '{"name": "Ada", "role": "engineer"}', 'two keys'],
    minReduction: 0,
    maxReduction: 0.3,
  },
  {
    id: 'multilingual',
    description: 'Mixed-language content is not mangled',
    prompt:
      'Please translate the following into Spanish: "El equipo está muy contento con los resultados." Keep the tone friendly and do not change any names.',
    level: 'balanced',
    mustContain: ['Spanish', 'El equipo está muy contento con los resultados', 'friendly', 'not change any names'],
    minReduction: 0,
    maxReduction: 0.3,
  },
  {
    id: 'light-level-preserves-voice',
    description: 'Light mode fixes errors without stripping the author’s voice',
    prompt:
      'I really think we should definately reconsider the pricing page, becuase the current layout is quite confusing for new users.',
    level: 'light',
    mustContain: ['definitely', 'because', 'pricing page', 'confusing for new users'],
    minReduction: 0,
    maxReduction: 0.25,
  },
  // ── Aggression cases ──────────────────────────────────────────────────────
  // Added with the aggressive-compression rebuild. Each one is a prompt the
  // optimizer used to describe as "already concise" while a reader could see
  // the padding from across the room, so each carries a real FLOOR as well as a
  // ceiling — a case that quietly stops compressing now fails.
  {
    id: 'instruction-wrappers',
    description: 'An intact instruction buried in three layers of wrapper',
    prompt:
      'I want you to make sure that when you respond to this question, you do not give me a really long response because I would prefer something shorter and easier to understand.',
    level: 'balanced',
    mustContain: ['do not', 'long response'],
    mustNotContain: ['I want you to make sure', 'when you respond to this question'],
    minReduction: 0.3,
    maxReduction: 0.85,
  },
  {
    id: 'restated-emphasis',
    description: 'Emphasis wrappers restating an instruction already given',
    prompt:
      'Please review this pull request. When you review it, make sure that you check the error handling. It is very important that you check the error handling. Do not approve it. Keep your notes under 150 words.',
    level: 'balanced',
    mustContain: ['error handling', 'Do not approve', '150 words'],
    mustNotContain: ['It is very important'],
    minReduction: 0.2,
    maxReduction: 0.65,
  },
  {
    id: 'duplicated-formatting',
    description: 'The same output format demanded twice, in two phrasings',
    prompt:
      'Summarize the incident report. Respond in a bulleted list format. Use bullet points for your response. Do not include speculation.',
    level: 'balanced',
    mustContain: ['incident report', 'bullet', 'Do not include speculation'],
    minReduction: 0.15,
    maxReduction: 0.55,
  },
  {
    id: 'repeated-context',
    description: 'Background stated twice before the actual task',
    prompt:
      'We are migrating from MySQL to PostgreSQL. Our team is migrating from MySQL to PostgreSQL. I want you to make sure that you list the schema differences. It is very important that you list the schema differences. Keep it under 600 words.',
    level: 'balanced',
    mustContain: ['MySQL', 'PostgreSQL', 'schema differences', '600 words'],
    minReduction: 0.35,
    maxReduction: 0.8,
  },
  {
    id: 'short-but-wasteful',
    description: 'A 20-token prompt that is still mostly padding',
    prompt: 'I was wondering if you could please just help me write a short email to my boss.',
    level: 'balanced',
    mustContain: ['email', 'boss'],
    mustNotContain: ['I was wondering'],
    minReduction: 0.25,
    maxReduction: 0.7,
  },
  {
    id: 'parallel-imperatives',
    description: 'Maximum merges instructions that repeat one verb for three objects',
    prompt:
      'Review the config. Check for exposed secrets. Check for missing timeouts. Check for unbounded retries. Do not change the file. Respond as JSON.',
    level: 'maximum',
    mustContain: ['exposed secrets', 'missing timeouts', 'unbounded retries', 'Do not change', 'JSON'],
    minReduction: 0.05,
    maxReduction: 0.5,
  },
  {
    id: 'dense-spec-unchanged',
    description: 'A dense technical spec that is already tight and must stay so',
    prompt:
      'Validate payload against schema v2.1. Reject any request over 4 MB. Return 422 with the field path on failure. Log the request id. Never log the body.',
    level: 'maximum',
    mustContain: ['schema v2.1', '4 MB', '422', 'request id', 'Never log the body'],
    minReduction: 0,
    maxReduction: 0.12,
  },
]
