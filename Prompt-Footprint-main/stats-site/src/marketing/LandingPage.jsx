import { Link } from 'react-router-dom'
import { SITE } from '../config/site'
import { SiteNav, SiteFooter, ChromeCTA, Github } from './MarketingChrome'
import { useScrollToSection } from './useScrollToSection'
import { usePrefersReducedMotion } from '../hooks/useMotion'
import ChatDemo from './demo/ChatDemo'
import { useChatDemo } from './demo/useChatDemo'
import { SAMPLE_PROMPT } from './demo/sample'
import { analyzePrompt } from '../lib/tokenCutter/index.ts'
import { buildDiff } from '../lib/tokenCutter/apply.ts'
import { estimateTokens, countWords, IMPACT_CONSTANTS } from '../lib/tokenCutter/tokens.ts'
import { demoSessions } from '../lib/demoData'
import { AWARDS } from '../data/awards'
import { formatValue } from '../lib/metrics'
import DashboardSurface from '../dashboard/DashboardSurface'
import './marketing.css'

/* ── Facts, computed rather than written ────────────────────────────────────
   Everything numeric on this page is derived at load time from the same engine
   the product runs on. There is no figure here that a copywriter could change
   without changing the code that produces it. */

/** The sample prompt through the real local optimizer, once, at module load. */
const SAMPLE = (() => {
  const result = analyzePrompt(SAMPLE_PROMPT, { level: 'balanced', platform: 'chatgpt' })
  const originalTokens = estimateTokens(SAMPLE_PROMPT)
  const optimizedTokens = estimateTokens(result.optimized)
  return {
    original: SAMPLE_PROMPT,
    optimized: result.optimized,
    diff: buildDiff(SAMPLE_PROMPT, result.suggestions, new Set(result.defaultAccepted), result.protectedSpans),
    originalTokens,
    optimizedTokens,
    tokensSaved: originalTokens - optimizedTokens,
    percent: ((originalTokens - optimizedTokens) / originalTokens) * 100,
    originalWords: countWords(SAMPLE_PROMPT),
    optimizedWords: countWords(result.optimized),
    edits: result.suggestions.filter((s) => !s.advisory).length,
    constraintsKept: result.constraints.length,
  }
})()

/** Per-1,000-token intensities, straight out of the shared model. */
const PER_1K = {
  energyWh: IMPACT_CONSTANTS.ENERGY_PER_TOKEN_WH * 1000,
  waterMl: IMPACT_CONSTANTS.WATER_PER_TOKEN_ML * 1000,
  co2G: IMPACT_CONSTANTS.CO2_PER_TOKEN_G * 1000,
  claude: IMPACT_CONSTANTS.CLAUDE_RELATIVE_INTENSITY,
}

/** The heaviest session in the sample set — section 02's single reading. */
const SAMPLE_SESSION = (() => {
  const sessions = demoSessions()
  const s = sessions.reduce((best, x) => (x.totalTokens > best.totalTokens ? x : best), sessions[0])
  const promptTokens = s.queries.reduce((n, q) => n + q.promptTokens, 0)
  const responseTokens = s.queries.reduce((n, q) => n + q.responseTokens, 0)
  return {
    tokens: s.totalTokens,
    prompts: s.queryCount,
    promptTokens,
    responseTokens,
    platform: s.platform === 'claude' ? 'Claude' : 'ChatGPT',
    energyWh: s.totalEnergyWh,
  }
})()

/* ── Pieces ─────────────────────────────────────────────────────────────── */

function SectionIndex({ num, title, id }) {
  return (
    <div className="pf2-index" id={id}>
      <span className="u-micro u-micro-strong">{num}</span>
      <span className="u-micro">{title}</span>
    </div>
  )
}

/** The retained/removed text, set large enough to actually read. */
function DiffBlock({ diff, className = '' }) {
  return (
    <p className={`mk-diff ${className}`}>
      {diff.map((part, i) => {
        if (part.kind === 'removed') return <del key={i}>{part.text}</del>
        if (part.kind === 'added') return <ins key={i}>{part.text}</ins>
        return <span key={i}>{part.text}</span>
      })}
    </p>
  )
}

/* ── Page ───────────────────────────────────────────────────────────────── */

export default function LandingPage() {
  const scrollTo = useScrollToSection()
  const reduced = usePrefersReducedMotion()
  // The demo's state lives here so its reading can become the page's headline
  // metric without being measured twice.
  const demo = useChatDemo({ reducedMotion: reduced })

  // The bridge metric: what is removable now, or what was actually removed once
  // the visitor has tightened something. Both are real readings of the text in
  // the composer — neither is a stored constant.
  const removed = demo.reduction
  const headline = removed
    ? { value: removed.saved, label: 'tokens removed', sub: `from this prompt · ${removed.percent.toFixed(1)}% shorter` }
    : {
      value: demo.analysis?.tokensSaved ?? 0,
      label: 'tokens removable',
      sub: demo.analysis
        ? `from the prompt in the composer · ${demo.analysis.percent.toFixed(1)}% of it`
        : 'measuring the prompt in the composer',
    }

  return (
    <div className="mk mk-landing pf2 pf2-page">
      <SiteNav />

      {/* ══ 00 / LIVE TEST ══════════════════════════════════════════════ */}
      <section className="mk-hero" id="demo">
        <div className="pf2-grid mk-hero-grid">
          <div className="mk-hero-copy">
            <p className="u-micro mk-eyebrow">
              PromptFootprint <span aria-hidden="true">/</span> AI efficiency meter
            </p>

            <h1 className="u-h1 mk-h1">
              Cut the tokens<br />you don’t need.
            </h1>

            <p className="u-lede mk-hero-lede">
              PromptFootprint tightens wordy prompts, tracks what you save, and shows the
              estimated energy, water, and CO₂ behind your AI use.
            </p>

            <p className="u-micro mk-hero-spec">
              Local-first <span aria-hidden="true">/</span> ChatGPT + Claude <span aria-hidden="true">/</span> Free
            </p>

            <div className="mk-hero-cta">
              <button type="button" className="pf2-btn is-primary" onClick={() => scrollTo('demo')}>
                Try it here
              </button>
              <ChromeCTA primary={false} />
            </div>

            <Link className="mk-hero-link u-micro" to="/app">View the dashboard →</Link>
          </div>

          <div className="mk-hero-stage">
            <ChatDemo demo={demo} />
          </div>
        </div>
      </section>

      {/* ══ Bridge: the demo's reading becomes the page's ═══════════════ */}
      <section className="mk-bridge">
        <div className="pf2-grid">
          <div className="mk-bridge-figure">
            {/* aria-live so the number is announced when it changes, since the
                change is the point and it happens off to the side. */}
            <p className="u-figure mk-bridge-value" aria-live="polite">
              {headline.value.toLocaleString()}
            </p>
            <p className="u-h3 mk-bridge-label">{headline.label}</p>
            <p className="u-micro mk-bridge-sub">{headline.sub}</p>
          </div>
          <div className="mk-bridge-copy">
            <h2 className="u-h2">
              One prompt is a moment.<br />
              The dashboard shows the pattern.
            </h2>
            <p className="u-body">
              A single tightened prompt is worth a few tokens. The reason to measure is what
              happens across a week of them — which prompts got long, which days ran heavy,
              and how much of your own wording you were repeating without noticing.
            </p>
          </div>
        </div>
      </section>

      {/* ══ 01 / TIGHTEN ═══════════════════════════════════════════════ */}
      <section className="mk-section">
        <div className="pf2-grid">
          <SectionIndex num="01" title="Tighten" id="tighten" />

          <div className="mk-tighten-diff">
            <p className="u-micro mk-caption">
              The sample prompt, through the local optimizer · struck text is what came out
            </p>
            <DiffBlock diff={SAMPLE.diff} className="is-large" />
          </div>

          <div className="mk-tighten-copy">
            <h2 className="u-h2">Keep the intent.<br />Lose the extra tokens.</h2>
            <p className="u-body">
              The Energy Saver reads a draft, proposes the wording that carries no instruction,
              and reports the difference before anything is sent. It does not shorten your
              thinking — every requirement it finds in the prompt is checked again in the
              result, and an edit that would drop one is rejected rather than shown.
            </p>
            <p className="u-body">
              Context can be worth its tokens. Greetings, sign-offs and “I was wondering if you
              could” are not the same thing as context.
            </p>

            <div className="pf2-strip mk-tighten-strip">
              <div>
                <span className="pf2-cell-label">Original words</span>
                <span className="pf2-cell-value">{SAMPLE.originalWords}</span>
              </div>
              <div>
                <span className="pf2-cell-label">Original tokens</span>
                <span className="pf2-cell-value">{SAMPLE.originalTokens}</span>
              </div>
              <div>
                <span className="pf2-cell-label">Optimized tokens</span>
                <span className="pf2-cell-value">{SAMPLE.optimizedTokens}</span>
              </div>
              <div>
                <span className="pf2-cell-label">Tokens saved</span>
                <span className="pf2-cell-value mk-value-saved">{SAMPLE.tokensSaved}</span>
              </div>
            </div>

            <p className="u-micro mk-note">
              {SAMPLE.edits} edits · {SAMPLE.constraintsKept} stated requirements re-checked in the result ·
              measured with the extension’s own estimator
            </p>
          </div>
        </div>
      </section>

      {/* ══ 02 / MEASURE ═══════════════════════════════════════════════ */}
      <section className="mk-section mk-measure">
        <div className="pf2-grid">
          <SectionIndex num="02" title="Measure" id="measure" />

          <div className="mk-measure-lead">
            <p className="u-micro mk-caption">
              One session · sample data
            </p>
            <p className="u-figure mk-measure-figure">{SAMPLE_SESSION.tokens.toLocaleString()}</p>
            <p className="u-h3 mk-measure-label">tokens in this session</p>
          </div>

          <div className="mk-measure-ledger">
            <dl>
              <div><dt className="u-micro">Prompts</dt><dd>{SAMPLE_SESSION.prompts}</dd></div>
              <div><dt className="u-micro">Input tokens</dt><dd>{SAMPLE_SESSION.promptTokens.toLocaleString()}</dd></div>
              <div><dt className="u-micro">Response tokens</dt><dd>{SAMPLE_SESSION.responseTokens.toLocaleString()}</dd></div>
              <div><dt className="u-micro">Platform</dt><dd className="is-text">{SAMPLE_SESSION.platform}</dd></div>
              <div><dt className="u-micro">Est. energy</dt><dd>{formatValue(SAMPLE_SESSION.energyWh)}<i>Wh</i></dd></div>
            </dl>
            <p className="u-body mk-measure-copy">
              Counting happens in the page, as you chat. PromptFootprint reads how long each
              message is — never what it says — and writes the count, not the text. Most of a
              session is the model’s answer, which is why the response column is usually the
              larger one and why “tokens used” is not a synonym for “tokens wasted”.
            </p>
          </div>
        </div>
      </section>

      {/* ══ 03 / ACCUMULATE — the real dashboard, bleeding into the page ═ */}
      <section className="mk-section mk-accumulate">
        <div className="pf2-grid">
          <SectionIndex num="03" title="Accumulate" id="accumulate" />
          <div className="mk-accumulate-head">
            <h2 className="u-h2">One prompt is hard to feel.<br />A week of them isn’t.</h2>
            <p className="u-body">
              This is the dashboard itself, not a screenshot of it — the same surface that opens
              from the extension, running here on sample data. Everything is clickable.
            </p>
          </div>
        </div>

        <DashboardSurface embedded />

        <div className="pf2-grid">
          <p className="mk-accumulate-foot u-micro">
            Sample data ·{' '}
            <Link to="/app">Open the dashboard full screen →</Link>
          </p>
        </div>
      </section>

      {/* ══ 04 / TRANSLATE ═════════════════════════════════════════════ */}
      <section className="mk-section mk-translate">
        <div className="pf2-grid">
          <SectionIndex num="04" title="Translate" id="translate" />

          <div className="mk-translate-head">
            <h2 className="u-h2">Tokens are abstract.<br />Resources aren’t.</h2>
          </div>

          <div className="mk-translate-copy">
            <p className="u-body">
              A token count tells you how much text moved. It does not tell you what running that
              text cost. PromptFootprint converts one into the other with a published, per-token
              model — so the number on the dashboard can be checked, argued with, and corrected.
            </p>
            <p className="u-body">
              The ChatGPT figures are derived top-down from OpenAI’s 2025 sustainability
              disclosure: annual energy, water, and carbon divided by an estimate of annual
              tokens. Claude has no published equivalent, so it is expressed as the same anchor
              scaled by {PER_1K.claude}× and labelled as an estimate wherever it appears.
            </p>
          </div>

          <div className="mk-translate-figures">
            <p className="u-micro mk-caption">Per 1,000 tokens · ChatGPT / GPT-4o anchor</p>
            <div className="pf2-strip">
              <div>
                <span className="pf2-cell-label">Est. energy</span>
                <span className="pf2-cell-value">{PER_1K.energyWh.toFixed(2)}<span className="pf2-cell-unit">Wh</span></span>
              </div>
              <div>
                <span className="pf2-cell-label">Est. water</span>
                <span className="pf2-cell-value">{PER_1K.waterMl.toFixed(2)}<span className="pf2-cell-unit">mL</span></span>
              </div>
              <div>
                <span className="pf2-cell-label">Est. CO₂</span>
                <span className="pf2-cell-value">{PER_1K.co2G.toFixed(3)}<span className="pf2-cell-unit">g</span></span>
              </div>
              <div>
                <span className="pf2-cell-label">Prompts stored</span>
                <span className="pf2-cell-value">0</span>
              </div>
            </div>

            <div className="mk-limits">
              <p className="u-micro u-micro-strong">What this model does not claim</p>
              <ul>
                <li>
                  These are estimates from published totals, not meter readings. The real figure
                  depends on the model that served the request, the data centre, and the grid
                  behind it.
                </li>
                <li>
                  Removing input tokens removes part of prefill, which is a minority of a short
                  interaction’s energy. A 20% shorter prompt is not a 20% smaller footprint, and
                  the dashboard never presents it as one.
                </li>
                <li>
                  A 2026 preprint over 28,421 trials found input compression can also lengthen
                  the response — enough that it is not a reliable energy optimization on its own.
                  PromptFootprint reports tokens removed, which is measured, and labels the
                  resource figure an equivalent.
                </li>
              </ul>
              <Link className="pf2-btn is-sm" to="/app/learn">Read the method</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ══ 05 / PRIVATE BY DESIGN ═════════════════════════════════════ */}
      <section className="mk-section mk-private">
        <div className="pf2-grid">
          <SectionIndex num="05" title="Private by design" id="private" />

          <div className="mk-private-copy">
            <h2 className="u-h2">Your prompt never leaves the page.</h2>
            <p className="u-body">
              PromptFootprint reads the text of your messages to measure their length and to run
              the local checks. It does not store that text, and it does not send it anywhere.
              The demo above follows the same rule: what you typed into it exists only in this
              tab’s memory.
            </p>
            <div className="mk-private-links">
              <Link className="pf2-btn is-sm" to="/privacy">Privacy Policy</Link>
              <Link className="pf2-btn is-sm" to="/terms">Terms of Use</Link>
            </div>
          </div>

          {/* The flow, drawn as a flow. Text, rules, and one crossed path — the
              diagram is the claim, and it matches what the code does. */}
          <figure className="mk-flow">
            <figcaption className="u-micro mk-caption">Where each piece goes</figcaption>
            <div className="mk-flow-body" role="img" aria-label="Data flow: your prompt stays in the browser. Token count, resource estimate, and local statistics are derived in the browser and stored on the device. Prompt text never reaches a server.">
              <p className="mk-flow-node is-source">Your prompt</p>
              <p className="mk-flow-arrow" aria-hidden="true">│</p>
              <p className="mk-flow-node is-hub">Browser</p>
              <ul className="mk-flow-branches">
                <li><span aria-hidden="true">├──</span> Token count</li>
                <li><span aria-hidden="true">├──</span> Resource estimate</li>
                <li><span aria-hidden="true">└──</span> Local statistics <em>· on this device</em></li>
              </ul>
              <p className="mk-flow-blocked">
                Prompt text <span className="mk-flow-x" aria-hidden="true">──✕──▶</span> Server
              </p>
            </div>
            <ul className="mk-flow-optional">
              <li>
                <span className="u-micro u-micro-strong">Account sync · optional, off</span>
                Numbers and settings only — never prompt or reply text.
              </li>
              <li>
                <span className="u-micro u-micro-strong">Heatwave estimate · optional, off</span>
                A coordinate rounded to about 11 km, used to look up local weather.
              </li>
              <li>
                <span className="u-micro u-micro-strong">AI writing help · optional, off</span>
                The only feature that sends a draft off the device, and only after you supply
                your own endpoint. Off by default, and not available on this site at all.
              </li>
            </ul>
          </figure>
        </div>
      </section>

      {/* ══ 06 / METHOD ════════════════════════════════════════════════ */}
      <section className="mk-section mk-method">
        <div className="pf2-grid">
          <SectionIndex num="06" title="Method" id="method" />

          <div className="mk-method-head">
            <h2 className="u-h2">Method</h2>
            <p className="u-micro">Estimator v2 · every figure traces to a source</p>
            <div className="mk-method-links">
              <Link className="pf2-btn" to="/app/learn">Read full method</Link>
              <a
                className="pf2-btn"
                href={`${SITE.githubUrl}/blob/main/METHODOLOGY.md`}
                target="_blank"
                rel="noopener noreferrer"
              >
                METHODOLOGY.md ↗
              </a>
            </div>
          </div>

          <dl className="mk-spec">
            <div>
              <dt className="u-micro u-micro-strong">Measured</dt>
              <dd>Token count per usage event, from text length · prompts and responses sent</dd>
            </div>
            <div>
              <dt className="u-micro u-micro-strong">Estimated</dt>
              <dd>Energy · water · CO₂, converted from that token count</dd>
            </div>
            <div>
              <dt className="u-micro u-micro-strong">Inputs</dt>
              <dd>
                OpenAI 2025 sustainability disclosure · Jegham et al., <em>How Hungry is AI?</em> ·
                Parasharami, token-level framework (Vanderbilt YSJ) · published PUE and grid figures
              </dd>
            </div>
            <div>
              <dt className="u-micro u-micro-strong">Stored</dt>
              <dd>Aggregate token counts, session times, realized savings — on your device</dd>
            </div>
            <div>
              <dt className="u-micro u-micro-strong">Not stored</dt>
              <dd>Prompt text · assistant response text · precise location · analytics of any kind</dd>
            </div>
            <div>
              <dt className="u-micro u-micro-strong">Reviewed</dt>
              <dd>
                Placed in {AWARDS.length} international competitions ·{' '}
                <Link to="/app/awards">see the record</Link>
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {/* ══ Close ══════════════════════════════════════════════════════ */}
      <section className="mk-close">
        <div className="pf2-grid">
          <div className="mk-close-inner">
            <h2 className="u-h1 mk-close-h">Use fewer tokens.<br />See the difference.</h2>
            <div className="mk-close-cta">
              <ChromeCTA />
              <a className="pf2-btn" href={SITE.githubUrl} target="_blank" rel="noopener noreferrer">
                <Github size={15} /> View source
              </a>
            </div>
            <p className="u-micro mk-close-spec">
              Free <span aria-hidden="true">/</span> Local-first <span aria-hidden="true">/</span> Open source
              <span aria-hidden="true">/</span> No account required
            </p>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
