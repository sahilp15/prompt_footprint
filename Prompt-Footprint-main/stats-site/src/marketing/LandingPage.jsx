import { useRef } from 'react'
import { motion as Motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { Link } from 'react-router-dom'
import {
  Droplets, Zap, Leaf, Gauge, PenLine, ShieldCheck, Thermometer,
  MousePointerClick, LineChart, Lock, Eye, ArrowRight, Check, Trophy,
  Globe2, Sparkles, ExternalLink,
} from 'lucide-react'
import { SITE, demoUrl } from '../config/site'
import { SiteNav, SiteFooter, ChromeCTA, Github } from './MarketingChrome'
import { useScrollToSection } from './useScrollToSection'
import { useCountUp, useReveal } from '../hooks/useMotion'
import { AWARDS, featuredAward } from '../data/awards'
import { REGIONS } from '../lib/regions'
import Globe from '../components/ui/globe-cdn'
import './marketing.css'

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
}

/**
 * Section entrance.
 *
 * `initial={false}` under reduced motion is what keeps the contract the rest
 * of the product follows: the element renders in its final state immediately
 * instead of waiting at opacity 0 for a scroll that may never come.
 */
function Reveal({ children, delay = 0, className }) {
  const reduced = useReducedMotion()
  return (
    <Motion.div
      className={className}
      variants={fadeUp}
      initial={reduced ? false : 'hidden'}
      whileInView="show"
      viewport={{ once: true, margin: '-60px' }}
      transition={{ delay }}
    >
      {children}
    </Motion.div>
  )
}

/* ── Content ──────────────────────────────────────────────────────────────── */

// Figures from the published model (see extension/lib/constants.js and
// METHODOLOGY.md). Rendered as counters so the numbers announce themselves.
const MODEL_FACTS = [
  { id: 'energy', value: 1.06, decimals: 2, unit: 'Wh', label: 'per 1,000 tokens', caption: 'Electricity, from OpenAI’s 2025 disclosure', hex: '#C17F24' },
  { id: 'water', value: 3.5, decimals: 1, unit: 'mL', label: 'per 1,000 tokens', caption: 'Fresh water evaporated for cooling', hex: '#2E6B8A' },
  { id: 'co2', value: 0.38, decimals: 2, unit: 'g', label: 'CO₂ per 1,000 tokens', caption: 'At a mid-range grid intensity', hex: '#8B7355' },
  { id: 'stored', value: 0, decimals: 0, unit: '', label: 'prompts stored', caption: 'Counting happens on your device', hex: '#5B7C3A' },
]

// Bento layout: `span` drives how many columns each card claims on desktop.
const FEATURES = [
  {
    icon: Gauge,
    span: 'wide',
    title: 'Per-prompt impact, live',
    body: 'A small overlay on ChatGPT and Claude shows the estimated energy, water, and CO₂ behind each message as you send it. No tab-switching, no setup.',
    accent: 'amber',
  },
  {
    icon: LineChart,
    title: 'A dashboard that adds up',
    body: 'Weekly trends, per-session breakdowns, and running totals. See how your usage changes over time instead of guessing.',
    accent: 'blue',
  },
  {
    icon: PenLine,
    title: 'Shorter prompts, fewer tokens',
    body: 'An offline writing checker cleans up drafts, and the optimizer suggests tighter phrasings, then totals the tokens you actually saved.',
    accent: 'green',
  },
  {
    icon: Thermometer,
    title: 'Heatwave-aware estimates',
    body: 'Cooling a data center costs more in hot weather. Opt in to a rough location and the estimate adjusts for local conditions, or stays a general figure.',
    accent: 'red',
  },
  {
    icon: Lock,
    span: 'wide',
    title: 'Private by default',
    body: 'Your prompts and the models’ replies are never stored or uploaded. Counting happens on your device; the text stays in your browser.',
    accent: 'green',
  },
  {
    icon: Leaf,
    title: 'Built to be understood',
    body: 'Every number traces back to public disclosures and published research. The method, and its limits, are documented, not hidden.',
    accent: 'green',
  },
]

const STEPS = [
  {
    icon: MousePointerClick,
    title: 'Add the extension',
    body: 'Install from the Chrome Web Store. No account, no sign-up, nothing to configure to get started.',
    aside: 'Works signed out, forever.',
  },
  {
    icon: Zap,
    title: 'Chat like you already do',
    body: 'Open ChatGPT or Claude. PromptFootprint counts tokens from your messages and estimates the footprint in the background.',
    aside: 'Only lengths are read — never the text.',
  },
  {
    icon: LineChart,
    title: 'Watch it add up',
    body: 'Check the overlay for the current session, or open the dashboard for weekly trends, savings, and where your footprint comes from.',
    aside: 'Then shrink it with the Token Cutter.',
  },
]

/* ── Pieces ───────────────────────────────────────────────────────────────── */

/** One counter in the model-facts band. Counts up when it scrolls into view. */
function FactTile({ fact, index }) {
  const [ref, visible] = useReveal({ threshold: 0.4 })
  const animated = useCountUp(fact.value, visible, { duration: 1000 + index * 120 })

  return (
    <div
      ref={ref}
      className={`mk-fact${visible ? ' is-visible' : ''}`}
      style={{ '--accent': fact.hex, '--reveal-delay': `${index * 80}ms` }}
    >
      <div className="mk-fact-value">
        <span className="mk-fact-number">{animated.toFixed(fact.decimals)}</span>
        {fact.unit && <span className="mk-fact-unit">{fact.unit}</span>}
      </div>
      <div className="mk-fact-label">{fact.label}</div>
      <div className="mk-fact-caption">{fact.caption}</div>
    </div>
  )
}

/**
 * A bento card that lights up under the pointer. The spotlight follows the
 * cursor through two CSS custom properties — no re-render, no state.
 */
function FeatureCard({ feature }) {
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`)
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`)
  }
  const Icon = feature.icon

  return (
    <article
      className={`mk-bento mk-bento-${feature.accent}${feature.span === 'wide' ? ' mk-bento-wide' : ''}`}
      onPointerMove={onMove}
    >
      <span className="mk-bento-spot" aria-hidden="true" />
      <span className="mk-card-icon"><Icon size={20} aria-hidden="true" /></span>
      <h3>{feature.title}</h3>
      <p>{feature.body}</p>
    </article>
  )
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function LandingPage() {
  const scrollTo = useScrollToSection()
  const reduced = useReducedMotion()
  const heroRef = useRef(null)
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] })

  // Gentle parallax: the copy drifts up a little faster than the globe, and
  // both fade as the hero leaves. Disabled outright under reduced motion.
  const copyY = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : -70])
  const globeY = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : -26])
  const heroFade = useTransform(scrollYProgress, [0, 0.85], [1, reduced ? 1 : 0.25])

  const featured = featuredAward()
  const totalCompetitors = AWARDS.reduce((n, a) => n + (a.participants || 0), 0)

  return (
    <div className="mk mk-landing">
      <SiteNav />

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="mk-hero" ref={heroRef}>
        <div className="mk-hero-glow" aria-hidden="true" />
        <div className="mk-grid-lines" aria-hidden="true" />

        <Motion.div className="mk-hero-inner" style={{ opacity: heroFade }}>
          <Motion.div
            initial={reduced ? false : 'hidden'}
            animate="show"
            variants={fadeUp}
            className="mk-hero-copy"
            style={{ y: copyY }}
          >
            <span className="mk-eyebrow">
              <Leaf size={14} /> For ChatGPT &amp; Claude
              <span className="mk-eyebrow-sep" aria-hidden="true" />
              <span className="mk-eyebrow-quiet">Chrome extension</span>
            </span>

            <h1 className="mk-h1">
              See the <span className="mk-underline">energy, water, and CO₂</span> behind every AI prompt.
            </h1>

            <p className="mk-lede">
              PromptFootprint estimates the environmental cost of your AI chats: live,
              on your device, and without ever storing what you type. Understand your
              footprint, then shrink it.
            </p>

            <div className="mk-hero-cta">
              <ChromeCTA size="lg" />
              <button type="button" className="btn btn-ghost btn-lg" onClick={() => scrollTo('demo')}>
                See the dashboard <ArrowRight size={18} />
              </button>
            </div>

            <ul className="mk-hero-trust">
              <li><Check size={15} /> Works without an account</li>
              <li><Check size={15} /> No prompts stored or uploaded</li>
              <li><Check size={15} /> Free &amp; open source</li>
            </ul>

            {featured && (
              <Link to="/app/awards" className="mk-hero-award">
                <Trophy size={14} aria-hidden="true" />
                <span><strong>{featured.placement}</strong> · {featured.event}</span>
                <ArrowRight size={13} aria-hidden="true" />
              </Link>
            )}
          </Motion.div>

          {/* The globe is the product's signature: eight major AI data-center
              regions, slowly turning, draggable. The overlay mock-up floats in
              front of it so the hero reads as depth rather than two columns. */}
          <Motion.div
            className="mk-hero-stage"
            style={{ y: globeY }}
            initial={reduced ? false : { opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
          >
            <span className="mk-stage-rings" aria-hidden="true" />
            <div className="mk-stage-globe">
              <Globe />
            </div>

            <Motion.div
              className="mk-capsule"
              initial={reduced ? false : { opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.45 }}
            >
              <div className="mk-capsule-head">
                <Droplets size={15} /> This session
                <span className="mk-live" aria-hidden="true"><i />live</span>
              </div>
              <div className="mk-capsule-grid">
                <div className="mk-metric mk-metric-amber">
                  <Zap size={15} /><span className="mk-metric-val">18.4</span><span className="mk-metric-unit">Wh</span>
                </div>
                <div className="mk-metric mk-metric-blue">
                  <Droplets size={15} /><span className="mk-metric-val">62</span><span className="mk-metric-unit">mL</span>
                </div>
                <div className="mk-metric mk-metric-green">
                  <Leaf size={15} /><span className="mk-metric-val">7.1</span><span className="mk-metric-unit">g CO₂</span>
                </div>
              </div>
              <div className="mk-capsule-foot">
                <span>≈ 3 min of a laptop</span>
                <span className="mk-capsule-tag">42 prompts today</span>
              </div>
            </Motion.div>

            <span className="mk-stage-caption">
              <Globe2 size={13} aria-hidden="true" />
              {REGIONS.length} major AI data-center regions · drag to spin
            </span>
          </Motion.div>
        </Motion.div>
      </section>

      {/* ── The model, in numbers ────────────────────────────── */}
      <section className="mk-facts">
        <div className="mk-facts-inner">
          <Reveal className="mk-facts-lead">
            <p>
              A single prompt looks weightless. Thousands of them aren’t.
              <span> Here is what the model actually counts.</span>
            </p>
          </Reveal>
          <div className="mk-facts-grid">
            {MODEL_FACTS.map((f, i) => <FactTile fact={f} index={i} key={f.id} />)}
          </div>
          <Reveal delay={0.1}>
            <p className="mk-facts-note">
              ChatGPT is the anchor, from OpenAI’s published sustainability figures;
              Claude is estimated 15% above it because Anthropic publishes none.{' '}
              <Link to="/app/learn">Read the methodology <ArrowRight size={13} /></Link>
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────── */}
      <section className="mk-section" id="features">
        <div className="mk-section-inner">
          <Reveal className="mk-section-head">
            <span className="mk-kicker">What it does</span>
            <h2 className="mk-h2">Everything runs where your data already is: in your browser.</h2>
          </Reveal>
          <div className="mk-bento-grid">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 0.05} className={f.span === 'wide' ? 'mk-bento-cell mk-bento-cell-wide' : 'mk-bento-cell'}>
                <FeatureCard feature={f} />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────── */}
      <section className="mk-section mk-section-alt" id="how">
        <div className="mk-section-inner">
          <Reveal className="mk-section-head">
            <span className="mk-kicker">How it works</span>
            <h2 className="mk-h2">Three steps. No dashboards to wire up.</h2>
          </Reveal>
          <ol className="mk-steps">
            {STEPS.map((s, i) => {
              const Icon = s.icon
              return (
                <Motion.li
                  key={s.title}
                  className="mk-step"
                  variants={fadeUp}
                  initial={reduced ? false : 'hidden'}
                  whileInView="show"
                  viewport={{ once: true, margin: '-60px' }}
                  transition={{ delay: i * 0.08 }}
                >
                  <span className="mk-step-rail" aria-hidden="true" />
                  <div className="mk-step-num"><span>{i + 1}</span></div>
                  <span className="mk-card-icon"><Icon size={20} aria-hidden="true" /></span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                  <p className="mk-step-aside">{s.aside}</p>
                </Motion.li>
              )
            })}
          </ol>
        </div>
      </section>

      {/* ── Live demo embed ──────────────────────────────────── */}
      <section className="mk-section" id="demo">
        <div className="mk-section-inner">
          <Reveal className="mk-section-head">
            <span className="mk-kicker">See it in action</span>
            <h2 className="mk-h2">The dashboard, running on sample data.</h2>
            <p className="mk-section-sub">
              This is the real PromptFootprint dashboard, the same one that opens from
              the extension, loaded with example data so you can click around before you install.
            </p>
          </Reveal>
          <Reveal delay={0.05}>
            <div className="mk-demo">
              <div className="mk-demo-chrome">
                <span className="mk-dot-r" /><span className="mk-dot-y" /><span className="mk-dot-g" />
                <span className="mk-demo-url">{SITE.url.replace('https://', '')}/#/app</span>
                <span className="mk-demo-badge">Live demo · sample data</span>
              </div>
              <div className="mk-demo-frame">
                <iframe
                  title="PromptFootprint dashboard live demo"
                  src={demoUrl()}
                  loading="lazy"
                />
              </div>
            </div>
            <p className="mk-demo-note">
              Prefer full screen?{' '}
              <Link to="/app">Open the demo in its own tab <ArrowRight size={14} /></Link>
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── Privacy & trust ──────────────────────────────────── */}
      <section className="mk-section mk-section-alt" id="privacy">
        <div className="mk-section-inner mk-trust">
          <Reveal className="mk-trust-copy">
            <span className="mk-kicker">Privacy &amp; trust</span>
            <h2 className="mk-h2">The honest default is on-device.</h2>
            <p>
              PromptFootprint was built local-first on purpose. The text of your prompts
              and the models’ answers is read only to count its length. It is never
              written to storage and never leaves your browser.
            </p>
            <ul className="mk-check-list">
              <li><ShieldCheck size={17} /> No prompts or replies stored or uploaded</li>
              <li><Eye size={17} /> No analytics, no telemetry, no third-party trackers</li>
              <li><Lock size={17} /> Optional features (AI writing help, sync, location) are off until you turn them on</li>
              <li><Check size={17} /> Accounts are optional: the extension works fully signed out</li>
            </ul>
            <div className="mk-trust-links">
              <Link to="/privacy" className="btn btn-ghost btn-sm">Read the Privacy Policy</Link>
              <Link to="/terms" className="btn btn-ghost btn-sm">Terms of Use</Link>
            </div>
          </Reveal>
          <Reveal delay={0.08} className="mk-trust-aside">
            <div className="mk-quote-card">
              <span className="mk-quote-mark" aria-hidden="true">“</span>
              <p className="mk-quote">
                Everything works on your device by default, and your prompts and the
                models’ replies are never stored or uploaded.
              </p>
              <p className="mk-quote-src">From the PromptFootprint Privacy Policy</p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Recognition ──────────────────────────────────────── */}
      <section className="mk-section mk-awards-section">
        <div className="mk-section-inner">
          <Reveal className="mk-awards">
            <div className="mk-awards-copy">
              <span className="mk-kicker">Recognition</span>
              <h2 className="mk-h2">Judged in international competition.</h2>
              <p>
                PromptFootprint has placed in {AWARDS.length} international competitions,
                against a combined field of more than {totalCompetitors.toLocaleString()} entrants —
                for making the hidden cost of everyday AI use visible, and reproducible.
              </p>
              <Link to="/app/awards" className="btn btn-ghost btn-sm">
                See the recognition <ArrowRight size={15} />
              </Link>
            </div>
            <ul className="mk-awards-list">
              {[...AWARDS].sort((a, b) => a.rank - b.rank).map((a) => (
                <li className="mk-award" key={a.id}>
                  <span className="mk-award-rank">{a.placement.split(' ')[0]}</span>
                  <span className="mk-award-body">
                    <span className="mk-award-event">{a.event}</span>
                    <span className="mk-award-scope">{a.scope}</span>
                  </span>
                  <a className="mk-award-link" href={a.href} target="_blank" rel="noopener noreferrer" aria-label={`${a.event} on Devpost`}>
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────── */}
      <section className="mk-section mk-final-section">
        <div className="mk-section-inner">
          <Reveal>
            <div className="mk-final">
              <span className="mk-final-glow" aria-hidden="true" />
              <span className="mk-eyebrow mk-eyebrow-center">
                <Sparkles size={13} /> Thirty seconds to install
              </span>
              <h2 className="mk-h2">Start seeing your AI footprint today.</h2>
              <p>Free, private, and it starts counting the moment you open a chat.</p>
              <div className="mk-hero-cta mk-center">
                <ChromeCTA size="lg" />
                <a className="btn btn-ghost btn-lg" href={SITE.githubUrl} target="_blank" rel="noopener noreferrer">
                  <Github size={18} /> View on GitHub
                </a>
              </div>
              <p className="mk-final-note">
                Download now and take your first steps to a cleaner future!
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
