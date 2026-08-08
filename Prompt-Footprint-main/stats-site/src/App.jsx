import { useEffect, useState } from 'react'
import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import {
  Droplets, Zap, BarChart3, Leaf, GraduationCap, Trophy, Scissors,
  Settings as SettingsIcon, CircleUserRound, Sparkles,
} from 'lucide-react'
import WeeklyStats from './components/WeeklyStats'
import SessionList from './components/SessionList'
import Savings from './components/Savings'
import Guide from './components/Guide'
import TokenCutter from './components/cutter/TokenCutter'
import Awards from './components/Awards'
import Settings from './components/Settings'
import LandingPage from './marketing/LandingPage'
import { Privacy, Terms, Support, Contact, Confirmed } from './marketing/Pages'
import { isDemoMode } from './lib/api'
import './App.css'

const NAV_ITEMS = [
  { to: '', end: true, icon: BarChart3, label: 'Weekly Stats' },
  { to: 'sessions', icon: Zap, label: 'Sessions' },
  { to: 'savings', icon: Leaf, label: 'Savings' },
  { to: 'cutter', icon: Scissors, label: 'Token Cutter' },
  { to: 'learn', icon: GraduationCap, label: 'How it Works' },
  { to: 'awards', icon: Trophy, label: 'Awards' },
  { to: 'settings', icon: SettingsIcon, label: 'Settings' },
]

/** Raises the header once the page has moved, so it detaches from the content. */
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

// The dashboard shell (top nav + the stats pages). It is mounted at two
// different base paths depending on context, so its links are base-aware:
//   • Extension options page  → base '' , lives at the hash root ('#/').
//   • Public web build (demo) → base '/app', so the marketing site can own '#/'.
// Passing base='' reproduces the original extension routes exactly.
function Dashboard({ base = '' }) {
  const demo = isDemoMode()
  const scrolled = useScrolled()
  const location = useLocation()
  const home = base || '/'
  const to = (p) => (p ? `${base}/${p}` : home)

  return (
    <div className="app">
      <div className="app-ambient" aria-hidden="true" />

      <nav className={`nav${scrolled ? ' is-scrolled' : ''}`}>
        <div className="nav-inner">
          <NavLink to={home} end className="nav-brand">
            <span className="nav-mark"><Droplets size={18} /></span>
            <span className="nav-wordmark">
              <span className="nav-title">PromptFootprint</span>
              <span className="nav-kicker">Dashboard</span>
            </span>
          </NavLink>

          <div className="nav-links">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.label}
                  to={to(item.to)}
                  end={item.end}
                  className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>{item.label}</span>
                </NavLink>
              )
            })}
            <span className="nav-divider" aria-hidden="true" />
            <NavLink
              to={to('settings')}
              className={({ isActive }) => `nav-account${isActive ? ' active' : ''}`}
              title="Account"
              aria-label="Account"
            >
              <CircleUserRound size={19} />
            </NavLink>
          </div>
        </div>
      </nav>

      {demo && (
        <div className="demo-banner">
          <span className="demo-banner-inner">
            <Sparkles size={14} aria-hidden="true" />
            <span>
              Showing <strong>sample data</strong>. Install the PromptFootprint extension
              and open this dashboard from it to see your own footprint.
            </span>
          </span>
        </div>
      )}

      {/* Keyed on the path so each route fades and lifts into place instead of
          snapping. Purely additive — the animation's resting state is the
          normal one, so a reduced-motion visitor simply sees the page. */}
      <main className="main" key={location.pathname}>
        <Routes>
          <Route index element={<WeeklyStats />} />
          <Route path="sessions" element={<SessionList />} />
          <Route path="savings" element={<Savings />} />
          <Route path="cutter" element={<TokenCutter />} />
          <Route path="learn" element={<Guide />} />
          <Route path="awards" element={<Awards />} />
          <Route path="settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}

function App() {
  const demo = isDemoMode()

  // In the extension the whole app IS the dashboard (behavior unchanged). On the
  // public web build the marketing landing page owns the root and the dashboard
  // moves under /app as a live, sample-data demo.
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
