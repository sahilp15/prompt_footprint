import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Droplets, ArrowRight, Check, Menu, X, ExternalLink } from 'lucide-react'
import { SITE, hasChromeStoreLink } from '../config/site'
import { useScrollToSection } from './useScrollToSection'
import './marketing.css'

const SECTIONS = [
  { id: 'features', label: 'Features' },
  { id: 'how', label: 'How it works' },
  { id: 'demo', label: 'Demo' },
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

// Primary download call-to-action. Until a real Chrome Web Store listing exists
// (SITE.chromeStoreUrl), this renders as an intentional, styled "coming soon"
// button: clearly not-yet-live, but not broken. Once the URL is set in
// config/site.js it automatically becomes a real link that opens the listing.
export function ChromeCTA({ size = 'lg', block = false }) {
  const live = hasChromeStoreLink()
  const cls = `btn btn-primary btn-${size}${block ? ' btn-block' : ''}${live ? '' : ' btn-soon'}`

  if (live) {
    return (
      <a className={cls} href={SITE.chromeStoreUrl} target="_blank" rel="noopener noreferrer">
        <span className="btn-shine" aria-hidden="true" />
        Add to Chrome, it&apos;s free <ArrowRight size={18} />
      </a>
    )
  }
  return (
    <button className={cls} type="button" disabled aria-disabled="true">
      Add to Chrome
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
 * Scroll-spy for the header. Marks whichever section currently owns the band
 * just under the header, so the nav always says where you are. Degrades to "no
 * section active" wherever IntersectionObserver is missing.
 */
function useActiveSection(ids) {
  const [active, setActive] = useState(null)
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const nodes = ids.map((id) => document.getElementById(id)).filter(Boolean)
    if (!nodes.length) return

    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (visible) setActive(visible.target.id)
      },
      { rootMargin: '-25% 0px -60% 0px', threshold: [0, 0.15, 0.4] },
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

  return (
    <header className={`mk-nav${scrolled ? ' is-scrolled' : ''}`}>
      <div className="mk-nav-inner">
        <Link to="/" className="mk-brand" aria-label="PromptFootprint home">
          <span className="mk-brand-mark"><Droplets size={19} /></span>
          <span className="mk-brand-name">PromptFootprint</span>
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
              {s.label}
            </a>
          ))}
          <Link to="/support" className="mk-nav-link">Support</Link>
        </nav>

        <div className="mk-nav-cta">
          <Link className="mk-nav-demo" to="/app">Live demo</Link>
          <ChromeCTA size="sm" />
          <button
            type="button"
            className="mk-nav-burger"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile sheet. Below 720px the inline links are hidden, so this is the
          only way to reach the sections — it has to carry all of them. */}
      {menuOpen && (
        <>
          <button className="mk-sheet-scrim" aria-hidden="true" tabIndex={-1} onClick={() => setMenuOpen(false)} />
          <div className="mk-sheet" role="dialog" aria-modal="true" aria-label="Menu">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="mk-sheet-link" onClick={(e) => { e.preventDefault(); go(s.id) }}>
                {s.label}
              </a>
            ))}
            <Link to="/support" className="mk-sheet-link" onClick={() => setMenuOpen(false)}>Support</Link>
            <Link to="/app" className="mk-sheet-link" onClick={() => setMenuOpen(false)}>Live demo</Link>
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
  return (
    <footer className="mk-footer">
      <div className="mk-footer-inner">
        <div className="mk-footer-brand">
          <div className="mk-brand">
            <span className="mk-brand-mark"><Droplets size={18} /></span>
            <span className="mk-brand-name">PromptFootprint</span>
          </div>
          <p className="mk-footer-tag">{SITE.tagline}</p>
          <p className="mk-footer-badge"><Check size={13} /> Local-first · No accounts required · Open source</p>
          <a className="mk-footer-gh-btn" href={SITE.githubUrl} target="_blank" rel="noopener noreferrer">
            <Github size={15} /> Star it on GitHub <ExternalLink size={12} />
          </a>
        </div>

        <div className="mk-footer-cols">
          <div className="mk-footer-col">
            <h4>Product</h4>
            <a href="#features" onClick={(e) => { e.preventDefault(); scrollTo('features') }}>Features</a>
            <a href="#how" onClick={(e) => { e.preventDefault(); scrollTo('how') }}>How it works</a>
            <Link to="/app">Live demo</Link>
          </div>
          <div className="mk-footer-col">
            <h4>Trust</h4>
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms">Terms of Use</Link>
            <a href="#privacy" onClick={(e) => { e.preventDefault(); scrollTo('privacy') }}>Data &amp; privacy</a>
          </div>
          <div className="mk-footer-col">
            <h4>Support</h4>
            <Link to="/support">Help &amp; FAQ</Link>
            <Link to="/contact">Contact</Link>
            <a href={SITE.issuesUrl} target="_blank" rel="noopener noreferrer">Report an issue</a>
          </div>
          <div className="mk-footer-col">
            <h4>Project</h4>
            <a href={SITE.githubUrl} target="_blank" rel="noopener noreferrer" className="mk-footer-gh">
              <Github size={14} /> GitHub
            </a>
            <Link to="/app/awards">Recognition</Link>
            <Link to="/app/learn">Methodology</Link>
          </div>
        </div>
      </div>
      <div className="mk-footer-legal">
        <span>© {year} PromptFootprint</span>
        <span className="mk-dot">·</span>
        <span>{SITE.url.replace('https://', '')}</span>
        <span className="mk-dot">·</span>
        <span className="mk-footer-note">Estimates are approximations, not measurements.</span>
      </div>
    </footer>
  )
}

// Shared page wrapper for the non-landing marketing/legal pages.
export function MarketingPage({ children }) {
  return (
    <div className="mk">
      <SiteNav />
      <main className="mk-doc">{children}</main>
      <SiteFooter />
    </div>
  )
}
