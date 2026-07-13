import { motion as Motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import {
  Droplets, Zap, Leaf, Gauge, PenLine, ShieldCheck, Thermometer,
  MousePointerClick, LineChart, Lock, Eye, ArrowRight, Check,
} from 'lucide-react'
import { SITE, demoUrl } from '../config/site'
import { SiteNav, SiteFooter, ChromeCTA, Github } from './MarketingChrome'
import { useScrollToSection } from './useScrollToSection'
import './marketing.css'

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
}

function Reveal({ children, delay = 0, className }) {
  return (
    <Motion.div
      className={className}
      variants={fadeUp}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-60px' }}
      transition={{ delay }}
    >
      {children}
    </Motion.div>
  )
}

const FEATURES = [
  {
    icon: Gauge,
    title: 'Per-prompt impact, live',
    body: 'A small overlay on ChatGPT and Claude shows the estimated energy, water, and CO₂ behind each message as you send it. No tab-switching, no setup.',
  },
  {
    icon: LineChart,
    title: 'A dashboard that adds up',
    body: 'Weekly trends, per-session breakdowns, and running totals. See how your usage changes over time instead of guessing.',
  },
  {
    icon: PenLine,
    title: 'Shorter prompts, fewer tokens',
    body: 'An offline writing checker cleans up drafts, and the optimizer suggests tighter phrasings, then totals the tokens you actually saved.',
  },
  {
    icon: Thermometer,
    title: 'Heatwave-aware estimates',
    body: 'Cooling a data center costs more in hot weather. Opt in to a rough location and the estimate adjusts for local conditions, or stays a general figure.',
  },
  {
    icon: Lock,
    title: 'Private by default',
    body: 'Your prompts and the models’ replies are never stored or uploaded. Counting happens on your device; the text stays in your browser.',
  },
  {
    icon: Leaf,
    title: 'Built to be understood',
    body: 'Every number traces back to public disclosures and published research. The method, and its limits, are documented, not hidden.',
  },
]

const STEPS = [
  {
    icon: MousePointerClick,
    title: 'Add the extension',
    body: 'Install from the Chrome Web Store. No account, no sign-up, nothing to configure to get started.',
  },
  {
    icon: Zap,
    title: 'Chat like you already do',
    body: 'Open ChatGPT or Claude. PromptFootprint counts tokens from your messages and estimates the footprint in the background.',
  },
  {
    icon: LineChart,
    title: 'Watch it add up',
    body: 'Check the overlay for the current session, or open the dashboard for weekly trends, savings, and where your footprint comes from.',
  },
]

export default function LandingPage() {
  const scrollTo = useScrollToSection()
  return (
    <div className="mk mk-landing">
      <SiteNav />

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="mk-hero">
        <div className="mk-hero-glow" aria-hidden="true" />
        <div className="mk-hero-inner">
          <Motion.div initial="hidden" animate="show" variants={fadeUp} className="mk-hero-copy">
            <span className="mk-eyebrow">
              <Leaf size={14} /> For ChatGPT &amp; Claude
            </span>
            <h1 className="mk-h1">
              See the <span className="mk-underline">energy, water, and CO₂</span> behind every AI prompt.
            </h1>
            <p className="mk-lede">
              PromptFootprint is a Chrome extension that estimates the environmental
              cost of your AI chats: live, on your device, and without ever storing
              what you type. Understand your footprint, then shrink it.
            </p>
            <div className="mk-hero-cta">
              <ChromeCTA size="lg" />
              <button
                type="button"
                className="btn btn-ghost btn-lg"
                onClick={() => scrollTo('demo')}
              >
                See the dashboard <ArrowRight size={18} />
              </button>
            </div>
            <ul className="mk-hero-trust">
              <li><Check size={15} /> Works without an account</li>
              <li><Check size={15} /> No prompts stored or uploaded</li>
              <li><Check size={15} /> Free &amp; open source</li>
            </ul>
          </Motion.div>

          <Motion.div
            className="mk-hero-card"
            initial={{ opacity: 0, y: 24, rotate: -1 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
          >
            <div className="mk-capsule">
              <div className="mk-capsule-head">
                <Droplets size={16} /> This session
              </div>
              <div className="mk-capsule-grid">
                <div className="mk-metric mk-metric-amber">
                  <Zap size={16} /><span className="mk-metric-val">18.4</span><span className="mk-metric-unit">Wh</span>
                </div>
                <div className="mk-metric mk-metric-blue">
                  <Droplets size={16} /><span className="mk-metric-val">62</span><span className="mk-metric-unit">mL water</span>
                </div>
                <div className="mk-metric mk-metric-green">
                  <Leaf size={16} /><span className="mk-metric-val">7.1</span><span className="mk-metric-unit">g CO₂</span>
                </div>
              </div>
              <div className="mk-capsule-foot">
                <span>≈ 3 min of a laptop</span>
                <span className="mk-capsule-tag">42 prompts today</span>
              </div>
            </div>
            <p className="mk-hero-card-note">A live look at the on-page overlay</p>
          </Motion.div>
        </div>
      </section>

      {/* ── Why it matters ───────────────────────────────────── */}
      <section className="mk-band">
        <div className="mk-band-inner">
          <Reveal>
            <p className="mk-band-lead">
              A single prompt looks weightless. Thousands of them aren’t. PromptFootprint
              turns an invisible cost into a number you can actually see, so efficiency
              stops being abstract.
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
          <div className="mk-grid">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 0.05}>
                <article className="mk-card">
                  <span className="mk-card-icon"><f.icon size={20} /></span>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </article>
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
          <div className="mk-steps">
            {STEPS.map((s, i) => (
              <Reveal key={s.title} delay={i * 0.08}>
                <div className="mk-step">
                  <div className="mk-step-num">{i + 1}</div>
                  <span className="mk-card-icon"><s.icon size={20} /></span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
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
              <p className="mk-quote">
                “Everything works on your device by default, and your prompts and the
                models’ replies are never stored or uploaded.”
              </p>
              <p className="mk-quote-src">From the PromptFootprint Privacy Policy</p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────── */}
      <section className="mk-section">
        <div className="mk-section-inner">
          <Reveal>
            <div className="mk-final">
              <h2 className="mk-h2">Start seeing your AI footprint today.</h2>
              <p>Free, private, and takes about thirty seconds to install.</p>
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
