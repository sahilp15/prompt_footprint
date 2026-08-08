# Token Cutter

A local-first prompt optimizer. Paste a prompt, see exactly what can go and why,
accept or reject each change, and get the tokens — and the energy, water, and
CO₂ behind them — you avoided.

**It works with no API key, no account, and no network.** An optional Gemini
pass exists, but the local path is the product; the remote path is an
enhancement that can be switched off, fail, or be rate-limited without degrading
anything.

Open it at **Dashboard → Token Cutter** (`#/cutter` in the extension,
`#/app/cutter` on the public site) — or use it without opening anything, from
the in-page assistant beside the ChatGPT and Claude composer.

---

## Two surfaces, one engine

The dashboard and the in-page assistant are not two optimizers. The extension's
content script has no bundler, so `stats-site/src/lib/tokenCutter/` is compiled
to a single content-script global:

```
stats-site/src/lib/tokenCutter/extensionEntry.ts
        │  esbuild --format=iife --global-name=PFTokenCutter
        ▼
extension/lib/tokenCutter.bundle.js        (committed; `npm run build:cutter`)
        │
        ├── extension/overlay/assistant.js   in-page assistant
        └── extension/dashboard/…            Token Cutter page (vite build)
```

Rebuild the bundle whenever the pipeline changes, or the in-page assistant will
quietly keep running the old one.

### What the in-page assistant uses

| Stage | Used by the assistant |
| --- | --- |
| `analyzePrompt` | every analysis, after a 600 ms typing pause |
| `validation` | the "Meaning preserved" claim — stated only when `validated && ok` |
| `analytics` | token counts, percent reduction, and the water/energy figures |
| `suggestions` | the "what changed" summary, grouped by title |
| `loadMemory` | never-remove terms you saved in the dashboard apply in the composer |
| `validateMeaning` | holds an optional *remote* rewrite to the local standard |

Two rules the assistant adds on top of the pipeline:

1. **A saving must be worth interrupting for** — at least 2 tokens *and* at least
   1.5%. Below that it does **not** claim the prompt is concise; it asks the
   engine (see *Concision*, below) and says either "Already concise" or "Little
   left to cut", with the reasons.
2. **A result that fails validation is never offered**, locally or remotely.

---

## The pipeline

Nine stages, all pure functions over the original text. Nothing mutates the
user's writing.

```
                    ┌─────────────────────────────────────────┐
  your prompt ──▶   │ 1. protect    what may never be edited  │
                    │ 2. segment    sentences + their role    │
                    │ 3. extract    entities + constraints    │
                    │ 4. detect     candidate edits           │
                    │ 5. generate   vetoes → Suggestion[]     │
                    └────────────────┬────────────────────────┘
                                     │  your accept/reject decisions
                    ┌────────────────▼────────────────────────┐
                    │ 6. apply      accepted edits → text     │
                    │ 7. validate   re-extract and compare    │
                    │ 8. refine     run 1–7 again on the      │
                    │               result, until it stops    │
                    │               paying                    │
                    │ 9. assess     is this genuinely as      │
                    │               short as it can be?       │
                    └────────────────┬────────────────────────┘
                                     ▼
                       optimized prompt + what it cost
```

Stages 1–5 run once per keystroke burst (debounced 320 ms, in a Web Worker for
prompts over 600 characters). Stages 6–9 run on every accept/reject, which is
why toggling a suggestion feels instant.

### 1. Protect

Prompts are not prose. Before anything may be deleted, these regions are claimed
and locked:

fenced and indented code · inline code · JSON (balanced-brace matching, not a
regex) · URLs · emails · template placeholders (`{{x}}`, `${x}`, `<x>`, `%s`) ·
math · quoted text · Markdown links · file paths · dates · numbers with units ·
any term on your never-remove list

Protection is tracked as a byte mask, so the stage is linear in text length no
matter how many matches a prompt contains.

Two tiers matter downstream. **Hard** protection (code, quotes, links,
placeholders) can never be touched. **Soft** protection (numbers, dates) stops a
rewrite *altering* the value but still lets a whole restated sentence be removed
— because the validator independently confirms the value still appears
elsewhere.

### 2. Segment

Blocks (paragraph / list item / heading / code), then sentences, with
abbreviations and initials handled so `Dr. Chen` and `e.g.` don't split a
sentence. Each sentence is classified:

`role` · `task` · `context` · `constraint` · `example` · `format` · `question` ·
`meta` (greetings and sign-offs — the only class treated as disposable)

### 3. Extract

The preservation contract. Everything found here is re-extracted from the
optimized text in stage 7:

names · numbers · dates · URLs · emails · file types · technologies · proper
nouns · quoted text · negations · length limits · explicit must/must-not clauses

Plus **constraints** with a normalized key so duplicates can be detected:
length, tone, format, audience, deadline, inclusion, exclusion, language.

Two details that took real care:

- A capital at the start of a sentence is only a name if that same token also
  appears capitalized mid-sentence. Otherwise removing "Basically," would report
  a lost name every time.
- `whether or not` contains no semantic negation, so shortening it to `whether`
  is allowed — but every other "not" is counted and protected.

### 4–5. Detect and generate

Detectors propose edits; the generator decides which survive.

| Detector | Finds |
| --- | --- |
| `grammar.ts` | Misspellings, missing apostrophes, doubled words, a/an, spacing, a question mark left behind by a removed polite wrapper |
| `lexicon.ts` | Politeness, filler, hedges, wordy constructions, transitions, **verbose instruction wrappers**, **meta-commentary** |
| `redundancy.ts` | Repeated sentences (**both directions**), **repeated clauses**, restated constraints, **stated preferences**, extra examples, mergeable sentences, **parallel imperatives**, ambiguity |

Three of those are the reason a padded prompt no longer reads as concise:

**Instruction wrappers.** "Make sure that you look for bugs" and "look for bugs"
ask for the same thing. These are the only rules allowed to overlap a
constraint, because they remove the *framing* and leave the payload — "make sure
you keep it under 300 words" still says 300 words afterwards — and the validator
re-checks the constraint key regardless.

**Backward duplicates.** "Keep it engaging." followed by "Keep it engaging for a
general audience." is not two duplicate sentences; the second carries detail the
first does not. A forward-only scan leaves both. The *earlier* one is the
redundant one, and removing it is a `maximum`-level edit because deleting the
sentence someone wrote first is the more surprising change.

**Parallel imperatives.** "Check for X. Check for Y. Check for Z." says the verb
three times to carry three objects. Merging keeps every object — where all the
information is — and drops the repeats. Guarded hard: identical verb phrase, no
negation anywhere in the run (merging two prohibitions under one scope changes
them), no protected content, short objects only.

Four vetoes then apply. An edit is discarded if it:

1. touches protected content,
2. reduces the number of non-idiomatic negations,
3. damages a constraint (unless it *is* a deduplication of that constraint), or
4. removes a filler word that its context makes meaningful — `just the code`,
   `not really`, `very concise`.

What survives is de-overlapped (highest confidence wins), gated by the chosen
level, and scored.

**Confidence** is a per-rule judgement, bucketed for display:

| Score | Bucket | Behaviour |
| --- | --- | --- |
| ≥ 0.85 | High | Accepted by default |
| 0.62–0.85 | Medium | Offered, not applied |
| < 0.62 | Low | Offered, never applied automatically |

**Levels** gate which rules run at all:

| Level | Intent | Auto-applies |
| --- | --- | --- |
| **Light** | Fix grammar, spelling, and obvious filler. Keeps your voice. | `safe` edits scoring ≥ 0.85 |
| **Balanced** | Cut substantially while preserving tone, context, and every requirement. | anything scoring ≥ 0.70 |
| **Maximum** | Smallest prompt that still carries every essential instruction. | anything scoring ≥ 0.55 |

The floor is what decides how aggressive the optimizer actually is, and it is
the thing that was wrong. Every level used to auto-apply only edits scoring
≥ 0.85, so Balanced and Maximum produced nearly identical, nearly unchanged
text: the detectors were finding the repetition and the wrappers, and the
acceptance rule threw almost all of it away. Being aggressive here is safe
because it is not the last word — everything applied is re-checked by the
validator against the original, and any edit that actually lost information is
rolled back individually (see *Repair*, below).

### 6. Apply

Three strictly meaning-preserving passes:

1. Splice accepted replacements in, right to left, so offsets stay valid.
2. **Repair the seams** — remove punctuation the deletion orphaned, restore the
   space a removed sentence took with it, re-capitalize a sentence whose opener
   was cut. Scoped to the exact cut positions, so it can never touch text you
   kept.
3. Tidy whitespace **outside fenced code** — indentation inside a code sample is
   content, not formatting.

### 7. Validate

Every entity and constraint is re-extracted from the result and compared against
the original. Missing items are reported as `critical` or `warning`, and the UI
offers to undo *just* the changes responsible rather than discarding everything.

Deliberate design choices here:

- Comparison is on distinct keys, so removing a duplicated sentence is not
  counted as losing the entity it repeated. Negations are the exception — each
  occurrence is keyed separately.
- Constraint keys are canonicalized through the typo map, so fixing "definately"
  inside an instruction never reads as having lost the instruction.
- The report type carries `validated: true`. There is no code path that produces
  a "meaning preserved" claim without actually running this comparison.

**Repair.** When validation fails, the pipeline does not discard the whole
optimization. `culpableSuggestionIds()` names the edits blamed for a critical
loss, those are rejected, and everything else the user was about to get
survives. This is what makes an aggressive acceptance floor safe: the optimizer
earns the right to be bold by undoing its own mistakes precisely.

### 8. Refine

The largest savings in a real prompt are only visible *after* an earlier one has
been taken. Removing "Could you please make sure that" is what exposes the two
sentences underneath it as near-duplicates of each other; in the original text
they are not duplicates yet, and no single pass can see it.

So stages 1–7 run again over their own output, up to three more times. Three
independent termination guarantees, because a compression loop that can run
forever is a frozen tab:

- a hard cap on rounds (and fewer rounds for very long prompts, so the worst
  case stays inside a frame budget);
- every round must strictly reduce the token count, or the loop stops;
- **every round is validated against the ORIGINAL**, never against the previous
  round — otherwise three individually-safe rounds could add up to a lost
  requirement. A round that fails is discarded and the loop stops there.

Rounds after the first are reported as `refinements[]` rather than as
`Suggestion`s. A Suggestion is something the user can toggle, and toggling
something whose coordinates address a string that only existed mid-pipeline is
not a coherent offer.

### 9. Assess — "Already concise"

`concision.ts`. This claim used to rest on one number: whether the applied edits
happened to save at least four tokens. That is not a statement about the prompt
at all — it is a statement about how much the acceptance policy chose to apply —
and it is why visibly padded prompts were being waved through.

It is now the conjunction of seven independent conditions, **all** of which must
hold:

1. no semantic repetition outstanding,
2. no filler, politeness, hedge, or wordy construction outstanding,
3. no two instructions that could safely be combined,
4. no spare formatting whitespace,
5. no verbose instruction wrapper or empty framing,
6. the available reduction is negligible (< 2 tokens or < 1.5%),
7. another full pass produces nothing.

Each condition that fails becomes a reason the user can read ("3 filler phrases",
"2 repeated instructions"). The checks run against **every** suggestion the
detectors produced, not just the applied ones — a prompt where six removable
filler phrases were found and two applied is not concise, it is under-optimized,
and the panel says so.

Length is deliberately not a condition. A 25-token prompt of pure
throat-clearing fails; a 1,000-token specification with nothing spare in it
passes.

---

## Environmental figures

Token estimation and per-token energy/water/CO₂ come from
`src/lib/tokenCutter/tokens.ts`, a deliberate mirror of the extension's
`lib/tokenEstimator.js` + `lib/constants.js` + `lib/environmentalModel.js`.

The extension loads those files raw as content-script globals, so they cannot be
imported by a bundler. Instead, `stats-site/test/parity.test.ts` loads both
implementations and asserts they agree across a corpus and both platform
profiles. Keeping them in sync is a failing test, not a comment.

The response-time and heatwave multipliers deliberately do **not** apply: they
scale a *measured* response, and a prompt that is never sent has no response
time. The token-only figure is the honest floor.

---

## Memory

Preferences stored **on your device only** — `chrome.storage.local` in the
extension, `localStorage` on the web. Nothing is transmitted.

Categories: preferred tone · preferred length · formatting · writing style ·
recurring terminology · project or person names · never-remove terms · standing
instructions.

Four rules the implementation enforces:

1. **Nothing is remembered without an explicit action.** Preferences the cutter
   notices are *offered* in the panel with Remember / Dismiss buttons.
2. **Only relevant memories apply.** An entry fires when one of its trigger
   words appears in the prompt; formatting and style entries apply ambiently at
   lower weight. At most six apply to any one prompt.
3. **Your prompt always wins.** If the current text states a tone, length, or
   format, stored preferences of that kind are dropped for that run.
4. **Every application is reported.** The panel shows lines like *"Protected
   'Northwind Logistics' from being removed, based on your preferences."*

A master switch disables the whole system. Entries can be edited, weighted
(1–5), disabled individually, exported to JSON, imported, and deleted.

---

## Optional Gemini enhancement

**Local processing is the default and always sufficient.** Enhanced mode only
becomes selectable once a Worker URL is configured in Settings.

### Configuring it securely

The Gemini API key lives in exactly one place: a Cloudflare Worker secret. It is
never in the repo, never in the extension, and never in the web bundle.

```bash
cd proxy
npx wrangler login
npx wrangler secret put GEMINI_API_KEY   # stored only in Cloudflare
npx wrangler deploy                      # prints your Worker URL
```

Then paste that URL into **Dashboard → Settings → Cloudflare Worker URL**. The
browser only ever knows the Worker's public URL, which is not sensitive.

To rotate: `npx wrangler secret put GEMINI_API_KEY` again.

### What gets sent

Not "here is some text, make it shorter". The client builds a structured
instruction naming the prompt's constraints, the exact strings that must be
reproduced verbatim, and the entities that must survive — then requires a JSON
envelope back:

```json
{
  "optimized": "…",
  "preservedConstraints": ["…"],
  "removedRedundancies": ["…"],
  "uncertainChanges": ["…"],
  "protectedContent": ["…"],
  "meaningScore": 0.97
}
```

### What happens to the response

It is treated as untrusted input:

1. Parsed out of any fence or surrounding prose, shape-checked, and sanitized.
   A malformed response is treated as an outage, not partially trusted.
2. Every protected string must come back byte-identical, or the result is
   rejected.
3. It runs through the **same local validator** as every local suggestion. A
   remote rewrite that drops a constraint is rejected exactly like a local one.

The model's own `meaningScore` is shown as its opinion, clearly labelled; the
number that counts is the local check in the Impact panel.

Every failure path — not configured, prompt too long, timeout, network error,
429, non-JSON, malformed shape, protected content changed, information lost —
keeps the local result and says in plain language why.

---

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| <kbd>Ctrl/⌘</kbd>+<kbd>Enter</kbd> | Apply the safe suggestion set |
| <kbd>Ctrl/⌘</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> | Copy the optimized prompt |
| <kbd>Ctrl/⌘</kbd>+<kbd>Z</kbd> | Undo the last accept/reject — **only outside the editor**, so native text undo keeps working |

---

## Measuring quality

```bash
cd stats-site
npm run eval
```

Twenty-two cases covering repetition, filler, typos, names and dates, code and
JSON, negative instructions, hard word limits, conflicting requirements,
multilingual content, prompts that should barely change, prompts where heavy
reduction is safe, and — added with the aggression rebuild — instruction
wrappers, restated emphasis, duplicated formatting instructions, repeated
context, short-but-wasteful prompts, parallel imperatives, and a dense spec that
must come back untouched.

Each case declares what the output **must** still contain and a ceiling on how
much may be cut. **A case that saves more tokens but loses a requirement
fails** — that asymmetry is the point.

Current results:

```
Cases passed              22/22
Average token reduction   24.3%
Constraint preservation   100.0%
Entity preservation       100.0%
Unsafe auto-applied rate  0.0%
Average meaning score     1.000
```

The average is dragged down deliberately: several cases are prompts that
*should* barely change. Verbose real-world prompts reduce 35–60%.

The extension carries a second, larger corpus in
`extension/test/tokenCutterAggression.test.js`, which runs against the SHIPPED
BUNDLE rather than the source — so a stale `npm run build:cutter` fails there
rather than in a user's browser. Every prompt in it that a reader would call
padded carries a reduction FLOOR, so the optimizer cannot quietly go quiet
again.

---

## Known limitations

- **Token counts are estimates.** ~4 characters per token, the same
  approximation the rest of PromptFootprint uses. Expect ±15%, more for code and
  non-English text.
- **Spelling correction is a curated map, not a dictionary.** High precision,
  limited recall — deliberate, because a confidently wrong "correction" of a
  name or an API is worse than an uncorrected typo. British spellings are not
  "corrected".
- **Structure detection is rule-based and English-first.** Non-English prompts
  are protected and analyzed for tokens, but role classification and the
  redundancy detector will find less.
- **Readability is a proxy.** Flesch Reading Ease measures sentence and word
  length, not whether an instruction is clear.
- **The enhanced pass caps at 4,000 characters** of prompt, matching the
  Worker's limit. Longer prompts use the local path.
- **Validation checks what it extracts.** It is a strong net for names, numbers,
  dates, links, negations, formats, and limits — it is not a semantic equivalence
  proof, and the UI never claims it is.
- **Negations are never consolidated.** "Do not use jargon. Do not use technical
  terms." could be one sentence, and the optimizer will not make it one: every
  edit is refused if it reduces the number of non-idiomatic negations, and that
  veto has no exceptions. It costs some compression on prohibition-heavy prompts
  and it is the correct trade.
- **Verb synonymy is invisible to it.** "Keep it engaging" and "Make it
  engaging" are the same requirement, and the redundancy detectors — which work
  on content-word overlap — will not merge them.
- **Refinement rounds do not appear in the diff.** The comparison view is built
  from the first pass's edits, so it can link each change to the suggestion
  responsible. Later rounds are listed as `refinements[]` instead.
