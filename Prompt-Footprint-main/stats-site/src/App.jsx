import { Routes, Route, NavLink } from 'react-router-dom'
import { Droplets, Zap, BarChart3, Leaf, BookOpen, GraduationCap, Trophy } from 'lucide-react'
import WeeklyStats from './components/WeeklyStats'
import SessionList from './components/SessionList'
import Savings from './components/Savings'
import HowItWorks from './components/HowItWorks'
import Guide from './components/Guide'
import Awards from './components/Awards'
import { isDemoMode } from './lib/api'
import './App.css'

function App() {
  const demo = isDemoMode()

  return (
    <div className="app">
      <nav className="nav">
        <div className="nav-inner">
          <div className="nav-brand">
            <Droplets size={22} className="nav-logo" />
            <span className="nav-title">PromptFootprint</span>
          </div>
          <div className="nav-links">
            <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <BarChart3 size={16} /><span>Weekly Stats</span>
            </NavLink>
            <NavLink to="/sessions" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <Zap size={16} /><span>Sessions</span>
            </NavLink>
            <NavLink to="/savings" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <Leaf size={16} /><span>Savings</span>
            </NavLink>
            <NavLink to="/learn" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <GraduationCap size={16} /><span>Learn</span>
            </NavLink>
            <NavLink to="/how" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <BookOpen size={16} /><span>How It Works</span>
            </NavLink>
            <NavLink to="/awards" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <Trophy size={16} /><span>Awards</span>
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
          <Route path="/" element={<WeeklyStats />} />
          <Route path="/sessions" element={<SessionList />} />
          <Route path="/savings" element={<Savings />} />
          <Route path="/learn" element={<Guide />} />
          <Route path="/how" element={<HowItWorks />} />
          <Route path="/awards" element={<Awards />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
