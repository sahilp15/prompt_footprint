import { Link } from 'react-router-dom'
import { ArrowRight, ArrowDown } from 'lucide-react'
import { SITE, demoUrl } from '../config/site'
import { SiteNav, SiteFooter, ChromeCTA, ArrowLink } from './MarketingChrome'
import { useScrollToSection, useScrollTopOnRoute } from './useScrollToSection'
import { useCountUp, useReveal } from '../hooks/useMotion'
import { AWARDS, MILESTONES, RESEARCH, featuredAward, countWord } from '../data/awards'
import { REGIONS } from '../lib/regions'
import CutSpecimen from './CutSpecimen'
import { AwardRows, ResearchFeature, Rise } from './Recognition'
import './theme.css'
import './marketing.css'
import './recognition.css'

/* ── Content ──────────────────────────────────────────────────────────────── */

// The GPT-4o anchor from the published model (extension/lib/constants.js,
// METHODOLOGY.md). The extension reports a range per detected model; these are
// the reference figures that range is built around.
const MODEL_FACTS = [
  { id: 'energy', value: '1.06', unit: 'Wh', label: 'Electricity', note: 'From OpenAI’s 2025 disclosure', tone: 'energy' },
  { id: 'water', value: '3.5', unit: 'mL', label: 'Cooling water', note: 'Fresh water evaporated on site and at the power plant', tone: 'water' },
  { id: 'co2', value: '0.38', unit: 'g', label: 'CO₂e', note: 'At a mid-range grid intensity', tone: 'carbon' },
]

const FEATURES = [
  {
    title: 'An overlay that stays out of the way',
    body: 'A small, draggable readout on ChatGPT and Claude shows the estimated energy, water, and CO₂ behind each exchange as it happens.',
  },
  {
    title: 'The Token Cutter',
    body: 'Before you send, it suggests a leaner version of your draft — filler, hedges, repeated asks — and checks that every requirement survived the cut.',
  },
  {
    title: 'Estimates that know the model',
    body: 'It reads which model is selected and reports a range with the class of evidence behind it, instead of one confident-looking number.',
  },
  {
    title: 'A dashboard that adds up',
    body: 'Weekly trends, per-session breakdowns, and the input tokens you’ve avoided, so the habit is visible over time — not just per message.',
  },
  {
    title: 'Offline writing checks',
    body: 'Spelling, grammar, and clarity checks run on a bundled dictionary. Nothing is uploaded to check your draft.',
  },
  {
    title: 'Heat-aware, if you want it',
    body: 'Cooling costs more in hot weather. Share a rough location and the estimate adjusts for local conditions; skip it and you get the general figure.',
  },
]

const STEPS = [
  { title: 'Install', body: 'Add PromptFootprint from the Chrome Web Store. No account, no setup.' },
  { title: 'Chat as usual', body: 'Open ChatGPT or Claude. Tokens are counted in your browser, and each exchange gets an estimate.' },
  { title: 'Trim before you send', body: 'The Token Cutter offers a shorter draft. Accept the edits you agree with, ignore the rest.' },
  { title: 'Watch the habit change', body: 'The dashboard shows where your footprint comes from and how it moves week to week.' },
]

// Dirtiest grid first, so the chart reads as a ranking.
const byIntensity = [...REGIONS].sort((a, b) => b.intensity - a.intensity)

/* ── Pieces ───────────────────────────────────────────────────────────────── */

function SectionLabel({ n, children }) {
  return (
    <p className="lp-label">
      <span className="lp-label-n">{n}</span>
      <span className="lp-label-rule" aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

/** One figure in the credibility strip. Counts up once, on first view. */
function Milestone({ value, suffix = '', label, note, index }) {
  const [ref, visible] = useReveal({ threshold: 0.5 })
  const n = useCountUp(value, visible, { duration: 900 + index * 150 })
  return (
    <div ref={ref} className="lp-mile">
      <p className="lp-mile-num">
        <span className="tabular">{Math.round(n)}</span>{suffix}
        {note && <sup aria-hidden="true">*</sup>}
      </p>
      <p className="lp-mile-label">{label}</p>
    </div>
  )
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function LandingPage() {
  useScrollTopOnRoute()
  const scrollTo = useScrollToSection()
  const featured = featuredAward()

  return (
    <div className="mk mk-landing">
      <SiteNav />

      <main id="main" tabIndex={-1}>
        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="lp-hero" id="top" aria-labelledby="lp-hero-title">
          <div className="lp-wrap lp-hero-grid">
            <div className="lp-hero-copy">
              <p className="mk-overline">
                <span className="lp-pulse" aria-hidden="true" />
                Chrome extension for ChatGPT and Claude
              </p>
              <h1 id="lp-hero-title" className="lp-display">
                <span>Better prompts.</span>{' '}
                <em>Smaller footprints.</em>
              </h1>
              <p className="lp-lede">
                Reduce wasted tokens, understand your AI’s estimated environmental
                impact, and make every interaction more efficient.
              </p>
              <div className="lp-cta">
                <ChromeCTA size="lg" />
                <a
                  className="btn btn-quiet btn-lg"
                  href="#how"
                  onClick={(e) => { e.preventDefault(); scrollTo('how') }}
                >
                  Explore How It Works <ArrowDown className="btn-arrow-down" size={16} aria-hidden="true" />
                </a>
              </div>

              <ul className="lp-proof" aria-label="Milestones">
                <li><Link to="/recognition">{featured.placement} — {featured.event}</Link></li>
                <li>{MILESTONES.downloads}+ Chrome downloads</li>
                <li>
                  <a href={RESEARCH.href} target="_blank" rel="noopener noreferrer">
                    Research published in {RESEARCH.publisher}’s {RESEARCH.journal}
                  </a>
                </li>
              </ul>
            </div>

            <figure className="lp-hero-fig">
              <CutSpecimen />
              <figcaption>
                <span className="lp-fig-n">Fig. 1</span>
                The extension’s Token Cutter, running live in this page on sample drafts.
                Figures cover input tokens only; replies usually cost more.
              </figcaption>
            </figure>
          </div>
        </section>

        {/* ── Credibility strip ────────────────────────────────── */}
        <section className="lp-strip" aria-label="PromptFootprint in numbers">
          <div className="lp-wrap">
            <div className="lp-strip-row">
              <Milestone index={0} value={MILESTONES.downloads} suffix="+" label={MILESTONES.downloadsLabel} />
              <Milestone index={1} value={MILESTONES.recognitions} label="Hackathon recognitions" />
              <Milestone index={2} value={RESEARCH.result.reductionPct} suffix="%" note label="Fewer tokens in preliminary testing" />
            </div>
            <p className="lp-strip-note">
              * Total session tokens fell from about {RESEARCH.result.tokensBefore.toLocaleString()} to{' '}
              {RESEARCH.result.tokensAfter.toLocaleString()} in the study’s preliminary test. Results will vary.
            </p>
          </div>
        </section>

        {/* ── 01 · Why ─────────────────────────────────────────── */}
        <section className="lp-section" id="why" aria-labelledby="lp-why-title">
          <div className="lp-wrap lp-why">
            <Rise className="lp-why-copy">
              <SectionLabel n="01">Why PromptFootprint</SectionLabel>
              <h2 id="lp-why-title" className="lp-h2">
                Every token you send is work a data center <em>still has to do.</em>
              </h2>
              <div className="lp-prose">
                <p>
                  A language model processes every token in your prompt and every token
                  it writes back. Greetings, hedges, pasted context, and regenerated
                  answers all add tokens — and each one carries an estimated cost in
                  electricity, cooling water, and carbon.
                </p>
                <p>
                  One prompt is tiny. The habit, repeated every day, is not. PromptFootprint
                  makes that cost visible where you write, then helps you spend less of it.
                </p>
              </div>

              <table className="lp-table">
                <caption>
                  <span className="lp-fig-n">Table 1</span>
                  Reference estimate per 1,000 tokens (GPT-4o anchor)
                </caption>
                <tbody>
                  {MODEL_FACTS.map((f) => (
                    <tr key={f.id}>
                      <th scope="row">{f.label}</th>
                      <td className={`lp-table-val is-${f.tone}`}>{f.value}<span> {f.unit}</span></td>
                      <td className="lp-table-note">{f.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="lp-small">
                Estimates, not meter readings — no provider publishes per-prompt telemetry.{' '}
                <ArrowLink to="/app/learn">Read the methodology</ArrowLink>
              </p>
            </Rise>

            <Rise as="figure" className="lp-grid-fig" delay={120}>
              <p className="lp-grid-fig-head">
                <span>Region</span><span>gCO₂e / kWh</span>
              </p>
              <ol className="lp-regions">
                {byIntensity.map((r) => (
                  <li key={r.id}>
                    <span className="lp-regions-name">{r.label}</span>
                    <span className="lp-regions-bar" aria-hidden="true">
                      <span style={{ '--w': `${(r.intensity / byIntensity[0].intensity) * 100}%` }} />
                    </span>
                    <span className="lp-regions-val">{r.intensity}</span>
                  </li>
                ))}
              </ol>
              <figcaption>
                <span className="lp-fig-n">Fig. 2</span>
                The same token costs a different amount of carbon depending on the grid
                behind it. Approximate annual grid intensity in {REGIONS.length} regions that
                host much of today’s AI inference capacity. Illustrative — no prompt is
                traced to a location.
              </figcaption>
            </Rise>
          </div>
        </section>

        {/* ── 02 · Product ─────────────────────────────────────── */}
        <section className="lp-section lp-section-sunk" id="product" aria-labelledby="lp-product-title">
          <div className="lp-wrap">
            <Rise className="lp-split-head">
              <div>
                <SectionLabel n="02">The product</SectionLabel>
                <h2 id="lp-product-title" className="lp-h2">
                  It lives where you already type.
                </h2>
              </div>
              <p className="lp-sub">
                Everything below runs inside your browser, on the chat page you already
                use. There is no separate app to remember to open.
              </p>
            </Rise>

            <ol className="lp-features">
              {FEATURES.map((f, i) => (
                <Rise as="li" key={f.title} className="lp-feature" delay={(i % 3) * 70}>
                  <span className="lp-feature-n" aria-hidden="true">{String.fromCharCode(97 + i)}.</span>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </Rise>
              ))}
            </ol>

            <Rise as="figure" className="lp-demo">
              <div className="lp-demo-bar">
                <span className="lp-demo-dots" aria-hidden="true"><i /><i /><i /></span>
                <span className="lp-demo-url">{SITE.url.replace('https://', '')}/#/app</span>
                <span className="lp-demo-tag">Sample data</span>
              </div>
              <div className="lp-demo-frame">
                <iframe title="PromptFootprint dashboard, live demo with sample data" src={demoUrl()} loading="lazy" />
              </div>
              <figcaption>
                <span className="lp-fig-n">Fig. 3</span>
                The real dashboard — the one the extension opens — loaded with example data.{' '}
                <ArrowLink to="/app">Open it full screen</ArrowLink>
              </figcaption>
            </Rise>
          </div>
        </section>

        {/* ── 03 · How it works ────────────────────────────────── */}
        <section className="lp-section" id="how" aria-labelledby="lp-how-title">
          <div className="lp-wrap">
            <Rise className="lp-how-head">
              <SectionLabel n="03">How it works</SectionLabel>
              <h2 id="lp-how-title" className="lp-h2">From install to a leaner habit, in four steps.</h2>
            </Rise>
            <ol className="lp-steps">
              {STEPS.map((s, i) => (
                <Rise as="li" key={s.title} className="lp-step" delay={i * 90}>
                  <span className="lp-step-n" aria-hidden="true">{i + 1}</span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </Rise>
              ))}
            </ol>
          </div>
        </section>

        {/* ── 04 · Research ────────────────────────────────────── */}
        <div className="lp-section lp-section-rule">
          <div className="lp-wrap">
            <SectionLabel n="04">Research</SectionLabel>
            <ResearchFeature id="research" overline={false} />
          </div>
        </div>

        {/* ── 05 · Recognition ─────────────────────────────────── */}
        <section className="lp-section lp-section-sunk" id="recognition" aria-labelledby="lp-rec-title">
          <div className="lp-wrap lp-rec">
            <Rise className="lp-rec-copy">
              <SectionLabel n="05">Recognition</SectionLabel>
              <h2 id="lp-rec-title" className="lp-h2">
                Recognized by {countWord(AWARDS.length).toLowerCase()} international hackathons <em>in a single season.</em>
              </h2>
              <p className="lp-sub">
                Most recently, second place overall at {featured.event}, against a field
                of more than 1,000 registered participants.
              </p>
              <p className="lp-rec-link"><ArrowLink to="/recognition">See the full recognition</ArrowLink></p>
            </Rise>
            <Rise delay={100}>
              <AwardRows />
            </Rise>
          </div>
        </section>

        {/* ── 06 · Privacy ─────────────────────────────────────── */}
        <section className="lp-section" id="privacy" aria-labelledby="lp-privacy-title">
          <div className="lp-wrap">
            <Rise className="lp-split-head">
              <div>
                <SectionLabel n="06">Privacy &amp; transparency</SectionLabel>
                <h2 id="lp-privacy-title" className="lp-h2">On-device by default. Anything else, you switch on.</h2>
              </div>
              <p className="lp-sub">
                This is how the extension behaves today, as set out in the Privacy Policy.
                Nothing in the right-hand column happens until you turn it on.
              </p>
            </Rise>

            <div className="lp-privacy">
              <Rise className="lp-privacy-col">
                <h3>Always stays in your browser</h3>
                <ul>
                  <li>The text of your prompts and the models’ replies — read in the page to count and check it, never stored or uploaded.</li>
                  <li>Token counts, timings, and estimates, kept in the extension’s local storage.</li>
                  <li>The Token Cutter and the spelling and grammar checks, which run offline.</li>
                  <li>Your usage. There are no analytics, telemetry, or third-party trackers.</li>
                </ul>
              </Rise>
              <Rise className="lp-privacy-col is-optin" delay={100}>
                <h3>Leaves only if you turn it on</h3>
                <dl>
                  <div>
                    <dt>AI writing help</dt>
                    <dd>Sends the draft you are typing to a Gemini proxy you configure. Off until you enable it and add the proxy URL.</dd>
                  </div>
                  <div>
                    <dt>Account sync</dt>
                    <dd>Syncs settings and numbers-only session summaries. Never prompt or reply text.</dd>
                  </div>
                  <div>
                    <dt>Heat-aware estimate</dt>
                    <dd>Sends a rounded location (about 11 km) or the city you type to Open-Meteo for weather.</dd>
                  </div>
                </dl>
              </Rise>
            </div>
            <p className="lp-privacy-links">
              <ArrowLink to="/privacy">Read the Privacy Policy</ArrowLink>
              <ArrowLink to="/terms">Terms of Use</ArrowLink>
            </p>
          </div>
        </section>

        {/* ── Final CTA ────────────────────────────────────────── */}
        <section className="lp-final" aria-labelledby="lp-final-title">
          <div className="lp-wrap lp-final-grid">
            <Rise>
              <h2 id="lp-final-title" className="lp-final-title">
                Start with your next prompt.
              </h2>
              <p className="lp-final-text">
                Free, open source, and private by default. Install it, open a chat, and
                see what your AI use actually costs — then make it smaller.
              </p>
            </Rise>
            <Rise className="lp-final-cta" delay={100}>
              <ChromeCTA size="lg" />
              <Link className="lp-final-link" to="/app">
                Or try the live demo first <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </Rise>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
