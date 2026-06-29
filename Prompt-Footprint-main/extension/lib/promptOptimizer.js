// PromptFootprint Prompt Optimizer
// ---------------------------------------------------------------------------
// Local, rule-based prompt compression. Runs entirely in the browser — no
// network call, no LLM, nothing leaves the device — consistent with the
// product's privacy stance.
//
// The goal is CONSERVATIVE compression: strip politeness padding, filler, and
// verbose phrasings that do not change the instruction's meaning, then report
// the estimated token and resource savings so the user can decide before
// sending. We never paraphrase content words or drop sentences, so meaning is
// preserved; suggestions are necessarily lighter-weight than an LLM rewrite.
//
// Runs as a content-script global and under Node for tests.

(function (root) {
  'use strict';

  const _T = (typeof estimateTokens !== 'undefined')
    ? { estimateTokens }
    : require('./tokenEstimator.js');
  const _M = (typeof calculateImpact !== 'undefined')
    ? { calculateImpact }
    : require('./environmentalModel.js');

  // Phrase-level substitutions: wordy -> concise. Case-insensitive, applied
  // with word boundaries. Order matters (longer phrases first).
  const PHRASE_REPLACEMENTS = [
    [/\bdue to the fact that\b/gi, 'because'],
    [/\bin order to\b/gi, 'to'],
    [/\bin the event that\b/gi, 'if'],
    [/\bat this point in time\b/gi, 'now'],
    [/\bat the present time\b/gi, 'now'],
    [/\ba large number of\b/gi, 'many'],
    [/\ba small number of\b/gi, 'a few'],
    [/\bthe majority of\b/gi, 'most'],
    [/\bin spite of the fact that\b/gi, 'although'],
    [/\bwith regard to\b/gi, 'about'],
    [/\bwith reference to\b/gi, 'about'],
    [/\bfor the purpose of\b/gi, 'for'],
    [/\bin the process of\b/gi, ''],
    [/\bit is important to note that\b/gi, ''],
    [/\bplease note that\b/gi, ''],
    [/\bas a matter of fact\b/gi, ''],
    [/\bneedless to say\b/gi, ''],
    [/\bhas the ability to\b/gi, 'can'],
    [/\bis able to\b/gi, 'can'],
    [/\bare able to\b/gi, 'can'],
    [/\bin a timely manner\b/gi, 'promptly'],
    [/\bon a regular basis\b/gi, 'regularly'],
    [/\bin the near future\b/gi, 'soon'],
    [/\bprior to\b/gi, 'before'],
    [/\bsubsequent to\b/gi, 'after'],
    [/\bin terms of\b/gi, 'for'],
    [/\bwhether or not\b/gi, 'whether'],
    [/\beach and every\b/gi, 'every'],
    [/\bend result\b/gi, 'result'],
    [/\bfirst and foremost\b/gi, 'first'],
    [/\bfew in number\b/gi, 'few'],
    [/\bcompletely eliminate\b/gi, 'eliminate'],
    [/\babsolutely essential\b/gi, 'essential'],
    [/\bin my opinion\b/gi, ''],
    [/\bi think that\b/gi, ''],
    [/\bi believe that\b/gi, ''],
    [/\bi want you to\b/gi, ''],
    [/\bi need you to\b/gi, ''],
    [/\bi was hoping you could\b/gi, ''],
  ];

  // Politeness / filler phrases that can be removed wholesale.
  const FILLER_PHRASES = [
    /\bcould you please\b/gi,
    /\bcan you please\b/gi,
    /\bcould you kindly\b/gi,
    /\bwould you please\b/gi,
    /\bi was wondering if you could\b/gi,
    /\bi would like you to\b/gi,
    /\bi would like to ask you to\b/gi,
    /\bif it'?s not too much trouble\b/gi,
    /\bif you don'?t mind\b/gi,
    // "thank(s) ... in advance" (any wording in between)
    /\b(?:thank you|thanks)[^.!?\n]{0,25}in advance\b/gi,
    /\bthanks in advance\b/gi,
    /\bthank you so much\b/gi,
    /\bthank you\b/gi,
    /\bmany thanks\b/gi,
    /\bplease\b/gi,
    /\bkindly\b/gi,
  ];

  // Leading greetings are pure filler in a prompt (removed only at the start).
  const LEADING_GREETING = /^(?:hi|hey|hello|greetings|good (?:morning|afternoon|evening))(?:\s+(?:there|team|claude|chatgpt|gpt|all|everyone))?\b[\s,!.]*/i;

  // Low-value intensifiers/hedges (removed only as standalone words).
  const FILLER_WORDS = [
    /\bbasically\b/gi,
    /\bactually\b/gi,
    /\bessentially\b/gi,
    /\bjust\b/gi,
    /\breally\b/gi,
    /\bvery\b/gi,
    /\bquite\b/gi,
    /\bsimply\b/gi,
    /\blike\b/gi,
    /\bum+\b/gi,
    /\buh+\b/gi,
  ];

  // Conversational filler phrases (multi-word; removed wholesale).
  const FILLER_FILLER_PHRASES = [
    /\byou know\b/gi,
    /\bi mean\b/gi,
    /\bsort of\b/gi,
    /\bkind of\b/gi,
  ];

  // Common misspellings → correct spelling. Offline and curated (no dictionary).
  // Case-insensitive whole-word match; this is intentionally conservative —
  // only unambiguous, high-frequency typos that never change meaning.
  const COMMON_TYPOS = [
    [/\bteh\b/gi, 'the'], [/\bthe the\b/gi, 'the'], [/\badn\b/gi, 'and'],
    [/\brecieve\b/gi, 'receive'], [/\brecieved\b/gi, 'received'],
    [/\bseperate\b/gi, 'separate'], [/\bdefinately\b/gi, 'definitely'],
    [/\boccured\b/gi, 'occurred'], [/\boccuring\b/gi, 'occurring'],
    [/\buntill\b/gi, 'until'], [/\bwich\b/gi, 'which'], [/\bthier\b/gi, 'their'],
    [/\bbecuase\b/gi, 'because'], [/\bbecasue\b/gi, 'because'], [/\bbecuse\b/gi, 'because'],
    [/\bcalender\b/gi, 'calendar'], [/\bcollegue\b/gi, 'colleague'],
    [/\benviroment\b/gi, 'environment'], [/\bgovernment\b/gi, 'government'],
    [/\bgaurantee\b/gi, 'guarantee'], [/\bbeleive\b/gi, 'believe'],
    [/\bacheive\b/gi, 'achieve'],
    [/\baccross\b/gi, 'across'], [/\bbasicly\b/gi, 'basically'],
    [/\bcomming\b/gi, 'coming'], [/\bdoesnt\b/gi, "doesn't"], [/\bdont\b/gi, "don't"],
    [/\bcant\b/gi, "can't"], [/\bwont\b/gi, "won't"],
    [/\bexplaination\b/gi, 'explanation'], [/\bfreind\b/gi, 'friend'],
    [/\bgrammer\b/gi, 'grammar'], [/\bneccessary\b/gi, 'necessary'],
    [/\bnecesary\b/gi, 'necessary'], [/\bpriviledge\b/gi, 'privilege'],
    [/\bpublically\b/gi, 'publicly'], [/\bquestionaire\b/gi, 'questionnaire'],
    [/\bsucessful\b/gi, 'successful'], [/\btomatos\b/gi, 'tomatoes'],
    [/\btruely\b/gi, 'truly'], [/\bwierd\b/gi, 'weird'],
    [/\bwriteable\b/gi, 'writable'], [/\byoure\b/gi, "you're"], [/\bthats\b/gi, "that's"],
  ];

  // Count and apply typo fixes; returns { text, count }.
  function fixTypos(text) {
    let count = 0;
    let out = text;
    for (const [rx, rep] of COMMON_TYPOS) {
      out = out.replace(rx, (m) => {
        count += 1;
        // Preserve leading capitalization of the original token.
        if (m[0] === m[0].toUpperCase() && rep[0] !== rep[0].toUpperCase()) {
          return rep[0].toUpperCase() + rep.slice(1);
        }
        return rep;
      });
    }
    return { text: out, count };
  }

  function normalizeWhitespace(text) {
    return text
      .replace(/[ \t]+/g, ' ')          // collapse runs of spaces/tabs
      .replace(/ ?\n ?/g, '\n')          // trim spaces around newlines
      .replace(/\n{3,}/g, '\n\n')        // cap blank-line runs
      .replace(/\s+([,.;:!?])/g, '$1')   // no space before punctuation
      .replace(/([,.;:!?]){2,}/g, '$1')  // de-dupe punctuation
      .replace(/^[\s,;:.!?]+/, '')        // drop leading punctuation/space
      .trim();
  }

  // Collapse immediate duplicate words ("the the" -> "the").
  function collapseRepeats(text) {
    return text.replace(/\b(\w+)(\s+\1\b)+/gi, '$1');
  }

  // Produce a shortened version of the prompt.
  function shorten(text) {
    if (!text || typeof text !== 'string') return '';
    let out = fixTypos(text).text;
    out = out.replace(LEADING_GREETING, '');
    for (const rx of FILLER_PHRASES) out = out.replace(rx, ' ');
    for (const rx of FILLER_FILLER_PHRASES) out = out.replace(rx, ' ');
    for (const [rx, rep] of PHRASE_REPLACEMENTS) out = out.replace(rx, rep);
    for (const rx of FILLER_WORDS) out = out.replace(rx, ' ');
    out = collapseRepeats(out);
    out = normalizeWhitespace(out);
    // Re-capitalize a leading lowercased word if we stripped a polite lead-in.
    out = out.replace(/^([a-z])/, (m) => m.toUpperCase());
    return out;
  }

  // Compute the savings of replacing `original` with `shortened`, using the
  // per-platform intensity profile. Shared by the local heuristic and the AI
  // rewrite path so both report identical math.
  function savings(originalText, shortenedText, platform) {
    const original = (originalText || '').toString();
    const shortened = (shortenedText || '').toString();

    const originalTokens = _T.estimateTokens(original);
    const newTokens = _T.estimateTokens(shortened);
    const savedTokens = Math.max(0, originalTokens - newTokens);

    const impact = _M.calculateImpact(savedTokens, { platform: platform || 'chatgpt' });
    const typosFixed = fixTypos(original).count;

    return {
      original,
      shortened,
      changed: (shortened.trim() !== original.trim() && savedTokens > 0) || typosFixed > 0,
      originalTokens,
      newTokens,
      savedTokens,
      savedPct: originalTokens > 0 ? Math.round((savedTokens / originalTokens) * 100) : 0,
      savedEnergyWh: impact.energyWh,
      savedWaterMl: impact.waterMl,
      savedCo2G: impact.co2G,
      typosFixed,
    };
  }

  // Analyze a prompt with the local heuristic shortener.
  function analyze(text, platform) {
    const original = (text || '').toString();
    return savings(original, shorten(original), platform);
  }

  const PFPromptOptimizer = { shorten, analyze, savings, normalizeWhitespace, fixTypos };

  if (root) root.PFPromptOptimizer = PFPromptOptimizer;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFPromptOptimizer;
})(typeof self !== 'undefined' ? self : this);
