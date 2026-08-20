import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { SITE, hasChromeStoreLink } from '../config/site'
import { useScrollToSection } from './useScrollToSection'
import './marketing.css'

/* The site's frame: a ruled bar, a ruled footer, and nothing between them that
   is not a link or a reading. No logo lockup with a rounded tile, no glass. */

const SECTIONS = [
  { id: 'tighten', index: '01', label: 'Tighten' },
  { id: 'measure', index: '02', label: 'Measure' },
  { id: 'accumulate', index: '03', label: 'Dashboard' },
  { id: 'private', index: '05', label: 'Privacy' },
  { id: 'method', index: '06', label: 'Method' },
]
const SECTION_IDS = SECTIONS.map((s) => s.id)

/**
 * The wordmark. A footprint reduced to two rules and a measured gap — the mark
 * is the measurement, which is the only idea the product has.
 */
export function Mark({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path d="M2 3.5v11M16 3.5v11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" />
      <path d="M2 9h5M11 9h5" stroke="currentColor" strokeWidth="1.4" />
      <rect x="7.4" y="6.4" width="3.2" height="5.2" fill="currentColor" />
    </svg>
  )
}

/** GitHub's mark isn't in this lucide version, so it is inlined. */
export function Github({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.2 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.39 1.24-3.23-.13-.3-.54-1.53.11-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 3.01-.4c1.02 0 2.05.14 3.01.4 2.29-1.55 3.3-1.23 3.3-1.23.65 1.65.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.23 0 4.63-2.81 5.65-5.49 5.95.43.37.82 1.1.82 2.22v3.29c0 .32.22.7.83.58C20.56 22.29 24 17.8 24 12.5 24 5.87 18.63.5 12 .5Z" />
    </svg>
  )
}

/**
 * The install call to action. Until a real Chrome Web Store listing exists it
 * renders as a clearly-disabled control rather than a dead link; once
 * `SITE.chromeStoreUrl` is set it becomes the listing.
 */
export function ChromeCTA({ primary = true, size = '' }) {
  const live = hasChromeStoreLink()
  const cls = `pf2-btn${primary ? ' is-primary' : ''}${size === 'sm' ? ' is-sm' : ''}`
  if (live) {
    return (
      <a className={cls} href={SITE.chromeStoreUrl} target="_blank" rel="noopener noreferrer">
        Add to Chrome
      </a>
    )
  }
  return (
    <button className={cls} type="button" disabled aria-disabled="true">
      Add to Chrome · soon
    </button>
  )
}

function useScrolled(threshold = 8) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [threshold])
  return scrolled
}

/** Marks whichever section owns the band under the header. */
function useActiveSection(ids) {
  const [active, setActive] = useState(null)
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined
    const nodes = ids.map((id) => document.getElementById(id)).filter(Boolean)
    if (!nodes.length) return undefined
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (visible) setActive(visible.target.id)
      },
      { rootMargin: '-20% 0px -65% 0px', threshold: [0, 0.15, 0.4] },
    )
    nodes.forEach((n) => io.observe(n))
    return () => io.disconnect()
  }, [ids])
  return active
}

export function SiteNav() {
  const scrollTo = useScrollToSection()
  const scrolled = useScrolled()
  const active = useActiveSection(SECTION_IDS)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open])

  const go = (id) => { setOpen(false); scrollTo(id) }

  return (
    <header className={`mk-nav${scrolled ? ' is-scrolled' : ''}`}>
      <div className="mk-nav-inner">
        <Link to="/" className="mk-brand" aria-label="PromptFootprint home">
          <Mark />
          <span className="mk-brand-name">PromptFootprint</span>
          <span className="u-micro mk-brand-kicker">AI efficiency meter</span>
        </Link>

        <nav className="mk-nav-links" aria-label="Sections">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={`mk-nav-link${active === s.id ? ' is-active' : ''}`}
              aria-current={active === s.id ? 'true' : undefined}
              onClick={(e) => { e.preventDefault(); go(s.id) }}
            >
              <span className="mk-nav-index" aria-hidden="true">{s.index}</span>
              {s.label}
            </a>
          ))}
        </nav>

        <div className="mk-nav-cta">
          <Link className="pf2-btn is-quiet is-sm mk-nav-demo" to="/app">Dashboard</Link>
          <ChromeCTA size="sm" />
          <button
            type="button"
            className="mk-nav-burger pf2-btn is-sm"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? 'Close' : 'Menu'}
          </button>
        </div>
      </div>

      {open && (
        <>
          <button className="mk-sheet-scrim" aria-hidden="true" tabIndex={-1} onClick={() => setOpen(false)} />
          <div className="mk-sheet" role="dialog" aria-modal="true" aria-label="Menu">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="mk-sheet-link" onClick={(e) => { e.preventDefault(); go(s.id) }}>
                <span className="mk-nav-index" aria-hidden="true">{s.index}</span>{s.label}
              </a>
            ))}
            <Link to="/app" className="mk-sheet-link" onClick={() => setOpen(false)}>Dashboard</Link>
            <Link to="/support" className="mk-sheet-link" onClick={() => setOpen(false)}>Support</Link>
            <Link to="/privacy" className="mk-sheet-link" onClick={() => setOpen(false)}>Privacy Policy</Link>
            <Link to="/terms" className="mk-sheet-link" onClick={() => setOpen(false)}>Terms of Use</Link>
            <div className="mk-sheet-cta"><ChromeCTA /></div>
          </div>
        </>
      )}
    </header>
  )
}

export function SiteFooter() {
  const year = 2026 // static: the build runs without Date access; bump on release
  return (
    <footer className="mk-footer">
      <div className="mk-footer-inner">
        <div className="mk-footer-brand">
          <span className="mk-brand"><Mark /><span className="mk-brand-name">PromptFootprint</span></span>
          <p className="u-micro">{SITE.tagline}</p>
        </div>

        <nav className="mk-footer-cols" aria-label="Site">
          <div className="mk-footer-col">
            <h4 className="u-micro">Product</h4>
            <Link to="/app">Dashboard</Link>
            <Link to="/app/cutter">Token Cutter</Link>
            <Link to="/app/learn">Methodology</Link>
            <Link to="/app/awards">Recognition</Link>
          </div>
          <div className="mk-footer-col">
            <h4 className="u-micro">Trust</h4>
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms">Terms of Use</Link>
            <a href={`${SITE.githubUrl}/blob/main/METHODOLOGY.md`} target="_blank" rel="noopener noreferrer">Full method ↗</a>
          </div>
          <div className="mk-footer-col">
            <h4 className="u-micro">Support</h4>
            <Link to="/support">Help &amp; FAQ</Link>
            <Link to="/contact">Contact</Link>
            <a href={SITE.issuesUrl} target="_blank" rel="noopener noreferrer">Report an issue ↗</a>
          </div>
          <div className="mk-footer-col">
            <h4 className="u-micro">Source</h4>
            <a href={SITE.githubUrl} target="_blank" rel="noopener noreferrer" className="mk-footer-gh">
              <Github size={14} /> GitHub ↗
            </a>
            {hasChromeStoreLink() && (
              <a href={SITE.chromeStoreUrl} target="_blank" rel="noopener noreferrer">Chrome Web Store ↗</a>
            )}
          </div>
        </nav>
      </div>

      <div className="mk-footer-legal u-micro">
        <span>© {year} PromptFootprint</span>
        <span>{SITE.url.replace('https://', '')}</span>
        <span>Free · Local-first · Open source</span>
        <span>Resource figures are estimated, not metered</span>
      </div>
    </footer>
  )
}

/** Shared wrapper for the non-landing pages (privacy, terms, support…). */
export function MarketingPage({ children }) {
  return (
    <div className="mk pf2 pf2-page">
      <SiteNav />
      <main className="mk-doc">{children}</main>
      <SiteFooter />
    </div>
  )
}
