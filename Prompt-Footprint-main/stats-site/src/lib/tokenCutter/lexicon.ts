// The curated rule data behind every local reduction.
// ---------------------------------------------------------------------------
// Kept separate from the detectors so the *policy* (what counts as filler, how
// confident we are, at which aggressiveness tier) is reviewable on its own,
// without reading any control flow.
//
// Confidence is a considered judgement per entry, not a constant:
//   0.95+  removing this can not change meaning ("thanks in advance")
//   0.80   almost always safe, rare edge cases ("just", "really")
//   0.60   usually safe but context-dependent ("very", "like")
//   <0.60  offered, never auto-applied
//
// `minLevel` is the lowest optimization tier at which the entry is proposed.

import type { OptimizationLevel, SuggestionCategory } from './types.ts'

export interface LexiconRule {
  /** Matched case-insensitively with word boundaries. */
  pattern: RegExp
  /** Replacement text; '' deletes. */
  replacement: string
  category: SuggestionCategory
  title: string
  reason: string
  score: number
  minLevel: OptimizationLevel
}

const rule = (
  pattern: RegExp,
  replacement: string,
  category: SuggestionCategory,
  title: string,
  reason: string,
  score: number,
  minLevel: OptimizationLevel,
): LexiconRule => ({ pattern, replacement, category, title, reason, score, minLevel })

// ── Politeness and conversational lead-ins ──────────────────────────────────
// Models do not respond better to politeness, and these phrases carry no
// instruction. They are the single largest source of avoidable prompt tokens.

export const POLITENESS_RULES: LexiconRule[] = [
  rule(/\bi was wondering if you could(?:\s+(?:possibly|maybe|perhaps))?\b/gi, '', 'politeness', 'Conversational lead-in', 'This phrase asks nothing extra — the instruction after it is the whole request.', 0.95, 'light'),
  rule(/\bi was hoping (?:you could|that you could|you might)\b/gi, '', 'politeness', 'Conversational lead-in', 'Softened phrasing that adds tokens without changing the request.', 0.95, 'light'),
  rule(/\b(?:i'?d|i would) (?:really )?(?:like|love|appreciate it) (?:it )?if you (?:could|would)\b/gi, '', 'politeness', 'Conversational lead-in', 'Softened phrasing that adds tokens without changing the request.', 0.93, 'light'),
  rule(/\bcould you (?:please |kindly )?(?:possibly )?\b/gi, '', 'politeness', 'Polite request wrapper', 'The imperative that follows is the instruction; the wrapper is optional.', 0.9, 'light'),
  rule(/\b(?:can|would|will) you (?:please |kindly )?\b/gi, '', 'politeness', 'Polite request wrapper', 'The imperative that follows is the instruction; the wrapper is optional.', 0.88, 'light'),
  rule(/\bi (?:would (?:really |very much )?like|really want|want|really need|need) (?:you )?to\b/gi, '', 'politeness', 'Indirect request', 'Stating the task directly says the same thing in fewer tokens.', 0.9, 'light'),
  rule(/\bi (?:was |am )?(?:just )?wondering (?:if|whether)(?: or not)? you (?:could|can|would|will|might|may)(?: be able to)?\b/gi, '', 'politeness', 'Conversational lead-in', 'Softened phrasing that adds tokens without changing the request.', 0.94, 'light'),
  // Well-wishing only. "I hope you can include the table" is an instruction and
  // is deliberately not matched.
  rule(/\bi hope (?:you(?:'?re| are)?(?: doing)? (?:well|great|good|ok)|this (?:email |message |note )?finds you well|you(?:'?re| are) having a (?:good|great|nice) (?:day|week|morning|afternoon|evening|weekend))(?:\s+(?:today|this (?:morning|afternoon|evening|week)))?[\s,!.]*/gi, '', 'politeness', 'Pleasantry', 'A greeting has no effect on the response.', 0.93, 'light'),
  rule(/\b(?:go ahead and|feel free to)\b/gi, '', 'politeness', 'Permission filler', 'The instruction stands on its own.', 0.88, 'balanced'),
  rule(/\bif (?:it'?s|it is) not too much trouble\b/gi, '', 'politeness', 'Unnecessary politeness', 'Carries no instruction.', 0.97, 'light'),
  rule(/\bif you (?:don'?t|do not) mind\b/gi, '', 'politeness', 'Unnecessary politeness', 'Carries no instruction.', 0.96, 'light'),
  rule(/\b(?:thank you|thanks)[^.!?\n]{0,25}\bin advance\b/gi, '', 'politeness', 'Sign-off', 'Nothing after this changes the answer.', 0.97, 'light'),
  rule(/\b(?:thank you (?:so|very) much|thanks a lot|many thanks|much appreciated|i appreciate it)\b/gi, '', 'politeness', 'Sign-off', 'Nothing after this changes the answer.', 0.96, 'light'),
  rule(/\bthank you\b/gi, '', 'politeness', 'Sign-off', 'Nothing after this changes the answer.', 0.94, 'light'),
  rule(/\bthanks\b/gi, '', 'politeness', 'Sign-off', 'Nothing after this changes the answer.', 0.92, 'light'),
  rule(/\bplease\b/gi, '', 'politeness', 'Politeness marker', 'Removing “please” does not change what is being asked.', 0.86, 'balanced'),
  rule(/\bkindly\b/gi, '', 'politeness', 'Politeness marker', 'Removing “kindly” does not change what is being asked.', 0.88, 'balanced'),
  rule(/^\s*(?:hi|hey|hello|greetings|good (?:morning|afternoon|evening))(?:\s+(?:there|team|claude|chatgpt|gpt|everyone|all))?\b[\s,!.–—-]*/i, '', 'politeness', 'Greeting', 'A greeting has no effect on the response.', 0.97, 'light'),
]

// ── Filler words and hedges ─────────────────────────────────────────────────
// Removed as standalone words only. `just` and `really` are excluded near
// negations and constraints by the detector, because "just the code" and
// "not really" are meaningful.

export const FILLER_WORD_RULES: LexiconRule[] = [
  rule(/\bbasically\b/gi, '', 'filler', 'Unnecessary filler', 'Adds no information to the instruction.', 0.9, 'light'),
  rule(/\bessentially\b/gi, '', 'filler', 'Unnecessary filler', 'Adds no information to the instruction.', 0.88, 'light'),
  rule(/\bactually\b/gi, '', 'filler', 'Unnecessary filler', 'Adds no information to the instruction.', 0.85, 'light'),
  rule(/\bliterally\b/gi, '', 'filler', 'Unnecessary filler', 'Adds no information to the instruction.', 0.82, 'balanced'),
  rule(/\bsimply\b/gi, '', 'filler', 'Unnecessary filler', 'Adds no information to the instruction.', 0.85, 'light'),
  rule(/\bjust\b/gi, '', 'filler', 'Unnecessary filler', 'Usually a softener. Kept automatically when it means “only”.', 0.78, 'balanced'),
  rule(/\breally\b/gi, '', 'filler', 'Intensifier', 'Intensifiers rarely change what a model produces.', 0.8, 'balanced'),
  rule(/\bvery\b/gi, '', 'hedge', 'Intensifier', 'Intensifiers rarely change what a model produces.', 0.72, 'balanced'),
  rule(/\bquite\b/gi, '', 'hedge', 'Intensifier', 'Intensifiers rarely change what a model produces.', 0.7, 'maximum'),
  rule(/\bextremely\b/gi, '', 'hedge', 'Intensifier', 'Intensifiers rarely change what a model produces.', 0.68, 'maximum'),
  rule(/\byou know\b/gi, '', 'filler', 'Conversational filler', 'Speech filler with no effect on the instruction.', 0.94, 'light'),
  rule(/\bi mean\b/gi, '', 'filler', 'Conversational filler', 'Speech filler with no effect on the instruction.', 0.9, 'light'),
  rule(/\b(?:sort|kind) of\b/gi, '', 'hedge', 'Hedge', 'Vague qualifier — removing it makes the instruction more definite.', 0.74, 'balanced'),
  rule(/\bum+\b/gi, '', 'filler', 'Conversational filler', 'Speech filler with no effect on the instruction.', 0.97, 'light'),
  rule(/\buh+\b/gi, '', 'filler', 'Conversational filler', 'Speech filler with no effect on the instruction.', 0.97, 'light'),
  rule(/\bi think(?: that)?\b/gi, '', 'hedge', 'Hedge', 'Attribution to yourself does not change the task.', 0.8, 'balanced'),
  rule(/\bi believe(?: that)?\b/gi, '', 'hedge', 'Hedge', 'Attribution to yourself does not change the task.', 0.8, 'balanced'),
  rule(/\bin my opinion\b/gi, '', 'hedge', 'Hedge', 'Attribution to yourself does not change the task.', 0.84, 'balanced'),
  rule(/\bit (?:is|'?s) important to note that\b/gi, '', 'filler', 'Empty framing', 'The statement that follows carries the meaning.', 0.9, 'light'),
  rule(/\bplease note that\b/gi, '', 'filler', 'Empty framing', 'The statement that follows carries the meaning.', 0.9, 'light'),
  rule(/\b(?:as a matter of fact|needless to say|it goes without saying(?: that)?)\b/gi, '', 'filler', 'Empty framing', 'The statement that follows carries the meaning.', 0.92, 'light'),
  rule(/\bfor what it'?s worth\b/gi, '', 'filler', 'Empty framing', 'The statement that follows carries the meaning.', 0.92, 'light'),
]

// ── Wordy constructions ─────────────────────────────────────────────────────
// One-for-one swaps that shorten without touching meaning. Longest first so a
// longer phrase is never partially matched by a shorter rule.

export const WORDY_RULES: LexiconRule[] = [
  rule(/\bdue to the fact that\b/gi, 'because', 'wordy-phrase', 'Wordy phrase', 'Five words doing the work of one.', 0.95, 'light'),
  rule(/\bin spite of the fact that\b/gi, 'although', 'wordy-phrase', 'Wordy phrase', 'Six words doing the work of one.', 0.95, 'light'),
  rule(/\bfor the (?:purpose|purposes) of\b/gi, 'for', 'wordy-phrase', 'Wordy phrase', 'Shorter phrasing, same meaning.', 0.93, 'light'),
  rule(/\bin the event that\b/gi, 'if', 'wordy-phrase', 'Wordy phrase', 'Shorter phrasing, same meaning.', 0.94, 'light'),
  rule(/\bat (?:this point in time|the present time|the current time)\b/gi, 'now', 'wordy-phrase', 'Wordy phrase', 'Shorter phrasing, same meaning.', 0.94, 'light'),
  rule(/\bin order (?:to|for)\b/gi, 'to', 'wordy-phrase', 'Wordy phrase', '“In order to” always shortens to “to”.', 0.94, 'light'),
  rule(/\ba (?:large|great) number of\b/gi, 'many', 'wordy-phrase', 'Wordy phrase', 'Shorter phrasing, same meaning.', 0.9, 'light'),
  rule(/\ba small number of\b/gi, 'a few', 'wordy-phrase', 'Wordy phrase', 'Shorter phrasing, same meaning.', 0.9, 'light'),
  rule(/\bthe (?:majority|bulk) of\b/gi, 'most', 'wordy-phrase', 'Wordy phrase', 'Shorter phrasing, same meaning.', 0.9, 'light'),
  rule(/\bwith (?:regard|regards|reference|respect) to\b/gi, 'about', 'wordy-phrase', 'Wordy phrase', 'Shorter phrasing, same meaning.', 0.88, 'light'),
  rule(/\bin (?:relation|reference) to\b/gi, 'about', 'wordy-phrase', 'Wordy phrase', 'Shorter phrasing, same meaning.', 0.86, 'balanced'),
  rule(/\b(?:has|have) the ability to\b/gi, 'can', 'wordy-phrase', 'Wordy phrase', 'Shorter phrasing, same meaning.', 0.92, 'light'),
  rule(/\b(?:is|are|be) able to\b/gi, 'can', 'wordy-phrase', 'Wordy phrase', 'Shorter phrasing, same meaning.', 0.88, 'balanced'),
  rule(/\bin a timely manner\b/gi, 'promptly', 'wordy-phrase', 'Wordy phrase', 'Shorter phrasing, same meaning.', 0.9, 'light'),
  rule(/\bon a regular basis\b/gi, 'regularly', 'wordy-phrase', 'Wordy phrase', 'Shorter phrasing, same meaning.', 0.92, 'light'),
  rule(/\bin the near future\b/gi, 'soon', 'wordy-phrase', 'Wordy phrase', 'Shorter phrasing, same meaning.', 0.9, 'light'),
  rule(/\bprior to\b/gi, 'before', 'wordy-phrase', 'Wordy phrase', 'Shorter phrasing, same meaning.', 0.9, 'light'),
  rule(/\bsubsequent to\b/gi, 'after', 'wordy-phrase', 'Wordy phrase', 'Shorter phrasing, same meaning.', 0.9, 'light'),
  rule(/\bwhether or not\b/gi, 'whether', 'wordy-phrase', 'Wordy phrase', '“Or not” is implied by “whether”.', 0.88, 'balanced'),
  rule(/\beach and every\b/gi, 'every', 'wordy-phrase', 'Redundant pair', 'The two words mean the same thing.', 0.93, 'light'),
  rule(/\bfirst and foremost\b/gi, 'first', 'wordy-phrase', 'Redundant pair', 'The two words mean the same thing.', 0.9, 'light'),
  rule(/\bend result\b/gi, 'result', 'wordy-phrase', 'Redundant pair', '“End” adds nothing to “result”.', 0.9, 'light'),
  rule(/\bfew in number\b/gi, 'few', 'wordy-phrase', 'Redundant pair', '“In number” adds nothing.', 0.92, 'light'),
  rule(/\bcompletely eliminate\b/gi, 'eliminate', 'wordy-phrase', 'Redundant pair', '“Eliminate” already means completely.', 0.9, 'balanced'),
  rule(/\babsolutely essential\b/gi, 'essential', 'wordy-phrase', 'Redundant pair', '“Essential” already means absolutely.', 0.9, 'balanced'),
  rule(/\bpast (?:history|experience)\b/gi, 'history', 'wordy-phrase', 'Redundant pair', 'History is always past.', 0.86, 'balanced'),
  rule(/\badvance (?:planning|warning)\b/gi, 'planning', 'wordy-phrase', 'Redundant pair', 'Planning is always in advance.', 0.84, 'maximum'),
  rule(/\bmake (?:use|usage) of\b/gi, 'use', 'wordy-phrase', 'Wordy phrase', 'Shorter phrasing, same meaning.', 0.9, 'light'),
  rule(/\btake into (?:account|consideration)\b/gi, 'consider', 'wordy-phrase', 'Wordy phrase', 'Shorter phrasing, same meaning.', 0.88, 'balanced'),
  rule(/\bgive (?:consideration|thought) to\b/gi, 'consider', 'wordy-phrase', 'Wordy phrase', 'Shorter phrasing, same meaning.', 0.88, 'balanced'),
  rule(/\bin the process of\b/gi, '', 'wordy-phrase', 'Wordy phrase', 'The verb after it already says this.', 0.85, 'balanced'),
  rule(/\bthe (?:reason|reason why) (?:is|for this is) (?:because|that)\b/gi, 'because', 'wordy-phrase', 'Wordy phrase', 'Shorter phrasing, same meaning.', 0.88, 'balanced'),
  rule(/\bin terms of\b/gi, 'for', 'wordy-phrase', 'Wordy phrase', 'Shorter phrasing, same meaning.', 0.72, 'maximum'),
  rule(/\bat the end of the day\b/gi, 'ultimately', 'wordy-phrase', 'Wordy phrase', 'Shorter phrasing, same meaning.', 0.85, 'balanced'),
  rule(/\ba (?:variety|number) of different\b/gi, 'various', 'wordy-phrase', 'Wordy phrase', 'Shorter phrasing, same meaning.', 0.86, 'balanced'),
  rule(/\bit (?:is|'?s) (?:my|our) understanding that\b/gi, '', 'wordy-phrase', 'Empty framing', 'The statement that follows carries the meaning.', 0.86, 'balanced'),
]

// ── Discourse transitions ───────────────────────────────────────────────────
// Real signposting in an essay; noise at the start of a prompt sentence.

export const TRANSITION_RULES: LexiconRule[] = [
  rule(/(?:^|(?<=[.!?]\s))(?:additionally|furthermore|moreover|in addition|also,)\s*/gi, '', 'transition', 'Excess transition', 'Sentence order already carries this.', 0.76, 'maximum'),
  rule(/(?:^|(?<=[.!?]\s))(?:that (?:being |having been )?said|with that in mind|having said that)\s*,?\s*/gi, '', 'transition', 'Excess transition', 'Sentence order already carries this.', 0.82, 'balanced'),
  rule(/(?:^|(?<=[.!?]\s))(?:as (?:i|you) (?:mentioned|said) (?:earlier|before|above))\s*,?\s*/gi, '', 'transition', 'Excess transition', 'The earlier statement is still in the prompt.', 0.84, 'balanced'),
  rule(/(?:^|(?<=[.!?]\s))(?:to be honest|honestly|frankly)\s*,?\s*/gi, '', 'transition', 'Excess transition', 'Adds no instruction.', 0.86, 'balanced'),
]

// ── Spelling ────────────────────────────────────────────────────────────────
// Only unambiguous, high-frequency misspellings with a single correct target.
// Anything a dictionary would guess at is left alone — a confidently wrong
// "correction" of a name or a technical term is far worse than a typo.

export const TYPO_MAP: Record<string, string> = {
  teh: 'the', adn: 'and', taht: 'that', thier: 'their', recieve: 'receive',
  recieved: 'received', recieving: 'receiving', seperate: 'separate',
  seperated: 'separated', definately: 'definitely', occured: 'occurred',
  occuring: 'occurring', untill: 'until', wich: 'which', becuase: 'because',
  becasue: 'because', becuse: 'because', calender: 'calendar', collegue: 'colleague',
  enviroment: 'environment', enviromental: 'environmental', gaurantee: 'guarantee',
  beleive: 'believe', acheive: 'achieve', acheived: 'achieved', accross: 'across',
  basicly: 'basically', comming: 'coming', explaination: 'explanation',
  freind: 'friend', grammer: 'grammar', neccessary: 'necessary', necesary: 'necessary',
  priviledge: 'privilege', publically: 'publicly', questionaire: 'questionnaire',
  sucessful: 'successful', succesful: 'successful', tomatos: 'tomatoes',
  truely: 'truly', wierd: 'weird', writeable: 'writable', promtp: 'prompt',
  anywere: 'anywhere', polciy: 'policy', profesional: 'professional', realy: 'really',
  responsbile: 'responsible', responsability: 'responsibility', maintainance: 'maintenance',
  refered: 'referred', refering: 'referring', begining: 'beginning', arguement: 'argument',
  concious: 'conscious', embarass: 'embarrass', existance: 'existence',
  independant: 'independent', occurance: 'occurrence', persistant: 'persistent',
  recomend: 'recommend', recomended: 'recommended', reccomend: 'recommend',
  relevent: 'relevant', succesfully: 'successfully', sucessfully: 'successfully',
  therefor: 'therefore', threshhold: 'threshold', tommorow: 'tomorrow',
  tommorrow: 'tomorrow', usefull: 'useful', wheather: 'whether', apparant: 'apparent',
  concensus: 'consensus', dissapoint: 'disappoint', harrass: 'harass',
  noticable: 'noticeable', occassion: 'occasion', perseverence: 'perseverance',
  recepient: 'recipient', rythm: 'rhythm', shedule: 'schedule', supercede: 'supersede',
  supress: 'suppress', accomodate: 'accommodate', acommodate: 'accommodate',
  agressive: 'aggressive', comitted: 'committed', comitment: 'commitment',
  developement: 'development', differnt: 'different', finaly: 'finally',
  fourty: 'forty', goverment: 'government', immediatly: 'immediately',
  intrested: 'interested', knowlege: 'knowledge', lenght: 'length',
  paralell: 'parallel', particulary: 'particularly', posible: 'possible',
  probaly: 'probably', qualaty: 'quality', reciept: 'receipt', sentance: 'sentence',
  similiar: 'similar', speach: 'speech', strenght: 'strength', succes: 'success',
  suprise: 'surprise', varius: 'various', visable: 'visible', wih: 'with',
  ot: 'to', nad: 'and', hte: 'the', tehn: 'then', thta: 'that',
  pleae: 'please', plase: 'please', pelase: 'please', importnat: 'important',
  improtant: 'important', imporant: 'important', seperately: 'separately',
  occassionally: 'occasionally', alot: 'a lot', wnat: 'want', jsut: 'just',
  adress: 'address', whcih: 'which', woudl: 'would', shoudl: 'should',
  coudl: 'could', reponse: 'response', respose: 'response', summry: 'summary',
  paramaters: 'parameters', langauge: 'language', langague: 'language',
  exmaple: 'example', exampel: 'example', formating: 'formatting',
  requirment: 'requirement', requirments: 'requirements',
}
// British spellings (analyse, summarise, colour…) are NOT typos and are
// deliberately absent: "correcting" them would rewrite the author's voice, and
// could break a prompt that requires exact wording.

/** Contractions people type without the apostrophe. Unambiguous only. */
export const CONTRACTION_MAP: Record<string, string> = {
  dont: "don't", doesnt: "doesn't", didnt: "didn't", cant: "can't", wont: "won't",
  wouldnt: "wouldn't", couldnt: "couldn't", shouldnt: "shouldn't", isnt: "isn't",
  arent: "aren't", wasnt: "wasn't", werent: "weren't", hasnt: "hasn't",
  havent: "haven't", hadnt: "hadn't", youre: "you're", theyre: "they're",
  weve: "we've", ive: "I've", im: "I'm", ill: "I'll", thats: "that's",
  whats: "what's", lets: "let's", its: "it's",
}

/**
 * Contractions that are also real words — never auto-corrected, because
 * "its" and "ill" are frequently correct as written.
 */
export const AMBIGUOUS_CONTRACTIONS = new Set(['its', 'ill', 'wont', 'cant', 'im', 'lets'])

/**
 * Canonical form of a word for identity purposes.
 *
 * Correcting a misspelling must never read as having lost information, so a
 * constraint keyed on "definately reconsider pricing" has to match one keyed on
 * "definitely reconsider pricing". Both sides of every before/after comparison
 * run through this.
 */
export function canonicalizeWord(word: string): string {
  const lower = word.toLowerCase().replace(/['’]/g, '')
  return TYPO_MAP[lower] ?? CONTRACTION_MAP[lower]?.replace(/['’]/g, '') ?? lower
}

/** Tone adjectives whose presence is a constraint, never filler. */
export const TONE_WORDS = new Set([
  'professional', 'formal', 'informal', 'casual', 'friendly', 'conversational',
  'academic', 'technical', 'playful', 'serious', 'neutral', 'persuasive',
  'empathetic', 'concise', 'detailed', 'blunt', 'warm', 'witty', 'authoritative',
  'approachable', 'simple', 'brief', 'thorough', 'succinct',
])

/** Words that turn a nearby filler word into meaningful content. */
export const MEANING_ANCHORS = new Set([
  'not', 'no', 'never', 'without', 'only', 'exactly', 'must', 'avoid', 'except',
  'unless', 'but', 'however', 'though', 'although',
])

export const ALL_LEXICON_RULES: LexiconRule[] = [
  ...POLITENESS_RULES,
  ...WORDY_RULES,
  ...FILLER_WORD_RULES,
  ...TRANSITION_RULES,
]
