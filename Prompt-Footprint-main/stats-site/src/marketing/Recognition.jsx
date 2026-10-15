import { Link } from 'react-router-dom'
import { ArrowUpRight, ArrowRight } from 'lucide-react'
import {
  AWARDS, RESEARCH, MILESTONES, rankedAwards, featuredAward, placementNumeral,
  ordinalSuffix, combinedParticipantsFloor, countWord,
} from '../data/awards'
import { useReveal } from '../hooks/useMotion'
import { SITE } from '../config/site'
import { ChromeCTA, MarketingPage, Github } from './MarketingChrome'
import './theme.css'
import './recognition.css'

/* ── Primitives ───────────────────────────────────────────────────────────── */

/** Fades and lifts its content in once, the first time it scrolls into view. */
export function Rise(props) {
  const { as: Tag = 'div', className = '', delay = 0, children, ...rest } = props
  const [ref, visible] = useReveal({ threshold: 0.12 })
  return (
    <Tag
      ref={ref}
      className={`rc-rise${visible ? ' is-in' : ''}${className ? ` ${className}` : ''}`}
      style={delay ? { '--rise-delay': `${delay}ms` } : undefined}
      {...rest}
    >
      {children}
    </Tag>
  )
}

/** External link with an underline that draws in on hover. */
function OutLink({ href, children, className = '' }) {
  return (
    <a className={`rc-out${className ? ` ${className}` : ''}`} href={href} target="_blank" rel="noopener noreferrer">
      <span>{children}</span>
      <ArrowUpRight size={15} aria-hidden="true" />
      <span className="rc-sr">(opens in a new tab)</span>
    </a>
  )
}

function AwardLinks({ award }) {
  return (
    <p className="rc-links">
      {award.links.map((l) => (
        <OutLink key={l.href} href={l.href}>
          {l.label}<span className="rc-sr"> — {award.event}</span>
        </OutLink>
      ))}
    </p>
  )
}

/* ── Field-size chart ─────────────────────────────────────────────────────── */

/**
 * Registered participants per event, featured award highlighted. Bars are
 * scaled against the largest field so the comparison is honest at a glance.
 */
export function FieldChart({ awards = rankedAwards() }) {
  const max = Math.max(...awards.map((a) => a.participants || 0))
  return (
    <figure className="rc-field">
      <ul className="rc-field-rows">
        {awards.map((a) => (
          <li key={a.id} className={`rc-field-row${a.featured ? ' is-featured' : ''}`}>
            <span className="rc-field-name">{a.shortName}</span>
            <span className="rc-field-track" aria-hidden="true">
              <span style={{ '--w': `${(a.participants / max) * 100}%` }} />
            </span>
            <span className="rc-field-val">{a.participantsShort}</span>
          </li>
        ))}
      </ul>
      <figcaption>
        Registered participants per event, as listed by each organizer.
        “~” marks an approximate count.
      </figcaption>
    </figure>
  )
}

/* ── Featured award ───────────────────────────────────────────────────────── */

export function FeaturedAward({ award = featuredAward(), headingLevel = 2, aside = null }) {
  const H = `h${headingLevel}`
  return (
    <Rise as="article" className="rc-feature" id={award.id} aria-labelledby={`${award.id}-title`}>
      <div className="rc-feature-side">
        <div className="rc-feature-mark" aria-hidden="true">
          <span className="rc-feature-num">{placementNumeral(award.rank)}</span>
          <span className="rc-feature-ord">{ordinalSuffix(award.rank)}</span>
        </div>
        {aside}
      </div>

      <div className="rc-feature-body">
        <p className="rc-overline">
          <span className="rc-overline-accent">Highest placement</span>
          <span aria-hidden="true">/</span>
          <span>{award.year}</span>
        </p>
        <H id={`${award.id}-title`} className="rc-feature-title">
          <span className="rc-sr">{award.placement}, </span>
          {award.event}
        </H>
        <p className="rc-feature-distinction">{award.distinction}</p>
        <p className="rc-feature-desc">{award.description}</p>

        <dl className="rc-facts">
          <div><dt>Field</dt><dd>{award.participantsLabel}</dd></div>
          <div><dt>Format</dt><dd>{award.kind}</dd></div>
          {award.sponsors && (
            <div>
              <dt>Event sponsors<sup>†</sup></dt>
              <dd>{award.sponsors.join(', ')}, and other technology sponsors</dd>
            </div>
          )}
        </dl>
        {award.sponsors && (
          <p className="rc-footnote">
            <sup>†</sup> These companies sponsored the hackathon. They do not sponsor,
            partner with, or endorse PromptFootprint.
          </p>
        )}
        <AwardLinks award={award} />
      </div>
    </Rise>
  )
}

/* ── The other recognitions ───────────────────────────────────────────────── */

/**
 * An editorial grid, deliberately uneven: the third-place result takes the
 * wide column, the two others stack beside it, and the finalist placement is
 * drawn in outline so it never reads as a podium finish.
 */
export function AwardGrid({ awards = rankedAwards().filter((a) => !a.featured), headingLevel = 3 }) {
  const H = `h${headingLevel}`
  return (
    <ol className="rc-grid">
      {awards.map((a, i) => (
        <Rise
          as="li"
          key={a.id}
          id={a.id}
          delay={i * 90}
          className={`rc-entry rc-entry-${i}${a.finalist ? ' is-finalist' : ''}`}
        >
          <div className="rc-entry-top">
            <span className="rc-entry-num" aria-hidden="true">{placementNumeral(a.rank)}</span>
            <span className="rc-entry-place">{a.placement}</span>
          </div>
          <H className="rc-entry-event">
            <span className="rc-sr">{a.placement}, </span>
            {a.event}
          </H>
          <p className="rc-entry-meta">
            <span>{a.year} · {a.kind}</span>
            <span>{a.participantsLabel}</span>
          </p>
          <p className="rc-entry-desc">{a.description}</p>
          <AwardLinks award={a} />
        </Rise>
      ))}
    </ol>
  )
}

/** Compact ledger for the landing page: one row per recognition. */
export function AwardRows({ awards = rankedAwards() }) {
  return (
    <ol className="rc-rows">
      {awards.map((a) => (
        <li key={a.id} className={`rc-row${a.featured ? ' is-featured' : ''}${a.finalist ? ' is-finalist' : ''}`}>
          <span className="rc-row-num" aria-hidden="true">{placementNumeral(a.rank)}</span>
          <span className="rc-row-main">
            <span className="rc-row-event">{a.event}</span>
            <span className="rc-row-meta">{a.participantsLabel}</span>
          </span>
          <span className="rc-row-place">{a.placement}</span>
          <a
            className="rc-row-link"
            href={a.links[0].href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${a.placement}, ${a.event} — ${a.links[0].label.toLowerCase()} on Devpost (opens in a new tab)`}
          >
            <ArrowUpRight size={17} aria-hidden="true" />
          </a>
        </li>
      ))}
    </ol>
  )
}

/* ── Research ─────────────────────────────────────────────────────────────── */

export function ResearchFeature({ id, headingLevel = 2, overline = true }) {
  const H = `h${headingLevel}`
  const r = RESEARCH.result
  return (
    <section className="rc-research" id={id} aria-labelledby="rc-research-title">
      <Rise className="rc-head">
        {overline && <p className="rc-overline"><span className="rc-overline-accent">Research &amp; publication</span></p>}
        <H id="rc-research-title" className="rc-h2">Research-backed. Built for real-world impact.</H>
        <p className="rc-sub">
          From quantifying the hidden environmental costs of generative AI to
          building practical tools that help reduce them.
        </p>
      </Rise>

      <div className="rc-research-grid">
        <Rise as="article" className="rc-paper" aria-label="Publication">
          <p className="rc-paper-journal">
            <span>{RESEARCH.journal}</span>
            <span>{RESEARCH.publisher}</span>
          </p>
          <p className="rc-paper-title">{RESEARCH.title}</p>
          <p className="rc-paper-author">{RESEARCH.author}</p>
          <p className="rc-paper-label">In brief</p>
          <p className="rc-paper-summary">{RESEARCH.summary}</p>
          <p className="rc-paper-label">The framework estimates</p>
          <ul className="rc-paper-measures">
            {RESEARCH.measures.map((m) => <li key={m}>{m}</li>)}
          </ul>
          <a className="btn btn-primary btn-md" href={RESEARCH.href} target="_blank" rel="noopener noreferrer">
            Read the Research <ArrowUpRight className="btn-arrow" size={16} aria-hidden="true" />
            <span className="rc-sr">(opens in a new tab)</span>
          </a>
        </Rise>

        <Rise as="figure" className="rc-result" delay={120}>
          <p className="rc-result-tag">Preliminary result</p>
          <p className="rc-result-big">
            <span className="rc-result-num">{r.reductionPct}%</span>
            <span className="rc-result-unit">fewer total session tokens</span>
          </p>

          <div className="rc-result-bars">
            <div className="rc-result-row">
              <span className="rc-result-name">Before</span>
              <span className="rc-result-track" aria-hidden="true"><span style={{ '--w': '100%' }} /></span>
              <span className="rc-result-val">{r.tokensBefore.toLocaleString()}</span>
            </div>
            <div className="rc-result-row is-after">
              <span className="rc-result-name">With feedback</span>
              <span className="rc-result-track" aria-hidden="true">
                <span style={{ '--w': `${(r.tokensAfter / r.tokensBefore) * 100}%` }} />
              </span>
              <span className="rc-result-val">{r.tokensAfter.toLocaleString()}</span>
            </div>
          </div>

          <dl className="rc-result-facts">
            <div><dt>Session tokens</dt><dd>≈{r.tokensBefore.toLocaleString()} → {r.tokensAfter.toLocaleString()}</dd></div>
            <div><dt>Queries</dt><dd>{r.queriesBefore} → {r.queriesAfter}</dd></div>
          </dl>

          <figcaption>
            {r.qualifier} Publication in the {RESEARCH.journal} does not imply
            sponsorship or endorsement by {RESEARCH.publisher}.
          </figcaption>
        </Rise>
      </div>
    </section>
  )
}

/* ── The full showcase ────────────────────────────────────────────────────── */

/**
 * The recognition page body. `variant="site"` closes with an install prompt;
 * `variant="app"` (inside the extension's dashboard, where the visitor already
 * has it installed) closes with the source and methodology instead.
 */
export function RecognitionShowcase({ variant = 'site' }) {
  const ranked = rankedAwards()
  const featured = featuredAward()
  const rest = ranked.filter((a) => a.id !== featured.id)
  const field = combinedParticipantsFloor()

  return (
    <div className="rc-showcase">
      {/* 1 — Introduction */}
      <header className="rc-intro">
        <Rise className="rc-intro-copy">
          <p className="rc-overline">
            <span className="rc-overline-accent">Recognition</span>
            <span aria-hidden="true">/</span>
            <span>The 2026 season</span>
          </p>
          <h1 className="rc-h1">
            Built to make an impact. <em>Recognized for it.</em>
          </h1>
          <p className="rc-sub rc-sub-lg">
            {countWord(AWARDS.length)} international hackathon recognitions.
            Published research. One mission: making AI more efficient, transparent,
            and sustainable.
          </p>
        </Rise>

        <Rise as="nav" className="rc-index" aria-label="Recognitions" delay={120}>
          <p className="rc-index-head">
            <span>Nº</span><span>2026</span>
          </p>
          <ol>
            {ranked.map((a) => (
              <li key={a.id}>
                <a href={`#${a.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(a.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>
                  <span className="rc-index-num">{placementNumeral(a.rank)}</span>
                  <span className="rc-index-name">{a.event}</span>
                  <span className="rc-index-place">{a.finalist ? 'Finalist' : a.placement.replace(' Place', '')}</span>
                </a>
              </li>
            ))}
          </ol>
          <p className="rc-index-foot">
            {field.toLocaleString()}+ registered participants across all four events
          </p>
        </Rise>
      </header>

      {/* 2 — Featured */}
      <section className="rc-band" aria-label="Featured recognition">
        <FeaturedAward award={featured} aside={<FieldChart awards={ranked} />} />
      </section>

      {/* 3 — The rest */}
      <section className="rc-band" aria-labelledby="rc-more-title">
        <div className="rc-band-head">
          <h2 id="rc-more-title" className="rc-h3">Also recognized in 2026</h2>
          <span className="rc-band-rule" aria-hidden="true" />
        </div>
        <AwardGrid awards={rest} />
      </section>

      {/* 4 — Research */}
      <div className="rc-band">
        <ResearchFeature id="research" />
      </div>

      {/* 5 — Close */}
      {variant === 'site' ? (
        <Rise as="section" className="rc-close" aria-labelledby="rc-close-title">
          <div>
            <h2 id="rc-close-title" className="rc-close-title">
              Recognition is a start. <em>The real test is your next prompt.</em>
            </h2>
            <p className="rc-close-text">
              PromptFootprint has {MILESTONES.downloads}+ downloads on the Chrome Web
              Store. It is free, works without an account, and starts on your next
              ChatGPT or Claude conversation.
            </p>
          </div>
          <div className="rc-close-cta">
            <ChromeCTA size="lg" />
            <Link className="rc-close-link" to="/app">
              Explore the live demo <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </Rise>
      ) : (
        <Rise as="section" className="rc-close" aria-labelledby="rc-close-title">
          <div>
            <h2 id="rc-close-title" className="rc-close-title">
              Every number is open to inspection.
            </h2>
            <p className="rc-close-text">
              The estimation model, its sources, and its limitations are published
              alongside the code.
            </p>
          </div>
          <div className="rc-close-cta">
            <a className="btn btn-on-dark btn-lg" href={SITE.githubUrl} target="_blank" rel="noopener noreferrer">
              <Github size={17} /> Source and methodology
            </a>
          </div>
        </Rise>
      )}
    </div>
  )
}

export default function RecognitionPage() {
  return (
    <MarketingPage wide>
      <div className="rc">
        <RecognitionShowcase variant="site" />
      </div>
    </MarketingPage>
  )
}
