# Model detection

Which model is this prompt about to be sent to, and how hard will it think?

Everything downstream depends on the answer. The environmental estimate is built
from the model's prior and its reasoning tier — the spec is explicit that
test-time compute can move energy by an order of magnitude — and the Token
Cutter's final readability check consults it too. A detector that is confidently
wrong is worse than one that says "not exposed".

---

## The one rule

**Be aggressive about finding reliable application signals. Be conservative
about claiming information the product does not actually expose.**

Three pairs of facts are kept apart, always, and each pair is a place where
merging them would produce a confident lie:

| | |
| --- | --- |
| `selectedLabel` | what the picker showed, verbatim |
| `canonicalModelId` | what we mapped it to, or `null` |
| **`selectedModel`** | the user's choice — under Auto, that choice is "auto" |
| **`effectiveModel`** | the model that actually served a response, when the provider says so |
| **`verified`** | whether the product told us which model is selected |
| **`estimateBasis`** | whether we have a calibrated footprint for it |

The last pair is the subtle one. A model that shipped this morning can be
**fully verified** — the picker named it, we read the picker — while its
environmental estimate is a provider-level fallback. Those are different
questions and they get different answers. The UI shows the exact model name and
labels the *estimate*, never the model, as uncertain.

---

## Architecture

```
                        PFModelDetector          one per page
                              │                  owns every observer
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
       ChatGPTAdapter   ClaudeAdapter   GeminiAdapter
              └───────────────┼───────────────┘
                              ▼
                      PFAdapterShared            score → pick → canonicalize
                              ▼                  → apply vendor constraints
                       ModelObservation
                              ▼
                    toDetectedModel()            the normalized record
                    ┌─────────┴─────────┐
                    ▼                   ▼
             PFEstimator          in-page assistant
```

An adapter is a list of selectors and a couple of product quirks. Everything
downstream of "here are the candidate controls" is shared, which is what keeps
adding a provider small.

**Detection is centralized.** No component queries the page for a model of its
own. The assistant is *handed* an observation and *told* when it changes. That
is how one page ends up with one answer, and it is why a model switch is a
single event rather than a rescan in every component that cares.

---

## Signals, and why there is more than one

`document.querySelector('.some-class')` is how detection silently breaks the
week after a redesign. A chat page also contains many strings that look like a
model name: the open menu, the *closed* menu still in the DOM, a settings
dialog, a `<template>` clone, the conversation title, a Project called "Fable 5
migration".

So every candidate control is scored on independent semantic signals:

| Signal | Weight |
| --- | --- |
| marked selected (`aria-selected` / `aria-checked` / `data-state=checked`) | +40 |
| contains a known model or mode token | +25 |
| lives in the composer or the top bar | +20 |
| accessible name mentions model/mode terms | +15 |
| rendered and enabled right now | +10 |
| hidden, collapsed, or a `<template>` clone | −30 |
| a row in an open menu that is **not** the current one | −30 |
| a destructive or settings control that merely has text in it | −25 |

The winner must clear a floor of 35. If nothing does, the answer is "unknown",
which is a valid and useful answer.

**Priority.** A control that *names a model* outranks one that does not, when it
is a credible answer in its own right:

```
model-naming candidates, if any clears the floor
        ↓
any candidate that clears the floor        (this is what reads "Auto")
        ↓
the visible picker's raw text              (a model we have never seen)
        ↓
unknown
```

Both halves of that first rule are load-bearing. Without the preference, opening
the *effort* submenu lets its checked row ("Max", 75 as a selected option) beat
the model picker beside it, and the observation loses the model entirely.
Without "credible", a collapsed menu full of model names — which every real page
keeps in the DOM — suppresses the visible picker whenever the picker shows a
mode like Auto, and the page reads as having no model at all.

**What this deliberately does not do:** patch `fetch`/XHR to sniff the model, or
inject script into the page's world. Detection stays on accessible DOM state —
the same state a screen reader would read.

---

## Reasoning

The thinking setting is a **separate control** from the model, read separately,
and it is the second-largest input to the estimate.

Two vocabularies are kept and never merged:

- **the raw label** — exactly what the product showed ("Extended thinking",
  "Thinking · High"). Displayed; never interpreted.
- **the reasoning class** — `minimal · standard · adaptive · high · maximum ·
  pro`. Derived; fed to the estimator.

A third vocabulary, the estimator's own `reasoningMode`
(`none/low/medium/high/xhigh/max/adaptive/pro/deep-think`), is wired into
published energy priors and is left exactly as it is. `classify()` maps into the
class vocabulary and `estimatorMode()` maps back out; the round trip is lossy in
the safe direction, so it can never quietly *reduce* the assumed compute of an
interaction.

An unrecognised label produces `null`, not a guess. "Not exposed" is a true
statement about the page; "standard" would be a fabrication about the backend.

Vendor rules outrank any control: Fable 5's adaptive thinking is always on and
cannot be disabled, and Opus 5's thinking is on by default and cannot be
disabled at xhigh or max. A control reading "Off" next to Fable 5 does **not**
produce a no-reasoning observation.

---

## Change handling

```
DOM mutation / route change
     → throttled cheap scan   (~120 ms)  reads only the control labels
     → debounced full recalc  (~350 ms)  builds a whole observation
     → identity changed? bump `generation`, dispatch, notify subscribers
```

`generation` is the cancellation primitive for everything async. An estimate or
an optimizer result stamped with an old generation describes a model the user
has already moved away from, and is dropped.

On a change the assistant does three things, in this order: updates the pill so
the switch is visible immediately; cancels anything in flight; re-analyzes the
draft against the new target. It is a re-analysis rather than a re-render
because the target model feeds the optimizer's readability check.

**Performance.** No polling of the DOM. Observers are scoped to the smallest
stable ancestors each adapter names, re-resolved on every scan (React replaces
the picker and composer subtrees on navigation), and `refresh` disconnects
before re-observing — which is what stops a rebind stacking a second observer on
the replacement. The one timer in the system reads `location.href`, because
`pushState` fires no event and we will not inject a script to hear it; it reads
one string and is not a DOM scan. There is a test asserting that an idle page
costs zero extra `querySelectorAll` calls.

**What must keep working across:** new chat · existing chat · Projects · custom
GPTs · sidebar navigation · model changes · temporary chats · attachment uploads
· composer remounts · layout changes · resize · theme changes.

---

## Per-message metadata

The current picker is not the answer to "which model was this message sent
with?". If a user sends one prompt on Opus and then switches to Sonnet, the
first message is an Opus message forever.

At send time `PFPromptSnapshots` freezes the observation, the token count, and
the pre-send estimate. Later picker changes cannot touch it. The only thing that
may amend a snapshot is the provider itself, through exposed response metadata,
naming the model that served *that* response — and even then only that one
snapshot changes.

The prompt text is never stored. A non-reversible FNV-1a hash is kept so the
same prompt can be recognised without retaining its content.

---

## A model we have never seen

1. Capture the exact visible label.
2. Persist it locally as an observed model (`pf_observed_models`, capped ring,
   never transmitted).
3. **Do not map it to an older model because the names look similar.** A bare
   tier word ("Sol", "Flash", "Pro") is a safe alias only while there is one
   generation of it; the moment "GPT-5.7 Sol" ships, matching on "sol" resolves
   a brand-new model to last version's entry, confidently and silently. So a
   label that states a version must agree with the family it resolved to, or the
   match is refused.
4. Use the provider-neutral environmental fallback.
5. Mark the estimate as a fallback (`estimateBasis: 'provider-fallback'`).
6. Keep showing the exact label the UI exposed.
7. Log enough structured information to update the registry for real.

Configuration names are never recorded as models — a Project, Gem, custom GPT,
or style is a name the user wrote, and its name says nothing about the backend.

---

## The registry

One table, `lib/models/catalog.js`: aliases, canonical ids, families, tiers, and
the vendor constraints. Labels are normalized (case, whitespace, the five
Unicode dashes providers use interchangeably, trademark marks, dropdown carets)
before matching — but digits, dots, and tier words are left alone, because those
are the difference between Sonnet 5 and Opus 5, and between 3.1 Pro and 3.6
Flash.

Aliases are kept separate from environmental factors. Adding a model is a data
change; calibrating one is not.

---

## The debug panel

Behind **Assistant settings → Model-detection debug panel**, off by default.

```
Provider              OpenAI
Product               chatgpt
Detected model        GPT-5.6 Sol
Canonical             gpt-5.6-sol
Reasoning (raw)       Thinking
Reasoning (class)     high
Detection source      selected menu option
Verified              yes
Estimate basis        model
Last change           13:06:42
Signals               picker-label:GPT-5.6 Sol(55) · aria:Auto(25) · …
```

It shows the losing candidates and their scores, not just the winner: a wrong
answer is usually a scoring problem, and the runner-up's score is the evidence
for that. The whole panel is designed to make a detection bug diagnosable from a
screenshot.

---

## Known limitations

- **ChatGPT's Auto routing is not observable.** The picker is *selected intent*;
  the backend identity is not exposed. Auto reads as Auto and never resolves
  itself into a model name. If a routed model ever becomes observable it lands
  in `effectiveModel`, where its provenance stays visible.
- **A custom GPT's or Gem's backend may migrate.** The surface is labelled
  honestly and the model is read separately when the UI exposes it.
- **Reasoning is only detected where a product exposes a control for it.** A
  page with no reasoning control reports "not exposed" rather than a default.
- **The catalog is a snapshot.** New models are detected and named correctly and
  estimated at the provider level until the registry catches up.
