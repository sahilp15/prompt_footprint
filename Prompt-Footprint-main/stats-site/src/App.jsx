import { Component } from 'react'
import { Routes, Route, NavLink } from 'react-router-dom'
import { Droplets, Zap, BarChart3, Sparkles, BookOpen, GraduationCap, Trophy } from 'lucide-react'
import WeeklyStats from './components/WeeklyStats'
import SessionList from './components/SessionList'
import AnimationPage from './components/AnimationPage'
import HowItWorks from './components/HowItWorks'
import Guide from './components/Guide'
import Awards from './components/Awards'
import { isDemoMode } from './lib/api'
import './App.css'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#6B7D5E' }}>
          <p>3D animations couldn't load in this context.</p>
          <button onClick={() => this.setState({ hasError: false })} style={{ marginTop: '1rem', padding: '0.5rem 1rem', cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

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
            <NavLink to="/animations" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <Sparkles size={16} /><span>Visualize</span>
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
          <Route path="/animations" element={<ErrorBoundary><AnimationPage /></ErrorBoundary>} />
          <Route path="/learn" element={<Guide />} />
          <Route path="/how" element={<HowItWorks />} />
          <Route path="/awards" element={<Awards />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
