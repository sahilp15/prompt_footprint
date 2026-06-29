# PromptFootprint Methodology

This document records how PromptFootprint estimates the environmental impact of
AI chat usage: the formulas, constants, data sources, and — importantly — the
limitations. The goal is a transparent, defensible estimate, not a precise
measurement. All values live in `extension/lib/constants.js` and the math in
`extension/lib/environmentalModel.js`.

## 1. Token estimation

We never see provider token counts, so we approximate from text length:

```
tokens = max(1, ceil(text.length / 4))
```

The cl100k_base tokenizer (GPT-4/ChatGPT) averages ~4 characters per token.
Code tokenizes denser (~3.5) and prose looser (~4.5), so 4 is a balanced
midpoint. Prompt and response are estimated separately and summed.

**Limitation:** ±~15% versus a true tokenizer, worse for non-English or
heavily formatted text.

## 2. Per-token intensities

### ChatGPT (GPT-4o) — the anchor

Derived top-down from OpenAI's 2025 sustainability disclosure (the framework in
*Parasharami, "A Token-Level Framework for Quantifying ChatGPT's Environmental
Impacts," Vanderbilt Young Scientist Journal*):

```
annual energy = 390,000 MWh   annual water = 1.3 billion L   annual CO₂ = 138,000 t
annual tokens ≈ 2.5e9 messages/day × 403 tokens/msg × 365 ≈ 3.677e14

energyPerToken = 390e9 Wh   / 3.677e14 ≈ 1.0607e-3 Wh/token   (~1.065 Wh / 1k)
waterPerToken  = 1.3e12 mL  / 3.677e14 ≈ 3.536e-3 mL/token    (~3.54 mL / 1k)
co2PerToken    = 138e9 g    / 3.677e14 ≈ 3.753e-4 g/token     (~0.375 g / 1k)
```

These are treated as the baseline and are **unchanged** from prior versions.

### Claude — relative scaling

Anthropic does **not** publish a per-prompt energy/water/CO₂ figure, so Claude
is estimated indirectly:

```
claudePerToken = gpt4oPerToken × CLAUDE_RELATIVE_INTENSITY   (= 1.15)
```

**Basis for 1.15:**
- Independent benchmarking — *Jegham et al. 2025, "How Hungry is AI?
  Benchmarking Energy, Water, and Carbon Footprint of LLM Inference"
  (arXiv:2505.09598)* — finds Claude 3.x Sonnet among the most energy-efficient
  frontier models per task, while being a capable dense model broadly comparable
  in per-token compute to GPT-4o.
- Empirical inference studies place output-token energy at 0.0001–0.002 Wh/token;
  both the GPT-4o anchor (~0.00106) and the scaled Claude value (~0.00122) fall
  inside this range.

**Limitations:**
- Order-of-magnitude estimate; true value plausibly within ~0.8×–3× the anchor.
- Water/CO₂ are scaled by the same factor, assuming Claude runs on hyperscale
  cloud data centers (AWS/GCP) with PUE/WUE/grid intensity comparable to the
  GPT-4o baseline.
- Treat absolute Claude numbers as indicative, not authoritative.

## 3. Response-time adjustment

Energy/water/CO₂ scale with a `timeFactor` that captures how hard the model
worked per token:

```
observedTokensPerSec = responseTokens / responseTimeSeconds
timeFactor = clamp(baselineTokensPerSec / observedTokensPerSec, 1, CAP=3)
impact = tokenEstimate × userMultiplier × timeFactor
```

- Baseline throughput per platform: ChatGPT ~55 tok/s, Claude ~45 tok/s.
- The token estimate is always the **floor**: faster-than-baseline responses are
  never scaled below 1×.
- Sub-`MIN_RESPONSE_SEC` (0.5 s) timings are ignored (factor 1) as measurement
  noise. When no response time is supplied, `timeFactor = 1` — so the model is
  backward-compatible and ChatGPT's published figures are preserved exactly.
- The content script subtracts its 1.5 s streaming-settle window before reporting
  the duration.

**Limitation:** measured response time includes network, queue, and
time-to-first-token — not just GPU work. `timeFactor` is therefore a bounded
heuristic (hence the cap), not a physical energy measurement. It is intended to
reflect, directionally, that reasoning/heavier responses cost more.

## 4. GPT-5 reasoning multipliers (reference)

`REASONING_MULTIPLIERS` (1.9× minimal → 14× high, per Jegham et al.) remain
available for manual scaling but are not auto-applied; the response-time model
now captures reasoning load implicitly from observed throughput.

## 5. Real-world equivalents

For intuition only, totals are also shown as: water → drops/glasses; energy →
seconds/minutes of phone screen-on (~3 W, 1 Wh = 1200 s); CO₂ → metres driven
(~200 g/km). These are illustrative conversions, not additional claims.

## 6. Overall limitations

PromptFootprint produces **estimates** to build intuition and encourage
efficient prompting. It does not measure real energy/water/carbon, cannot see
provider-side batching, caching, or hardware, and depends on public disclosures
that are incomplete (especially for Claude). Use the trends, not the decimals.
```
