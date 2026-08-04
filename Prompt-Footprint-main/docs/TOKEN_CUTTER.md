# Token Cutter

A local-first prompt optimizer. Paste a prompt, see exactly what can go and why,
accept or reject each change, and get the tokens — and the energy, water, and
CO₂ behind them — you avoided.

**It works with no API key, no account, and no network.** An optional Gemini
pass exists, but the local path is the product; the remote path is an
enhancement that can be switched off, fail, or be rate-limited without degrading
anything.

Open it at **Dashboard → Token Cutter** (`#/cutter` in the extension,
`#/app/cutter` on the public site).

---

## The pipeline

Seven stages, all pure functions over the original text. Nothing mutates the
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
                    └────────────────┬────────────────────────┘
                                     ▼
                       optimized prompt + what it cost
```

Stages 1–5 run once per keystroke burst (debounced 320 ms, in a Web Worker for
prompts over 600 characters). Stages 6–7 run on every accept/reject, which is
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
| `grammar.ts` | Misspellings, missing apostrophes, doubled words, a/an, spacing |
| `lexicon.ts` | Politeness, filler, hedges, wordy constructions, transitions |
| `redundancy.ts` | Repeated sentences, restated constraints, extra examples, mergeable sentences, ambiguity |

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

| Level | Intent |
| --- | --- |
| **Light** | Fix grammar, spelling, and obvious filler. Keeps your voice. |
| **Balanced** | Cut substantially while preserving tone, context, and every requirement. |
| **Maximum** | Smallest prompt that still carries every essential instruction. |

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

Fifteen cases covering repetition, filler, typos, names and dates, code and
JSON, negative instructions, hard word limits, conflicting requirements,
multilingual content, prompts that should barely change, and prompts where heavy
reduction is safe.

Each case declares what the output **must** still contain and a ceiling on how
much may be cut. **A case that saves more tokens but loses a requirement
fails** — that asymmetry is the point.

Current results:

```
Cases passed              15/15
Average token reduction   17.5%
Constraint preservation   100.0%
Entity preservation       100.0%
Unsafe auto-applied rate  0.0%
Average meaning score     1.000
```

The average is dragged down deliberately: several cases are prompts that
*should* barely change. Verbose real-world prompts reduce 35–60%.

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
