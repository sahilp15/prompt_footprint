import { Zap, Droplets, Wind, TrendingUp, Hash } from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts'
import { useWeeklyStats } from '../hooks/useStats'
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

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <div className="tooltip-date">{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="tooltip-row">
          <span className="tooltip-dot" style={{ background: p.color }} />
          <span className="tooltip-label">{p.name}:</span>
          <span className="tooltip-value">{p.value?.toFixed(4)}</span>
        </div>
      ))}
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

  const chartData = (daily || []).map(d => ({
    date: new Date(d.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    Energy: parseFloat(d.energyWh?.toFixed(5) || 0),
    Water: parseFloat(d.waterMl?.toFixed(4) || 0),
    CO2: parseFloat(d.co2G?.toFixed(5) || 0),
  }))

  return (
    <div className="weekly-page">
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
          <div className="chart-label">Energy (Wh)</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="gradEnergy" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#FBBF24" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#FBBF24" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1F1F23" />
              <XAxis dataKey="date" tick={{ fill: '#6E6E73', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6E6E73', fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="Energy" stroke="#FBBF24" strokeWidth={2} fill="url(#gradEnergy)" name="Energy (Wh)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <div className="chart-label">Water (mL)</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="gradWater" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#60A5FA" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#60A5FA" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1F1F23" />
              <XAxis dataKey="date" tick={{ fill: '#6E6E73', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6E6E73', fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="Water" stroke="#60A5FA" strokeWidth={2} fill="url(#gradWater)" name="Water (mL)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <div className="chart-label">CO2 (g)</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="gradCo2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#A1A1A6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#A1A1A6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1F1F23" />
              <XAxis dataKey="date" tick={{ fill: '#6E6E73', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6E6E73', fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="CO2" stroke="#A1A1A6" strokeWidth={2} fill="url(#gradCo2)" name="CO2 (g)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
