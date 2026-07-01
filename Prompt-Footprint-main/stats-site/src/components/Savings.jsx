import { Leaf, Hash, Zap, Droplets, Wind, MousePointerClick } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'
import { useSavings } from '../hooks/useStats'
import WaterTank from '../animations/WaterTank'
import LightBulb from '../animations/LightBulb'
import GasTank from '../animations/GasTank'
import { Spotlight } from './ui/spotlight'
// Reuse the metric/chart styles (WeeklyStats.css is always bundled via the home
// route) and the animation-grid layout from AnimationPage.css.
import './AnimationPage.css'
import './Savings.css'

function StatCard({ icon: Icon, label, value, unit, color }) {
  return (
    <div className="metric-card">
      <div className="metric-icon" style={{ background: `${color}18`, color }}>
        <Icon size={20} />
      </div>
      <div className="metric-value">
        <span className="metric-number">{value}</span>
        {unit && <span className="metric-unit">{unit}</span>}
      </div>
      <div className="metric-label">{label}</div>
    </div>
  )
}

const SavingsTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  const e = payload[0].payload
  return (
    <div className="chart-tooltip">
      <div className="tooltip-date">{label}</div>
      <div className="tooltip-row">
        <span className="tooltip-dot" style={{ background: '#5B7C3A' }} />
        <span className="tooltip-label">Tokens saved:</span>
        <span className="tooltip-value">{e.tokens.toLocaleString()}</span>
      </div>
      <div className="tooltip-row">
        <span className="tooltip-dot" style={{ background: '#8B7355' }} />
        <span className="tooltip-label">Applied:</span>
        <span className="tooltip-value">{e.count}×</span>
      </div>
    </div>
  )
}

export default function Savings() {
  const { data, loading, error } = useSavings()

  if (loading) return <div className="page-loading">Loading your savings...</div>
  if (error) return (
    <div className="page-error">
      <Wind size={40} />
      <p>Could not load savings: {error}</p>
    </div>
  )

  const s = data || {}
  const fmt = (v, d = 4) => (v || 0).toFixed(d)
  const fmtDate = d => new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  const daily = s.daily || {}
  const chartData = Object.keys(daily).sort().map(k => ({
    date: fmtDate(k),
    tokens: daily[k].tokens || 0,
    count: daily[k].count || 0,
  }))

  const hasSavings = (s.applyCount || 0) > 0

  return (
    <div className="weekly-page savings-page">
      <div className="page-header">
        <div className="mission-badge">
          <Leaf size={13} />
          <span>Energy Saver</span>
        </div>
        <h1 className="page-title">Your savings</h1>
        <p className="page-subtitle">
          Tokens — and the energy, water, and CO₂ behind them — you avoided by applying
          shorter-prompt suggestions.
        </p>
      </div>

      {!hasSavings ? (
        <div className="savings-empty">
          <Leaf size={36} style={{ color: 'var(--accent-green)' }} />
          <h2>No savings yet</h2>
          <p>
            When the Energy Saver suggests a shorter prompt on ChatGPT or Claude,
            click <strong>Apply</strong> — the tokens, energy, water, and CO₂ you
            save will be totaled here.
          </p>
        </div>
      ) : (
        <>
          <div className="metrics-grid">
            <StatCard icon={Hash} label="Tokens Saved" value={(s.totalTokensSaved || 0).toLocaleString()} unit="" color="var(--accent-green)" />
            <StatCard icon={Zap} label="Energy Saved" value={fmt(s.totalEnergyWh, 3)} unit="Wh" color="var(--accent-amber)" />
            <StatCard icon={Droplets} label="Water Saved" value={fmt(s.totalWaterMl, 3)} unit="mL" color="var(--accent-blue)" />
            <StatCard icon={Wind} label="CO2 Avoided" value={fmt(s.totalCo2G, 3)} unit="g" color="var(--text-secondary)" />
            <StatCard icon={MousePointerClick} label="Times Applied" value={s.applyCount || 0} unit="" color="var(--accent-red)" />
          </div>

          <div className="chart-section">
            <h2 className="section-title">Savings Over Time</h2>
            <div className="chart-card">
              <div className="chart-label">Tokens saved per day (last 7 days)</div>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                  <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={42} allowDecimals={false} />
                  <Tooltip content={<SavingsTooltip />} />
                  <Line type="monotone" dataKey="tokens" stroke="#5B7C3A" strokeWidth={2} dot={{ r: 3 }} name="Tokens saved" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="anim-grid-section">
            <h2 className="section-title">Savings, visualized</h2>
            <div className="anim-grid">
              <div className="anim-card-outer">
                <Spotlight className="-top-20 left-0" fill="#4AADB5" />
                <WaterTank waterMl={s.totalWaterMl || 0} />
              </div>
              <div className="anim-card-outer">
                <Spotlight className="-top-20 left-0" fill="#D4A843" />
                <LightBulb energyWh={s.totalEnergyWh || 0} />
              </div>
              <div className="anim-card-outer">
                <Spotlight className="-top-20 left-0" fill="#7A8C5A" />
                <GasTank co2G={s.totalCo2G || 0} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
