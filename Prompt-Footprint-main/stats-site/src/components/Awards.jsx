import { ArrowUpRight, Award, ExternalLink, GitBranch, Medal, Trophy, Users } from 'lucide-react'
import { AWARDS, awardStats, featuredAward } from '../data/awards'
import { useCountUp, usePrefersReducedMotion, useReveal } from '../hooks/useMotion'
import { SITE } from '../config/site'
import './Awards.css'

/**
 * One headline number. The counter only starts once the tile scrolls into
 * view, and is skipped entirely under `prefers-reduced-motion`.
 */
function StatTile({ stat, index }) {
  const [ref, visible] = useReveal({ threshold: 0.4 })
  const animated = useCountUp(stat.value, visible, { duration: 900 + index * 120 })

  return (
    <div
      ref={ref}
      className={`aw-stat${visible ? ' is-visible' : ''}`}
      style={{ '--reveal-delay': `${index * 70}ms` }}
    >
      <div className="aw-stat-value">
        <span className="aw-stat-number">{Math.round(animated).toLocaleString()}</span>
        {stat.suffix && <span className="aw-stat-suffix">{stat.suffix}</span>}
      </div>
      <div className="aw-stat-label">{stat.label}</div>
      <div className="aw-stat-caption">{stat.caption}</div>
    </div>
  )
}

/** The medallion carrying the placement — a ring, the rank, then the word. */
function PlacementBadge({ placement, size = 'md' }) {
  const [rank, ...rest] = placement.split(' ')
  return (
    <span className={`aw-medal aw-medal-${size}`} aria-hidden="true">
      <span className="aw-medal-rank">{rank}</span>
      <span className="aw-medal-word">{rest.join(' ')}</span>
    </span>
  )
}

/** The spotlighted award: the strongest finish, given the most space. */
function FeaturedAward({ award }) {
  const [ref, visible] = useReveal({ threshold: 0.1 })

  return (
    <section
      ref={ref}
      className={`aw-featured${visible ? ' is-visible' : ''}`}
      aria-labelledby="aw-featured-title"
    >
      <span className="aw-featured-glow" aria-hidden="true" />
      <div className="aw-featured-inner">
        <div className="aw-featured-medal">
          <Trophy className="aw-featured-trophy" size={30} aria-hidden="true" />
          <PlacementBadge placement={award.placement} size="lg" />
        </div>

        <div className="aw-featured-body">
          <p className="aw-eyebrow">
            <span>Highest placement</span>
          </p>
          <h2 id="aw-featured-title" className="aw-featured-title">{award.event}</h2>
          <p className="aw-featured-scope">
            <Users size={14} aria-hidden="true" />
            <span>{award.scope}</span>
            <span className="aw-dot" aria-hidden="true">·</span>
            <time dateTime={award.date}>{award.dateLabel}</time>
          </p>
          <p className="aw-featured-desc">{award.description}</p>

          <ul className="aw-chips">
            {award.highlights.map((h) => <li className="aw-chip" key={h}>{h}</li>)}
          </ul>

          <a className="aw-cta" href={award.href} target="_blank" rel="noopener noreferrer">
            {award.linkLabel}
            <ExternalLink size={15} aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  )
}

/**
 * A timeline entry. The whole card is one link, so pointer and keyboard users
 * get the same target and screen readers never meet a nested interactive.
 */
function TimelineAward({ award, index }) {
  const [ref, visible] = useReveal({ threshold: 0.15 })

  return (
    <li
      ref={ref}
      className={`aw-node${visible ? ' is-visible' : ''}`}
      style={{ '--reveal-delay': `${index * 90}ms` }}
    >
      <span className="aw-node-marker" aria-hidden="true"><Medal size={15} /></span>

      <a
        className="aw-card"
        href={award.href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${award.award}, ${award.event} — opens Devpost in a new tab`}
      >
        <span className="aw-card-sheen" aria-hidden="true" />
        <span className="aw-card-head">
          <PlacementBadge placement={award.placement} />
          <span className="aw-card-heading">
            <span className="aw-card-award">{award.award}</span>
            <span className="aw-card-event">{award.event}</span>
            <span className="aw-card-meta">
              <span>{award.scope}</span>
              <span className="aw-dot" aria-hidden="true">·</span>
              <time dateTime={award.date}>{award.dateLabel}</time>
            </span>
          </span>
          <span className="aw-card-arrow" aria-hidden="true"><ArrowUpRight size={18} /></span>
        </span>

        <span className="aw-card-desc">{award.description}</span>

        <span className="aw-chips aw-chips-sm">
          {award.highlights.map((h) => <span className="aw-chip" key={h}>{h}</span>)}
        </span>

        <span className="aw-card-link">
          {award.linkLabel}
          <ExternalLink size={14} aria-hidden="true" />
        </span>
      </a>
    </li>
  )
}

export default function Awards() {
  const reduced = usePrefersReducedMotion()
  const featured = featuredAward()
  const stats = awardStats()
  // Newest first; ties broken by the stronger finish.
  const timeline = [...AWARDS].sort((a, b) => Number(b.date) - Number(a.date) || a.rank - b.rank)

  return (
    <div className={`awards-page${reduced ? ' motion-reduced' : ''}`}>
      <header className="aw-hero">
        <span className="aw-hero-rings" aria-hidden="true" />
        <p className="aw-eyebrow aw-eyebrow-hero">
          <Award size={13} aria-hidden="true" />
          <span>Recognition</span>
        </p>
        <h1 className="aw-hero-title">Judged in international competition</h1>
        <p className="aw-hero-sub">
          PromptFootprint has been recognized for measuring — and reducing — the
          energy, water, and CO₂ behind everyday AI use.
        </p>

        <div className="aw-stats">
          {stats.map((s, i) => <StatTile stat={s} index={i} key={s.id} />)}
        </div>
      </header>

      <FeaturedAward award={featured} />

      <section className="aw-timeline-section" aria-labelledby="aw-timeline-title">
        <h2 id="aw-timeline-title" className="aw-section-title">All recognition</h2>
        <ol className="aw-timeline">
          {timeline.map((a, i) => <TimelineAward award={a} index={i} key={a.id} />)}
        </ol>
      </section>

      <section className="aw-outro">
        <p className="aw-outro-text">
          Every number these awards recognize is reproducible — the model, its
          sources, and its limitations are published in the open.
        </p>
        <a className="aw-outro-link" href={SITE.githubUrl} target="_blank" rel="noopener noreferrer">
          <GitBranch size={15} aria-hidden="true" />
          <span>Read the source and methodology</span>
          <ExternalLink size={13} aria-hidden="true" />
        </a>
      </section>
    </div>
  )
}
