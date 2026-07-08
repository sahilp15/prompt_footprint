import { Link } from 'react-router-dom'
import { Mail, ShieldCheck, ArrowLeft, LifeBuoy, CheckCircle2 } from 'lucide-react'
import { SITE } from '../config/site'
import { MarketingPage, Github } from './MarketingChrome'
import './marketing.css'

function DocHeader({ kicker, title, updated, children }) {
  return (
    <header className="mk-doc-head">
      <Link to="/" className="mk-doc-back"><ArrowLeft size={15} /> Back to home</Link>
      <span className="mk-kicker">{kicker}</span>
      <h1 className="mk-h1 mk-doc-h1">{title}</h1>
      {updated && <p className="mk-doc-updated">Last updated: {updated}</p>}
      {children}
    </header>
  )
}

// A small, clearly-marked banner for content that still needs finalizing.
function Placeholder({ children }) {
  return <div className="mk-placeholder"><strong>TODO before launch:</strong> {children}</div>
}

// ── Privacy ───────────────────────────────────────────────────────────────
// Mirrors the plain-language summary in docs/PRIVACY.md (the canonical, fuller
// version). Kept in sync manually; update both if data practices change.
export function Privacy() {
  return (
    <MarketingPage>
      <DocHeader kicker="Trust" title="Privacy Policy" updated="2026-07-03">
        <p className="mk-doc-intro">
          The short version: <strong>everything works on your device by default, and
          your prompts and the models’ replies are never stored or uploaded.</strong> A
          few features can send data off the device, but only ones you turn on
          yourself, and this page spells out each one.
        </p>
      </DocHeader>

      <div className="mk-note">
        This is a plain-language policy written by the project, not formal legal advice.
      </div>
      <Placeholder>
        Have a lawyer review this before relying on it commercially, and confirm the
        contact address below is a live inbox. The authoritative, always-current text
        lives in <code>docs/PRIVACY.md</code> in the repository.
      </Placeholder>

      <section className="mk-doc-body">
        <h2>What PromptFootprint does with data</h2>
        <p>
          It watches your messages on ChatGPT and Claude, counts tokens from text
          length, and estimates the energy, water, and CO₂ behind them. By default
          there is <strong>no server</strong>: token counts, settings, and realized
          savings live in your browser’s local extension storage and do not leave your
          device.
        </p>

        <h2>What is never stored</h2>
        <p>
          The text of your prompts and the models’ responses is <strong>not stored</strong>{' '}
          and <strong>not uploaded</strong>. The extension reads that text in the page
          only to measure its length and run local spell-checks.
        </p>

        <h2>Optional features that can send data (all off by default)</h2>
        <ul>
          <li>
            <strong>AI writing help (Gemini).</strong> Disabled until you both enable
            cloud analysis and provide your own proxy URL. Only your in-progress draft
            is sent, and only then.
          </li>
          <li>
            <strong>Accounts &amp; sync (Supabase).</strong> Optional. Syncs numbers-only
            summaries and settings (never prompt or reply text), protected by
            row-level security so only your account can read them.
          </li>
          <li>
            <strong>Heatwave estimate.</strong> Optional. If you opt in, a rounded
            (~11 km) coordinate is used to look up weather from Open-Meteo. Your exact
            location is never used or stored.
          </li>
        </ul>

        <h2>No analytics or telemetry</h2>
        <p>
          There are no analytics or telemetry SDKs: no Google Analytics, Mixpanel,
          Sentry, or similar. The extension does not phone home.
        </p>

        <h2>Deleting your data</h2>
        <p>
          Uninstalling the extension removes all on-device data. If you created an
          account, use “Delete account” on the dashboard, or email us.
        </p>

        <h2>Contact</h2>
        <p>
          Privacy questions: <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>{' '}
          (placeholder, activate this alias before launch), or open an issue on{' '}
          <a href={SITE.issuesUrl} target="_blank" rel="noopener noreferrer">GitHub</a>.
        </p>
      </section>
    </MarketingPage>
  )
}

// ── Terms ─────────────────────────────────────────────────────────────────
export function Terms() {
  return (
    <MarketingPage>
      <DocHeader kicker="Trust" title="Terms of Use" updated="2026-07-01">
        <p className="mk-doc-intro">
          Short and plain, on purpose. By installing or using PromptFootprint, you agree
          to the following.
        </p>
      </DocHeader>

      <section className="mk-doc-body">
        <h2>1. What PromptFootprint is</h2>
        <p>
          A free browser extension that estimates the environmental impact of your AI
          chat usage, checks your writing, and suggests shorter prompts.
        </p>

        <h2>2. The estimates are estimates</h2>
        <p>
          The energy, water, and CO₂ figures are approximations derived from public
          disclosures and published research, not direct measurements of your specific
          requests. They’re meant to build intuition, not to be treated as audited or
          authoritative.
        </p>

        <h2>3. Accounts are optional</h2>
        <p>
          You can use PromptFootprint without an account. If you create one, provide a
          valid email, keep your password secure, and you’re responsible for activity
          under it. You can delete your account at any time. We may suspend accounts
          that abuse the service.
        </p>

        <h2>4. No warranty</h2>
        <p>
          PromptFootprint is provided “as is.” It’s a tool for awareness, not a
          compliance or reporting instrument, and we don’t guarantee it’s error-free or
          available at all times.
        </p>

        <h2>5. Limitation of liability</h2>
        <p>
          To the extent allowed by law, PromptFootprint isn’t liable for indirect,
          incidental, or consequential damages arising from your use of the extension.
          Use your own judgment, especially for anything beyond casual, personal use.
        </p>

        <h2>6. Changes to these terms</h2>
        <p>
          We may update these terms as the product changes. We’ll update the date above
          when we do. Continuing to use PromptFootprint after a change means you accept
          the updated terms.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about these terms:{' '}
          <a href={`mailto:${SITE.legalEmail}`}>{SITE.legalEmail}</a>.
        </p>
      </section>
    </MarketingPage>
  )
}

// ── Support ───────────────────────────────────────────────────────────────
const FAQ = [
  {
    q: 'Is PromptFootprint free?',
    a: 'Yes. The extension is free and open source. There’s no paid tier.',
  },
  {
    q: 'Do I need an account?',
    a: 'No. Everything works signed out and on-device. An optional account only adds cross-device sync of numbers-only summaries.',
  },
  {
    q: 'Which sites does it work on?',
    a: 'ChatGPT (chatgpt.com, chat.openai.com) and Claude (claude.ai). More platforms may follow.',
  },
  {
    q: 'How accurate are the numbers?',
    a: 'They’re careful estimates from public data and research, not measurements of your exact requests. See “How it works” in the dashboard for the method and its limits.',
  },
  {
    q: 'Where does my data go?',
    a: 'Nowhere, by default. Your prompts are never stored or uploaded. Optional features that send data are off until you enable them.',
  },
]

export function Support() {
  return (
    <MarketingPage>
      <DocHeader kicker="Support" title="Help & FAQ">
        <p className="mk-doc-intro">
          Questions, bugs, or ideas: here’s how to reach us and the answers to the
          things people ask most.
        </p>
      </DocHeader>

      <div className="mk-support-cards">
        <a className="mk-support-card" href={SITE.issuesUrl} target="_blank" rel="noopener noreferrer">
          <span className="mk-card-icon"><Github size={20} /></span>
          <h3>Report a bug or request a feature</h3>
          <p>Open an issue on GitHub, the fastest way to get something looked at.</p>
        </a>
        <a className="mk-support-card" href={`mailto:${SITE.supportEmail}`}>
          <span className="mk-card-icon"><Mail size={20} /></span>
          <h3>Email support</h3>
          <p>{SITE.supportEmail}</p>
          <span className="mk-inline-placeholder">Placeholder: alias not yet active</span>
        </a>
        <Link className="mk-support-card" to="/privacy">
          <span className="mk-card-icon"><ShieldCheck size={20} /></span>
          <h3>Privacy &amp; data</h3>
          <p>How your data is handled, and what never leaves your device.</p>
        </Link>
      </div>

      <section className="mk-doc-body">
        <h2>Frequently asked</h2>
        <div className="mk-faq">
          {FAQ.map((f) => (
            <details key={f.q} className="mk-faq-item">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    </MarketingPage>
  )
}

// ── Contact ───────────────────────────────────────────────────────────────
export function Contact() {
  return (
    <MarketingPage>
      <DocHeader kicker="Support" title="Contact">
        <p className="mk-doc-intro">
          We’re a small project. The best way to reach us depends on what you need.
        </p>
      </DocHeader>

      <section className="mk-doc-body">
        <div className="mk-contact-grid">
          <div className="mk-contact-item">
            <span className="mk-card-icon"><LifeBuoy size={20} /></span>
            <h3>Support &amp; general questions</h3>
            <p><a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a></p>
            <span className="mk-inline-placeholder">Placeholder: activate before launch</span>
          </div>
          <div className="mk-contact-item">
            <span className="mk-card-icon"><ShieldCheck size={20} /></span>
            <h3>Legal &amp; privacy</h3>
            <p><a href={`mailto:${SITE.legalEmail}`}>{SITE.legalEmail}</a></p>
            <span className="mk-inline-placeholder">Placeholder: activate before launch</span>
          </div>
          <div className="mk-contact-item">
            <span className="mk-card-icon"><Github size={20} /></span>
            <h3>Bugs &amp; feature requests</h3>
            <p><a href={SITE.issuesUrl} target="_blank" rel="noopener noreferrer">GitHub Issues</a></p>
          </div>
        </div>
      </section>
    </MarketingPage>
  )
}

// Where the email-confirmation link lands. It opens in a normal browser tab,
// not the extension, so this just points the user back rather than dropping
// them on the full marketing homepage.
export function Confirmed() {
  return (
    <MarketingPage>
      <div className="mk-confirmed">
        <span className="mk-confirmed-icon"><CheckCircle2 size={40} /></span>
        <h1 className="mk-h1 mk-doc-h1">Email confirmed</h1>
        <p className="mk-doc-intro">
          Your account is ready. Open the PromptFootprint extension and log in with the
          email and password you just used.
        </p>
        <p className="mk-confirmed-hint">You can close this tab.</p>
      </div>
    </MarketingPage>
  )
}
