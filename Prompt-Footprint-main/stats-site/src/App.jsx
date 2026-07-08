import { Routes, Route, NavLink } from 'react-router-dom'
import { Droplets, Zap, BarChart3, Leaf, GraduationCap, Trophy, Settings as SettingsIcon, CircleUserRound } from 'lucide-react'
import WeeklyStats from './components/WeeklyStats'
import SessionList from './components/SessionList'
import Savings from './components/Savings'
import Guide from './components/Guide'
import Awards from './components/Awards'
import Settings from './components/Settings'
import LandingPage from './marketing/LandingPage'
import { Privacy, Terms, Support, Contact, Confirmed } from './marketing/Pages'
import { isDemoMode } from './lib/api'
import './App.css'

// The dashboard shell (top nav + the stats pages). It is mounted at two
// different base paths depending on context, so its links are base-aware:
//   • Extension options page  → base '' , lives at the hash root ('#/').
//   • Public web build (demo) → base '/app', so the marketing site can own '#/'.
// Passing base='' reproduces the original extension routes exactly.
function Dashboard({ base = '' }) {
  const demo = isDemoMode()
  const home = base || '/'
  const to = (p) => `${base}/${p}`

  return (
    <div className="app">
      <nav className="nav">
        <div className="nav-inner">
          <NavLink to={home} end className="nav-brand">
            <Droplets size={22} className="nav-logo" />
            <span className="nav-title">PromptFootprint</span>
          </NavLink>
          <div className="nav-links">
            <NavLink to={home} end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <BarChart3 size={16} /><span>Weekly Stats</span>
            </NavLink>
            <NavLink to={to('sessions')} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <Zap size={16} /><span>Sessions</span>
            </NavLink>
            <NavLink to={to('savings')} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <Leaf size={16} /><span>Savings</span>
            </NavLink>
            <NavLink to={to('learn')} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <GraduationCap size={16} /><span>How it Works</span>
            </NavLink>
            <NavLink to={to('awards')} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <Trophy size={16} /><span>Awards</span>
            </NavLink>
            <NavLink to={to('settings')} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <SettingsIcon size={16} /><span>Settings</span>
            </NavLink>
            <NavLink
              to={to('settings')}
              className={({ isActive }) => `nav-account${isActive ? ' active' : ''}`}
              title="Account"
              aria-label="Account"
            >
              <CircleUserRound size={20} />
            </NavLink>
          </div>
        </div>
      </nav>

      {demo && (
        <div className="demo-banner">
          Showing <strong>sample data</strong>. Install the PromptFootprint extension
          and open this dashboard from it to see your own footprint.
        </div>
      )}

      <main className="main">
        <Routes>
          <Route index element={<WeeklyStats />} />
          <Route path="sessions" element={<SessionList />} />
          <Route path="savings" element={<Savings />} />
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
