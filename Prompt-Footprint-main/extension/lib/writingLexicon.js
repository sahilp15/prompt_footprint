// PromptFootprint Writing Lexicon (spell checker support)
// ---------------------------------------------------------------------------
// The curated typo map and the filler/wordiness phrase lists behind
// `lib/spellChecker.js`. Local, offline, and deliberately high-precision.
//
// THIS IS NO LONGER AN OPTIMIZER. It used to carry a second, much weaker
// compression path — `shorten()`, `analyze()`, `savings()` — that stripped a
// fixed list of filler words and reported the result as a saving. Those are
// gone. Prompt compression has exactly one implementation, the Token Cutter
// (`lib/tokenCutter.bundle.js`), which segments, extracts a preservation
// contract, compresses iteratively, and validates what it produced. A second
// optimizer that could disagree with it about what a prompt costs, or about
// what is safe to remove, was worth less than the confusion it created.
//
// What remains is the word data: typo corrections, and the advisory
// filler/redundancy detectors the spell checker surfaces as individual,
// user-accepted suggestions.
//
// Runs as a content-script global and under Node for tests.

(function (root) {
  'use strict';

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
    [/\bi think\b/gi, ''],
    [/\bi believe\b/gi, ''],
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
    [/\bpromtp\b/gi, 'prompt'], [/\banywere\b/gi, 'anywhere'], [/\bpolciy\b/gi, 'policy'],
    [/\bprofesional\b/gi, 'professional'], [/\brealy\b/gi, 'really'],
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

  // Detect individual filler words / unnecessary phrases as discrete, advisory
  // suggestions. It never mutates text: it only reports what *could* be
  // removed or replaced, one match per distinct phrase, so the writing
  // assistant can show them as suggestions the user explicitly accepts (never a
  // forced correction). Bulk compression is the Token Cutter's job, not this
  // file's — these lists exist to explain a single word, not to rewrite a
  // prompt.
  function detectFiller(text) {
    const str = (text || '').toString();
    const out = [];
    const seen = new Set();

    function record(original, suggestion, reason) {
      const key = `${original.toLowerCase()}|${suggestion.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ type: 'filler', original, suggestion, reason, safe: false });
    }

    function scan(list, suggestionFor, reasonFor) {
      for (const item of list) {
        const rx = Array.isArray(item) ? item[0] : item;
        const re = new RegExp(rx.source, rx.flags); // fresh lastIndex per call
        let m;
        while ((m = re.exec(str)) !== null) {
          record(m[0], suggestionFor(item), reasonFor(item));
          if (!rx.global) break; // safety net; all our lists use /g
        }
      }
    }

    scan(FILLER_WORDS, () => '', () => 'Filler word — often safe to remove');
    scan(FILLER_FILLER_PHRASES, () => '', () => 'Filler phrase — often safe to remove');
    scan(PHRASE_REPLACEMENTS, (item) => item[1],
      (item) => item[1] ? `More concise: "${item[1]}"` : 'Wordy phrasing — often safe to remove');
    return out;
  }

  // Function words repeat naturally; never flag them as "over-repeated".
  const REDUNDANCY_STOPWORDS = new Set((
    'the and for that this with your you have has are was were will would could should ' +
    'from they them their there here what which when where how why into over under about ' +
    'then than also just some more most much many such very each every these those being'
  ).split(' '));

  // Local, non-network content checks the word-level lists miss: unnecessary
  // repetition of a content word, and sentences long enough to be hard to parse
  // (often a sign the prompt is padded / overly long for the task). Advisory
  // only (safe: false) — never auto-applied. Conservative thresholds keep normal
  // topic words from being flagged.
  function detectRedundancy(text) {
    const str = (text || '').toString();
    const out = [];

    // 1. A content word repeated a lot.
    const counts = new Map();
    const wordRe = /\b[a-z][a-z'-]{4,}\b/gi;
    let m;
    while ((m = wordRe.exec(str)) !== null) {
      const w = m[0].toLowerCase();
      if (REDUNDANCY_STOPWORDS.has(w)) continue;
      counts.set(w, (counts.get(w) || 0) + 1);
    }
    Array.from(counts.entries())
      .filter(([, n]) => n >= 5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .forEach(([w, n]) => {
        out.push({
          type: 'clarity', original: w, suggestion: '',
          reason: `Used ${n} times — consider varying the wording or trimming repeats`,
          safe: false,
        });
      });

    // 2. Very long sentences.
    const sentences = str.split(/(?<=[.!?])\s+/);
    for (const s of sentences) {
      const words = s.trim().split(/\s+/).filter(Boolean);
      if (words.length > 45) {
        out.push({
          type: 'clarity', original: words.slice(0, 6).join(' ') + '…', suggestion: '',
          reason: `Long sentence (${words.length} words) — consider splitting it for clarity`,
          safe: false,
        });
      }
    }
    return out;
  }

  const PFWritingLexicon = { fixTypos, detectFiller, detectRedundancy, COMMON_TYPOS };

  if (root) root.PFWritingLexicon = PFWritingLexicon;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFWritingLexicon;
})(typeof self !== 'undefined' ? self : this);
