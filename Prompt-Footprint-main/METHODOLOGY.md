# PromptFootprint Methodology

This document records how PromptFootprint estimates the environmental impact of
AI chat usage: the formulas, the evidence behind each number, and — importantly
— the limitations. The goal is a transparent, defensible **range**, not a precise
measurement.

The evidence base lives in `extension/lib/env/` (sources, profiles, factors,
required copy) and the math in `extension/lib/estimator.js`. Model detection
lives in `extension/lib/models/`.

## 0. The rule the whole design serves

Nobody has published production per-query environmental telemetry for any
current flagship model. Presenting an estimate as if they had is the single
worst failure this product can commit, so every number carries the class of
evidence that produced it:

| Class | Meaning |
|---|---|
| `MEASURED` | Production instrumentation with a disclosed methodology |
| `REPORTED` | A provider figure published without enough method to reproduce it |
| `MODELED` | An independent estimate from hardware/latency/throughput/token assumptions |
| `ENGINEERING_PRIOR` | A PromptFootprint assumption for a model nobody has measured |

Exactly one profile in the entire table is `MEASURED`, and it is a **product
median**, not a model measurement. Nothing is ever displayed without its class.

## 1. Token estimation

We never see provider token counts, so we approximate from text length:

```
tokens = max(1, ceil(text.length / 4))
```

The cl100k_base tokenizer averages ~4 characters per token; code tokenizes
denser (~3.5) and prose looser (~4.5), so 4 is a balanced midpoint.

**Limitation:** ±~15% versus a true tokenizer, worse for non-English or heavily
formatted text. Worse still across model generations — Claude Sonnet 5's
tokenizer can produce ~30% more tokens for the same text than Sonnet 4.6, so raw
token counts are **not comparable across generations** [S8].

## 2. Verified anchors

| Anchor | Energy | Carbon | Water | Class |
|---|---:|---:|---:|---|
| Gemini Apps median text prompt, May 2025 | 0.24 Wh | 0.03 gCO₂e | 0.26 mL | MEASURED, product median [S1] |
| Average ChatGPT query (June 2025 statement) | ~0.34 Wh | not disclosed | ~0.322 mL | REPORTED, no method [S2][S3] |
| GPT-4o short/medium/long (Azure proxy) | 0.423 / 1.215 / 2.875 Wh | via Azure proxy | via Azure proxy | MODELED [S5] |
| Claude 3.7 Sonnet short/medium/long (AWS proxy) | 0.950 / 2.989 / 5.671 Wh | via AWS proxy | via AWS proxy | MODELED [S5] |
| Generic conventional frontier query | 0.34 Wh median, IQR 0.18–0.67 | — | — | MODELED [S4] |
| Generic test-time-scaling query | 4.32 Wh median, IQR 2.38–7.38 | — | — | MODELED [S4] |

The Gemini figure's boundary includes active accelerators (0.14 Wh, 58%), host
CPU+DRAM (0.06, 25%), provisioned idle machines (0.02, 10%), and data-center
overhead (0.02, 8%). A narrower accelerator-only boundary yields 0.10 Wh, so the
comprehensive result is 2.4× the narrow one — which is why boundaries are never
dropped when comparing figures.

## 3. Current-model priors

No provider publishes model-specific production telemetry for the models below.
These are **low-confidence engineering priors** for an ordinary short
interaction (~100 input, ~300 visible output tokens, no tools, no extended
reasoning), anchored to the verified values above.

| Model | Low–high Wh | Centre | Basis |
|---|---:|---:|---|
| Gemini 3.6 Flash | 0.15–0.40 | 0.24 | Gemini Apps median adapted to the efficient tier |
| Gemini 3.1 Pro | 0.30–1.00 | 0.50 | prior above the product median |
| GPT-5.6 Luna | 0.20–0.60 | 0.34 | ChatGPT reported average + frontier baseline |
| GPT-5.6 Terra | 0.30–0.90 | 0.50 | prior between efficient and flagship |
| GPT-5.6 Sol | 0.40–1.20 | 0.67 | GPT-5 short/minimal routing proxy |
| Claude Sonnet 5 | 0.60–1.20 | 0.90 | Claude 3.7 proxy, widened for unknown deployment |
| Claude Opus 5 | 0.80–2.00 | 1.20 | prior; thinking on by default |
| Claude Fable 5 | 1.00–3.00 | 2.00 | prior; adaptive thinking always on |
| Claude Mythos 5 | 1.00–3.00 | 2.00 | prior mirroring Fable; a **distinct** model with no separate evidence |

High-reasoning and agentic work uses separate, deliberately broad bands (e.g.
Gemini 3.1 Deep Think 2–7 Wh medium / 5–25 Wh long; Claude Fable 5 at high
effort 4–25 / 10–40+ Wh), anchored to the 4.32 Wh test-time-scaling median and
the independent GPT-5 routing proxy (0.67 / 2.33 / 17.15 / 33.8 Wh). Their
centres are geometric means: for a band spanning an order of magnitude, an
arithmetic midpoint sits far above the bulk of the distribution.

Price is **not** used as an energy signal. A newer model may use more compute per
inference and fewer turns overall, so per-interaction and per-task estimates are
kept separate.

## 4. Assembling an estimate

```
interaction = fixed serving + input prefill + visible output decode
            + hidden reasoning + model/tool routing overhead
task        = sum of observed interactions, marked a lower bound when calls are hidden
```

1. **Scenario** from the token counts, using the boundaries between the three
   published scenarios (100/300, 1k/1k, 10k/1.5k).
2. **Base band** — a model-specific prior when the model is known, the generic
   frontier distribution when it is not. There is no branch that substitutes a
   flagship for an unknown label.
3. **Scenario scaling** — medium = short × 2.5–3.5, long = short × 5–7.
4. **Token fit** (fallback shape only, labelled MODELED):

```
GPT-4o / Azure proxy:      E_Wh ≈ 0.121 + 0.000131·input + 0.000963·output
Claude 3.7 / AWS proxy:    E_Wh ≈ 0.118 + 0.000147·input + 0.002724·output
```

   These are PromptFootprint's own fits to the three published scenarios, not
   equations the authors published. They describe GPT-4o and Claude 3.7, **not**
   GPT-5.6 or Claude 5. They may only raise a band's ceiling, never lower its
   evidence-backed floor, and they are clamped at 10k input / 1.5k output —
   beyond that the uncertainty is widened sublinearly (capped at 3×) instead of
   the estimate being extrapolated in a straight line.
5. **Tools** widen the ceiling and are named; agentic tools mark the result a
   lower bound. Nothing a tool does is treated as free.
6. **Confidence** starts at the profile's and is reduced for every unknown —
   an unresolved model, Auto routing with no exposed backend.

## 5. Carbon

Carbon is computed from energy under **one named factor**, and the accounting
method travels with the number:

| Factor | gCO₂e/Wh | Accounting |
|---|---:|---|
| Google fleet | 0.125–0.14 | market-based + allocated embodied [S1] |
| Azure/OpenAI proxy | 0.35 | location-based [S5] |
| AWS/Anthropic proxy | 0.287 | location-based [S5] |
| Unknown deployment | 0.10–0.60 | unspecified |

Current Claude can run on several clouds, so an unknown Anthropic deployment
uses the broad grid range with the AWS proxy shown separately as a reference.
`combineCarbon()` **refuses** to merge market-based and location-based figures
into one field: doing so would rank providers by an artefact of their reporting
choice.

## 6. Water

Cooling water and full-operational water are different quantities and live in
different fields.

| Factor | mL/Wh | Boundary |
|---|---:|---|
| Google product cooling | 1.15 (anchor pair 0.24 Wh → 0.26 mL) | cooling + associated infrastructure [S1] |
| ChatGPT reported | 0.322 mL at 0.34 Wh | **undisclosed** [S2] |
| Azure operational proxy | 4.35 + 0.30/1.12 ≈ 4.618 | on-site cooling + electricity generation [S5] |
| AWS operational proxy | 5.11 + 0.18/1.14 ≈ 5.268 | on-site cooling + electricity generation [S5] |

The operational proxies exclude hardware-manufacturing water. `combineWater()`
refuses to merge different boundaries, and the UI always shows the caveat that
the two are measured differently.

## 7. Prompt savings

Removing input tokens removes part of **prefill**, which is a minority of an
interaction's energy at short and medium lengths:

| Scenario | Input share of total interaction energy |
|---|---:|
| Short | 1–5% |
| Medium | 5–15% |
| Long context | 25–50% |

```
reduction = total_energy × input_share × input_token_reduction_fraction
          − expected_output_growth × (1 − input_share)
```

So a 50% input cut on a short prompt is displayed as roughly **0.5–2.5%** of the
whole interaction, never "50% saved". Because compression can lengthen the
response or trigger a follow-up, the second term can drive the result to zero or
negative — a 2026 study of 28,421 trials found provider-dependent effects
including output expansion and quality loss, and concluded input compression
alone is not a reliable production energy optimization [S21].

Before sending, the wording is "potential input tokens avoided", "estimated
input-processing reduction", "projected interaction range". "Saved" is used only
when comparing two complete, same-model, same-mode scenarios.

## 8. Model detection

The extension reads the **selected** model from accessible DOM state — never by
intercepting network traffic, and never by injecting script into the page. Each
provider has an isolated adapter (`lib/models/adapters/`), and candidates are
scored on independent signals rather than matched by one CSS selector:

```
+40 selected/checked menu option    -30 hidden / collapsed menu / template clone
+25 known model or mode token       -30 unselected row in an open menu
+20 near the composer or top bar    -25 destructive or settings control
+15 aria/title mentions model terms
+10 visible and enabled
```

A candidate must clear a floor of 35; below it the answer is "Unknown model",
which is a valid and useful answer. An unrecognised label is preserved verbatim
(`Unknown model — "GPT-7.2 Nimbus"`) and never upgraded to a flagship. Auto
routing sets `routing: auto` with no canonical model unless the page itself
names the effective one. Projects, Gems, custom GPTs, and styles are surfaces and
configurations, not model identities, and their names are never fed to the
catalog.

Changes are picked up live: a `MutationObserver` scoped to the adapter's roots
(plus their parents, so a React subtree swap is visible), a throttled ~120 ms
label scan, a debounced ~350 ms recalculation, `popstate`/`hashchange`, and a
1 s href check for `pushState` navigation. Every change bumps a `generation`
counter that invalidates in-flight work for the previous model.

**Per-message snapshots.** The model is frozen at send time. If you send on Opus
and then switch to Sonnet, that message stays an Opus message. The only thing
that may amend a sent message is provider-exposed response metadata naming the
model that served *that* response, and it amends only that one interaction.
Snapshots store a non-reversible local hash of the prompt and its token count —
never the prompt text.

## 9. Contextual overlays

**Heatwave / cooling.** A display-only factor of `peakPUE(temp) / annualPUE`
(1.1 → 1.4 between 25 °C and 40 °C) applied to session totals using weather at
the nearest known cloud region as a proxy. It is never stored and never claims to
know the data center that served a request.

**Real-world equivalents.** For intuition only: water → drops/glasses; energy →
phone screen-on time (~3 W, 1 Wh = 1200 s); CO₂ → metres driven (~200 g/km).

## 10. Legacy estimator (storage schema 1)

Before the evidence-aware estimator, impact was a flat per-token intensity
derived top-down from an annual disclosure (≈1.06e-3 Wh/token, with Claude scaled
1.15×) multiplied by a response-time factor. Those records are **not** comparable
with the new ranges.

Migration is additive: sessions and queries written by the old model are stamped
`estimatorVersion: "legacy-token-linear-v1"` and their numbers are left exactly
as recorded. History is a record of what a user was actually shown, and
recomputing it under a new estimator would falsify that record.

The response-time model and the per-token constants remain in
`lib/environmentalModel.js` / `lib/constants.js` because the heatwave overlay and
the legacy read path still use them.

## 11. Overall limitations

PromptFootprint produces **estimates** to build intuition and encourage efficient
prompting. It does not measure energy, water, or carbon. It cannot see
provider-side batching, caching, utilization, hardware, routing decisions,
sub-agents, retries, or tool compute. Its current-model figures are assumptions,
not measurements, and are expected to be replaced the moment providers publish
real per-model telemetry. Use the ranges and the trends, not the decimals.

## Sources

- **[S1]** Google — *Measuring the Environmental Impact of Delivering AI at Google Scale.*
- **[S2]** Sam Altman — *The Gentle Singularity.*
- **[S3]** OpenAI Academy — *Environmental Impact of AI.*
- **[S4]** Oviedo et al. — *Energy use of AI inference, efficiency pathways, and test-time scaling*, Joule (2026).
- **[S5]** Jegham et al. — *How Hungry is AI?* v6.
- **[S6]** Anthropic Transparency Hub.
- **[S7]–[S12]** Anthropic model, thinking, and effort documentation.
- **[S13]–[S16]** OpenAI API model docs and ChatGPT model-availability help.
- **[S17]–[S20]** Google DeepMind model cards and Gemini Apps help.
- **[S21]** Johnson — *The Compression Paradox in LLM Inference* (2026 preprint).

Full titles, URLs, and dates are in `extension/lib/env/sources.js`, which is the
single place any displayed figure resolves its citation from.
