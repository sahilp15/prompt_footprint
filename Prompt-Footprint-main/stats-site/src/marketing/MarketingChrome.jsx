import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Menu, X } from 'lucide-react'
import { SITE, hasChromeStoreLink } from '../config/site'
import { RESEARCH } from '../data/awards'
import { useScrollToSection, useScrollTopOnRoute } from './useScrollToSection'
import './theme.css'
import './marketing.css'

// In-page sections on the landing page, in reading order. Recognition is a
// page of its own, so it is a route link rather than a scroll target.
const SECTIONS = [
  { id: 'product', label: 'Product' },
  { id: 'how', label: 'How it works' },
  { id: 'research', label: 'Research' },
  { id: 'privacy', label: 'Privacy' },
]

// Hoisted so the scroll-spy effect below has a stable dependency.
const SECTION_IDS = SECTIONS.map((s) => s.id)

// GitHub's mark isn't in this lucide version (brand icons were dropped), so we
// inline it. Self-contained, matches the size/stroke conventions of the set.
export function Github({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.2 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.39 1.24-3.23-.13-.3-.54-1.53.11-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 3.01-.4c1.02 0 2.05.14 3.01.4 2.29-1.55 3.3-1.23 3.3-1.23.65 1.65.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.23 0 4.63-2.81 5.65-5.49 5.95.43.37.82 1.1.82 2.22v3.29c0 .32.22.7.83.58C20.56 22.29 24 17.8 24 12.5 24 5.87 18.63.5 12 .5Z" />
    </svg>
  )
}

/** The mark: a footprint-shaped leaf drawn as two strokes. */
export function BrandMark({ size = 26 }) {
  return (
    <svg className="mk-mark" width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <rect width="28" height="28" rx="7" fill="var(--pf-forest)" />
      <path d="M14 21.5c-4.2-1.6-6-5.2-5.4-9.6C12.9 11.6 16.4 13 18 16.6" fill="none" stroke="var(--pf-on-forest)" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M14 21.5c.4-4.3 2.2-9 5.8-13" fill="none" stroke="#9cc27a" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

// Primary download call-to-action. Until a real Chrome Web Store listing exists
// (SITE.chromeStoreUrl), this renders as an intentional, styled "coming soon"
// button: clearly not-yet-live, but not broken. Once the URL is set in
// config/site.js it automatically becomes a real link that opens the listing.
export function ChromeCTA({ size = 'lg', block = false, label = 'Get the Chrome Extension' }) {
  const live = hasChromeStoreLink()
  const cls = `btn btn-primary btn-${size}${block ? ' btn-block' : ''}${live ? '' : ' btn-soon'}`

  if (live) {
    return (
      <a className={cls} href={SITE.chromeStoreUrl} target="_blank" rel="noopener noreferrer">
        <span>{label}</span>
        <ArrowUpRight className="btn-arrow" size={size === 'sm' ? 15 : 17} aria-hidden="true" />
      </a>
    )
  }
  return (
    <button className={cls} type="button" disabled aria-disabled="true">
      {label}
      <span className="btn-soon-tag">Coming soon</span>
    </button>
  )
}

/** Raises the bar once the page has scrolled off the very top. */
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

/**
 * Scroll-spy for the header: whichever section crosses a line 30% down the
 * viewport is "current". A rAF-throttled scroll listener rather than an
 * IntersectionObserver, because several sections are taller than the viewport
 * and never reach an observer threshold, which left the marker stuck.
 */
function useActiveSection(ids, enabled) {
  const [active, setActive] = useState(null)
  useEffect(() => {
    if (!enabled) return
    let frame = 0
    const measure = () => {
      frame = 0
      const line = window.innerHeight * 0.3
      let current = null
      for (const id of ids) {
        const r = document.getElementById(id)?.getBoundingClientRect()
        if (r && r.top <= line && r.bottom > line) current = id
      }
      setActive(current)
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure) }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [ids, enabled])
  return enabled ? active : null
}

export function SiteNav() {
  const scrollTo = useScrollToSection()
  const scrolled = useScrolled()
  const { pathname } = useLocation()
  const active = useActiveSection(SECTION_IDS, pathname === '/')
  const [menuOpen, setMenuOpen] = useState(false)

  // Escape closes the sheet, and the page never scrolls behind it.
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [menuOpen])

  const go = (id) => { setMenuOpen(false); scrollTo(id) }
  const navCls = ({ isActive }) => `mk-nav-link${isActive ? ' is-active' : ''}`

  return (
    <header className={`mk-nav${scrolled ? ' is-scrolled' : ''}`}>
      <a className="mk-skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus() }}>
        Skip to content
      </a>
      <div className="mk-nav-inner">
        <Link to="/" className="mk-brand" aria-label="PromptFootprint home">
          <BrandMark />
          <span className="mk-brand-name">PromptFootprint</span>
        </Link>

        <nav className="mk-nav-links" aria-label="Primary">
          {SECTIONS.slice(0, 3).map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={`mk-nav-link${active === s.id ? ' is-active' : ''}`}
              aria-current={active === s.id ? 'true' : undefined}
              onClick={(e) => { e.preventDefault(); go(s.id) }}
            >
              {s.label}
            </a>
          ))}
          <NavLink to="/recognition" className={navCls}>Recognition</NavLink>
          {SECTIONS.slice(3).map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={`mk-nav-link${active === s.id ? ' is-active' : ''}`}
              aria-current={active === s.id ? 'true' : undefined}
              onClick={(e) => { e.preventDefault(); go(s.id) }}
            >
              {s.label}
            </a>
          ))}
        </nav>

        <div className="mk-nav-cta">
          <Link className="mk-nav-demo" to="/app">Live demo</Link>
          <ChromeCTA size="sm" label="Get the extension" />
          <button
            type="button"
            className="mk-nav-burger"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mk-sheet"
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile sheet. Below 900px the inline links are hidden, so this is the
          only way to reach the sections — it has to carry all of them. */}
      {menuOpen && (
        <>
          <button className="mk-sheet-scrim" aria-hidden="true" tabIndex={-1} onClick={() => setMenuOpen(false)} />
          <div className="mk-sheet" id="mk-sheet" role="dialog" aria-modal="true" aria-label="Menu">
            {SECTIONS.slice(0, 3).map((s) => (
              <a key={s.id} href={`#${s.id}`} className="mk-sheet-link" onClick={(e) => { e.preventDefault(); go(s.id) }}>
                {s.label}
              </a>
            ))}
            <Link to="/recognition" className="mk-sheet-link" onClick={() => setMenuOpen(false)}>Recognition</Link>
            {SECTIONS.slice(3).map((s) => (
              <a key={s.id} href={`#${s.id}`} className="mk-sheet-link" onClick={(e) => { e.preventDefault(); go(s.id) }}>
                {s.label}
              </a>
            ))}
            <Link to="/app" className="mk-sheet-link" onClick={() => setMenuOpen(false)}>Live demo</Link>
            <Link to="/support" className="mk-sheet-link" onClick={() => setMenuOpen(false)}>Support</Link>
            <div className="mk-sheet-cta"><ChromeCTA size="lg" block /></div>
          </div>
        </>
      )}
    </header>
  )
}

export function SiteFooter() {
  const year = 2026 // static: build runs without Date access; bump on release
  const scrollTo = useScrollToSection()
  const section = (id, label) => (
    <a href={`#${id}`} onClick={(e) => { e.preventDefault(); scrollTo(id) }}>{label}</a>
  )
  return (
    <footer className="mk-footer">
      <div className="mk-footer-inner">
        <div className="mk-footer-brand">
          <Link to="/" className="mk-brand" aria-label="PromptFootprint home">
            <BrandMark size={24} />
            <span className="mk-brand-name">PromptFootprint</span>
          </Link>
          <p className="mk-footer-tag">
            A browser extension that makes prompts leaner and the estimated
            environmental cost of AI visible. Local-first, free, and open source.
          </p>
          <a className="mk-footer-gh-btn" href={SITE.githubUrl} target="_blank" rel="noopener noreferrer">
            <Github size={15} /> Source on GitHub <ArrowUpRight size={13} aria-hidden="true" />
          </a>
        </div>

        <div className="mk-footer-cols">
          <div className="mk-footer-col">
            <h2>Product</h2>
            {section('product', 'What it does')}
            {section('how', 'How it works')}
            <Link to="/app">Live demo</Link>
            {hasChromeStoreLink() && (
              <a href={SITE.chromeStoreUrl} target="_blank" rel="noopener noreferrer">Chrome Web Store</a>
            )}
          </div>
          <div className="mk-footer-col">
            <h2>Evidence</h2>
            <a href={RESEARCH.href} target="_blank" rel="noopener noreferrer">Research paper</a>
            <Link to="/app/learn">Methodology</Link>
            <Link to="/recognition">Recognition</Link>
          </div>
          <div className="mk-footer-col">
            <h2>Trust</h2>
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms">Terms of Use</Link>
            {section('privacy', 'Data & privacy')}
          </div>
          <div className="mk-footer-col">
            <h2>Support</h2>
            <Link to="/support">Help &amp; FAQ</Link>
            <Link to="/contact">Contact</Link>
            <a href={SITE.issuesUrl} target="_blank" rel="noopener noreferrer">Report an issue</a>
          </div>
        </div>
      </div>
      <div className="mk-footer-legal">
        <span>© {year} PromptFootprint</span>
        <span className="mk-footer-note">
          Environmental figures are estimates from published sources, not measurements of any data center.
        </span>
      </div>
    </footer>
  )
}

// Shared page wrapper for the non-landing marketing/legal pages.
export function MarketingPage({ children, wide = false }) {
  useScrollTopOnRoute()
  return (
    <div className="mk">
      <SiteNav />
      <main id="main" tabIndex={-1} className={wide ? 'mk-page' : 'mk-doc'}>{children}</main>
      <SiteFooter />
    </div>
  )
}

/** Inline text link with the animated underline, for internal routes. */
export function ArrowLink({ to, href, children }) {
  const inner = <>{children}<ArrowRight size={14} aria-hidden="true" /></>
  if (href) {
    return <a className="mk-arrow-link" href={href} target="_blank" rel="noopener noreferrer">{inner}</a>
  }
  return <Link className="mk-arrow-link" to={to}>{inner}</Link>
}
