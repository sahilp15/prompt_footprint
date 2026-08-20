import { Suspense, lazy, useEffect, useState } from 'react'
import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import DashboardSurface from './dashboard/DashboardSurface'
import LandingPage from './marketing/LandingPage'
import { Mark } from './marketing/MarketingChrome'
import { Privacy, Terms, Support, Contact, Confirmed } from './marketing/Pages'
import { isDemoMode } from './lib/api'
import './App.css'

// Split out of the entry bundle. The landing page and the dashboard are what a
// first visit loads; the Token Cutter workspace, the method write-up, the
// recognition page and settings are each a separate visit, and each drags in
// its own icon set and UI. A site about not spending what you do not need has
// no business shipping four screens nobody asked for.
const TokenCutter = lazy(() => import('./components/cutter/TokenCutter'))
const Guide = lazy(() => import('./components/Guide'))
const Awards = lazy(() => import('./components/Awards'))
const Settings = lazy(() => import('./components/Settings'))

/** Placeholder while a split route arrives. Holds space; says what it is. */
function RouteFallback() {
  return (
    <div className="route-loading" role="status">
      <span className="u-micro">Loading…</span>
    </div>
  )
}

// Overview / Efficiency / Footprint / Sessions are tabs inside one dashboard —
// they are four readings of the same period, not four pages. What stays a route
// is what is genuinely a different tool.
const NAV_ITEMS = [
  { to: '', end: true, label: 'Dashboard' },
  { to: 'cutter', label: 'Token Cutter' },
  { to: 'learn', label: 'Method' },
  { to: 'awards', label: 'Recognition' },
  { to: 'settings', label: 'Settings' },
]

/** Rules the header off from the content once the page has moved. */
function useScrolled(threshold = 6) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [threshold])
  return scrolled
}

// The dashboard shell. Mounted at two base paths:
//   • Extension options page  → base '' , at the hash root ('#/').
//   • Public web build (demo) → base '/app', so the site can own '#/'.
function Dashboard({ base = '' }) {
  const scrolled = useScrolled()
  const location = useLocation()
  const home = base || '/'
  const to = (p) => (p ? `${base}/${p}` : home)

  return (
    <div className="app pf2">
      <nav className={`nav${scrolled ? ' is-scrolled' : ''}`}>
        <div className="nav-inner">
          <NavLink to={home} end className="nav-brand">
            <Mark size={17} />
            <span className="nav-title">PromptFootprint</span>
          </NavLink>

          <div className="nav-links">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.label}
                to={to(item.to)}
                end={item.end}
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
      </nav>

      <main className="main" key={location.pathname}>
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route index element={<DashboardSurface />} />
          {/* Kept so links from earlier versions still land somewhere sensible:
              each old page is now a tab on the one dashboard. */}
          <Route path="sessions" element={<DashboardSurface initialTab="sessions" />} />
          <Route path="savings" element={<DashboardSurface initialTab="efficiency" />} />
          <Route path="cutter" element={<TokenCutter />} />
          <Route path="learn" element={<Guide />} />
          <Route path="awards" element={<Awards />} />
          <Route path="settings" element={<Settings />} />
        </Routes>
        </Suspense>
      </main>
    </div>
  )
}

function App() {
  const demo = isDemoMode()

  // In the extension the whole app IS the dashboard. On the public web build the
  // landing page owns the root and the dashboard moves under /app as a live,
  // sample-data demo.
  if (!demo) {
    return (
      <Routes>
        <Route path="/*" element={<Dashboard base="" />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/support" element={<Support />} />
      <Route path="/contact" element={<Contact />} />
      <Route path="/confirmed" element={<Confirmed />} />
      <Route path="/app/*" element={<Dashboard base="/app" />} />
    </Routes>
  )
}

export default App
