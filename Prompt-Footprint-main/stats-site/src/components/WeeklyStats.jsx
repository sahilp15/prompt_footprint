import { Zap, Droplets, Wind, TrendingUp, Hash, Leaf } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import { useWeeklyStats } from '../hooks/useStats'
import Globe from './ui/globe-cdn'
import './WeeklyStats.css'

function MetricCard({ icon: Icon, label, value, unit, color }) {
  return (
    <div className="metric-card">
      <div className="metric-icon" style={{ background: `${color}18`, color }}>
        <Icon size={20} />
      </div>
      <div className="metric-value">
        <span className="metric-number">{value}</span>
        <span className="metric-unit">{unit}</span>
      </div>
      <div className="metric-label">{label}</div>
    </div>
  )
}

const MultiTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  const entry = payload[0].payload
  return (
    <div className="chart-tooltip">
      <div className="tooltip-date">{label}</div>
      <div className="tooltip-row">
        <span className="tooltip-dot" style={{ background: '#C17F24' }} />
        <span className="tooltip-label">Energy:</span>
        <span className="tooltip-value">{entry.energyWh.toFixed(5)} Wh</span>
      </div>
      <div className="tooltip-row">
        <span className="tooltip-dot" style={{ background: '#2E6B8A' }} />
        <span className="tooltip-label">Water:</span>
        <span className="tooltip-value">{entry.waterMl.toFixed(4)} mL</span>
      </div>
      <div className="tooltip-row">
        <span className="tooltip-dot" style={{ background: '#8B7355' }} />
        <span className="tooltip-label">CO2:</span>
        <span className="tooltip-value">{entry.co2G.toFixed(5)} g</span>
      </div>
    </div>
  )
}

export default function WeeklyStats() {
  const { data, loading, error } = useWeeklyStats()

  if (loading) return <div className="page-loading">Loading your weekly data...</div>
  if (error) return (
    <div className="page-error">
      <Wind size={40} />
      <p>Could not connect to server. Make sure the backend is running on port 3001.</p>
    </div>
  )

  const { totals, daily } = data || { totals: {}, daily: [] }
  const fmt = (v, d = 4) => (v || 0).toFixed(d)

  const fmtDate = d => new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  const maxEnergy = Math.max(...(daily || []).map(d => d.energyWh || 0), 1e-9)
  const maxWater  = Math.max(...(daily || []).map(d => d.waterMl  || 0), 1e-9)
  const maxCo2    = Math.max(...(daily || []).map(d => d.co2G     || 0), 1e-9)

  const chartData = (daily || []).map(d => ({
    date:     fmtDate(d.date),
    energyWh: d.energyWh || 0,
    waterMl:  d.waterMl  || 0,
    co2G:     d.co2G     || 0,
    Energy:   ((d.energyWh || 0) / maxEnergy) * 100,
    Water:    ((d.waterMl  || 0) / maxWater)  * 100,
    CO2:      ((d.co2G     || 0) / maxCo2)    * 100,
  }))

  return (
    <div className="weekly-page">
      {/* About Our Mission */}
      <section className="mission-section">
        <div className="mission-inner">
          <div className="mission-text">
            <div className="mission-badge">
              <Leaf size={13} />
              <span>About Our Mission</span>
            </div>
            <h2 className="mission-heading">Every Prompt Has a Price</h2>
            <p className="mission-body">
              AI models run in massive data centers that consume enormous amounts of electricity and water for cooling.
              Each token you generate contributes to real-world energy use, water evaporation, and carbon emissions.
              PromptFootprint makes that invisible cost visible — so you can make informed choices about your AI usage.
            </p>
            <div className="mission-pills">
              <span className="mission-pill">🌊 Water-cooled data centers</span>
              <span className="mission-pill">⚡ Grid-powered inference</span>
              <span className="mission-pill">🌍 8 key data centers tracked</span>
            </div>
            <p className="mission-note">
              The globe shows 8 major AI data center regions. Larger dots indicate higher
              carbon intensity and water stress — regions where your prompts have the biggest footprint.
            </p>
          </div>
          <div className="mission-globe">
            <Globe />
          </div>
        </div>
      </section>

      <div className="page-header">
        <h1 className="page-title">Weekly Impact</h1>
        <p className="page-subtitle">Your AI environmental footprint for the past 7 days</p>
      </div>

      <div className="metrics-grid">
        <MetricCard icon={Hash} label="Total Tokens" value={(totals.totalTokens || 0).toLocaleString()} unit="" color="var(--accent-green)" />
        <MetricCard icon={Zap} label="Energy Used" value={fmt(totals.totalEnergyWh, 3)} unit="Wh" color="var(--accent-amber)" />
        <MetricCard icon={Droplets} label="Water Used" value={fmt(totals.totalWaterMl, 3)} unit="mL" color="var(--accent-blue)" />
        <MetricCard icon={Wind} label="CO2 Emitted" value={fmt(totals.totalCo2G, 3)} unit="g" color="var(--text-secondary)" />
        <MetricCard icon={TrendingUp} label="Sessions" value={totals.sessionCount || 0} unit="" color="var(--accent-red)" />
      </div>

      <div className="chart-section">
        <h2 className="section-title">Daily Breakdown</h2>

        <div className="chart-card">
          <div className="chart-label">Daily Impact — % of week's peak per metric</div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
              <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis
                tickFormatter={v => `${Math.round(v)}%`}
                domain={[0, 100]}
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={42}
              />
              <Tooltip content={<MultiTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12, color: 'var(--text-secondary)' }} />
              <Line type="monotone" dataKey="Energy" stroke="#C17F24" strokeWidth={2} dot={false} name="Energy (Wh)" />
              <Line type="monotone" dataKey="Water"  stroke="#2E6B8A" strokeWidth={2} dot={false} name="Water (mL)" />
              <Line type="monotone" dataKey="CO2"    stroke="#8B7355" strokeWidth={2} dot={false} name="CO2 (g)" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
