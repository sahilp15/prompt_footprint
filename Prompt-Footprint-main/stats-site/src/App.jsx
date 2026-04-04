import { Routes, Route, NavLink, useSearchParams } from 'react-router-dom'
import { Droplets, Zap, Wind, BarChart3, Sparkles } from 'lucide-react'
import WeeklyStats from './components/WeeklyStats'
import SessionList from './components/SessionList'
import AnimationPage from './components/AnimationPage'
import './App.css'

function App() {
  const [searchParams] = useSearchParams()
  const userId = searchParams.get('userId')
  const q = userId ? `?userId=${userId}` : ''

  return (
    <div className="app">
      <nav className="nav">
        <div className="nav-inner">
          <div className="nav-brand">
            <Droplets size={22} className="nav-logo" />
            <span className="nav-title">PromptFootprint</span>
          </div>
          <div className="nav-links">
            <NavLink to={`/${q}`} end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <BarChart3 size={16} /><span>Weekly Stats</span>
            </NavLink>
            <NavLink to={`/sessions${q}`} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <Zap size={16} /><span>Sessions</span>
            </NavLink>
            <NavLink to={`/animations${q}`} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <Sparkles size={16} /><span>Visualize</span>
            </NavLink>
          </div>
        </div>
      </nav>

      <main className="main">
        {!userId ? (
          <div className="empty-state">
            <Wind size={48} className="empty-icon" />
            <h2>No User ID Provided</h2>
            <p>Open this page from the PromptFootprint extension to view your environmental stats.</p>
          </div>
        ) : (
          <Routes>
            <Route path="/" element={<WeeklyStats />} />
            <Route path="/sessions" element={<SessionList />} />
            <Route path="/animations" element={<AnimationPage />} />
          </Routes>
        )}
      </main>
    </div>
  )
}

export default App
