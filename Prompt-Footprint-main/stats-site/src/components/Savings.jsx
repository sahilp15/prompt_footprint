import { useMemo } from 'react'
import {
  Leaf, Hash, Zap, Droplets, Wind, MousePointerClick, CloudOff, RefreshCw, Sparkles,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { useSavings } from '../hooks/useStats'
import { useCountUp, useReveal } from '../hooks/useMotion'
import WaterTank from '../animations/WaterTank'
import LightBulb from '../animations/LightBulb'
import GasTank from '../animations/GasTank'
import { Spotlight } from './ui/spotlight'
import { formatDayLabel } from '../lib/dates'
import { formatValue, formatCompact, changeVs } from '../lib/metrics'
import Reveal from './ui/Reveal'
import Sparkline from './ui/Sparkline'
// Reuse the metric/chart styles (WeeklyStats.css is always bundled via the home
// route) and the animation-grid layout from AnimationPage.css.
import './AnimationPage.css'
import './Savings.css'

const SAVED_METRICS = [
  { id: 'tokens', label: 'Tokens saved', icon: Hash, hex: '#5B7C3A', unit: '', totalKey: 'totalTokensSaved', dailyKey: 'tokens', format: (v) => Math.round(v).toLocaleString() },
  { id: 'energy', label: 'Energy saved', icon: Zap, hex: '#C17F24', unit: 'Wh', totalKey: 'totalEnergyWh', dailyKey: 'energyWh', format: formatValue },
  { id: 'water', label: 'Water saved', icon: Droplets, hex: '#2E6B8A', unit: 'mL', totalKey: 'totalWaterMl', dailyKey: 'waterMl', format: formatValue },
  { id: 'carbon', label: 'CO₂ avoided', icon: Wind, hex: '#8B7355', unit: 'g', totalKey: 'totalCo2G', dailyKey: 'co2G', format: formatValue },
  { id: 'applied', label: 'Times applied', icon: MousePointerClick, hex: '#A0522D', unit: '', totalKey: 'applyCount', dailyKey: 'count', format: (v) => Math.round(v).toLocaleString() },
]

/** Savings invert the usual polarity: saving more is the good direction. */
function SavedDelta({ change }) {
  if (!change || change.direction === 'flat') {
    return <span className="pf-delta pf-delta-flat">{change ? '0%' : 'new'}</span>
  }
  const rising = change.direction === 'up'
  return (
    <span className={`pf-delta ${rising ? 'pf-delta-good' : 'pf-delta-up'}`}>
      {rising ? '+' : '−'}{Math.abs(change.pct).toFixed(0)}%
    </span>
  )
}

function SavedCard({ metric, total, previous, series, index }) {
  const [ref, visible] = useReveal({ threshold: 0.3 })
  const animated = useCountUp(total, visible, { duration: 950 + index * 90 })
  const Icon = metric.icon

  return (
    <div
      ref={ref}
      className={`metric-card pf-reveal pf-reveal-pop${visible ? ' is-visible' : ''}`}
      style={{ '--metric': metric.hex, '--reveal-delay': `${index * 60}ms` }}
    >
      <div className="metric-top">
        <span className="metric-icon"><Icon size={19} aria-hidden="true" /></span>
        <SavedDelta change={changeVs(total, previous)} />
      </div>
      <div className="metric-body">
        <div className="metric-value">
          <span className="metric-number">{metric.format(animated)}</span>
          {metric.unit && <span className="metric-unit">{metric.unit}</span>}
        </div>
        <div className="metric-label">{metric.label}</div>
      </div>
      <Sparkline values={series} color={metric.hex} active={visible} height={40} />
    </div>
  )
}

function SavingsTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const e = payload[0].payload
  return (
    <div className="chart-tooltip">
      <div className="tooltip-date">{e.full || label}</div>
      <div className="tooltip-row">
        <span className="tooltip-dot" style={{ background: '#5B7C3A' }} />
        <span className="tooltip-label">Tokens saved</span>
        <span className="tooltip-value">{e.tokens.toLocaleString()}</span>
      </div>
      <div className="tooltip-row">
        <span className="tooltip-dot" style={{ background: '#8B7355' }} />
        <span className="tooltip-label">Suggestions applied</span>
        <span className="tooltip-value">{e.count}×</span>
      </div>
      {e.energyWh > 0 && (
        <div className="tooltip-foot">
          ≈ {formatValue(e.energyWh)} Wh · {formatValue(e.waterMl)} mL · {formatValue(e.co2G)} g CO₂ avoided
        </div>
      )}
    </div>
  )
}

export default function Savings() {
  const { data, loading, error, reload } = useSavings()

  const model = useMemo(() => {
    const s = data || {}
    const daily = s.daily || {}
    // The ledger can hold more than a week; the page reports the last 7 days.
    const keys = Object.keys(daily).sort().slice(-7)
    const chartData = keys.map((k) => ({
      date: formatDayLabel(k),
      full: formatDayLabel(k, { weekday: 'long', month: 'short', day: 'numeric' }),
      tokens: daily[k].tokens || 0,
      count: daily[k].count || 0,
      energyWh: daily[k].energyWh || 0,
      waterMl: daily[k].waterMl || 0,
      co2G: daily[k].co2G || 0,
    }))
    return { s, chartData, previous: s.previous || {} }
  }, [data])

  if (loading) {
    return (
      <div className="pf-page savings-page" aria-busy="true">
        <span className="sr-only">Loading your savings…</span>
        <div className="page-header">
          <div className="pf-skeleton" style={{ width: 170, height: 24, borderRadius: 999 }} />
          <div className="pf-skeleton" style={{ width: 280, height: 34 }} />
          <div className="pf-skeleton" style={{ width: '55%', height: 16 }} />
        </div>
        <div className="metrics-grid">
          {SAVED_METRICS.map((m) => (
            <div className="pf-skeleton-card" key={m.id}>
              <div className="pf-skeleton" style={{ width: 38, height: 38, borderRadius: 11 }} />
              <div className="pf-skeleton" style={{ width: '60%', height: 26 }} />
              <div className="pf-skeleton" style={{ width: '44%', height: 12 }} />
            </div>
          ))}
        </div>
        <div className="pf-skeleton" style={{ height: 300, borderRadius: 'var(--radius-lg)' }} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="pf-state pf-state-error" role="alert">
        <span className="pf-state-icon"><CloudOff size={26} aria-hidden="true" /></span>
        <h2>Couldn’t load your savings</h2>
        <p>The savings ledger lives on this device. Nothing was lost — the read just failed.</p>
        <p className="pf-state-detail">{error}</p>
        <button type="button" className="pf-btn" onClick={reload}>
          <RefreshCw size={15} aria-hidden="true" /> Try again
        </button>
      </div>
    )
  }

  const { s, chartData, previous } = model
  const hasSavings = (s.applyCount || 0) > 0

  return (
    <div className="pf-page savings-page">
      <Reveal className="page-header">
        <span className="pf-eyebrow"><Leaf size={12} aria-hidden="true" /> Energy Saver</span>
        <h1 className="page-title">What you didn’t spend</h1>
        <p className="page-subtitle">
          Tokens — and the energy, water, and CO₂ behind them — you avoided by applying
          shorter-prompt suggestions. Only suggestions you actually applied count.
        </p>
      </Reveal>

      {!hasSavings ? (
        <div className="pf-state savings-empty">
          <span className="pf-state-icon"><Leaf size={26} aria-hidden="true" /></span>
          <h2>No savings yet</h2>
          <p>
            When the Energy Saver suggests a shorter prompt on ChatGPT or Claude,
            click <strong>Apply</strong> — the tokens, energy, water, and CO₂ you
            save get totalled here.
          </p>
          <p className="savings-empty-hint">
            <Sparkles size={13} aria-hidden="true" />
            The Token Cutter tab does the same thing for a draft you paste in.
          </p>
        </div>
      ) : (
        <>
          <section aria-label="Savings totals" className="metrics-grid">
            {SAVED_METRICS.map((m, i) => (
              <SavedCard
                key={m.id}
                metric={m}
                index={i}
                total={s[m.totalKey] || 0}
                previous={previous[m.totalKey] || 0}
                series={chartData.map((d) => d[m.dailyKey] || 0)}
              />
            ))}
          </section>

          <Reveal className="chart-card">
            <div className="chart-head">
              <div>
                <h2 className="chart-title">Savings over time</h2>
                <p className="chart-label">Tokens you avoided sending, per day, over the last 7 days.</p>
              </div>
            </div>
            <div className="chart-plot">
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="fill-savings" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#5B7C3A" stopOpacity={0.32} />
                      <stop offset="100%" stopColor="#5B7C3A" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 6" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} dy={6} />
                  <YAxis
                    tickFormatter={formatCompact}
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={46}
                    allowDecimals={false}
                  />
                  <Tooltip
                    content={<SavingsTooltip />}
                    cursor={{ stroke: '#5B7C3A', strokeWidth: 1, strokeDasharray: '3 4', strokeOpacity: 0.5 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="tokens"
                    name="Tokens saved"
                    stroke="#5B7C3A"
                    strokeWidth={2.4}
                    fill="url(#fill-savings)"
                    dot={{ r: 0 }}
                    activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--bg-card)' }}
                    animationDuration={1000}
                    animationEasing="ease-out"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Reveal>

          {/* The three signature gauges. Each fills to the amount saved. */}
          <Reveal as="section" className="anim-grid-section">
            <div className="pf-section-bar">
              <div>
                <h2 className="chart-title">Savings, visualised</h2>
                <p className="chart-label">The same totals, filling three familiar containers.</p>
              </div>
            </div>
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
          </Reveal>
        </>
      )}
    </div>
  )
}
