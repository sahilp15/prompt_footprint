import { useEffect, useMemo, useState } from 'react'
import {
  Zap, Droplets, Wind, Hash, Leaf, MessageSquare, Activity, Info,
  TrendingUp, TrendingDown, Minus, RefreshCw, CloudOff, Sparkles, Globe2,
} from 'lucide-react'
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { useWeeklyStats } from '../hooks/useStats'
import { useCountUp, useReveal } from '../hooks/useMotion'
import { formatDayLabel } from '../lib/dates'
import { formatValue, formatCompact, changeVs, equivalents, peakDay, isEmptyPeriod } from '../lib/metrics'
import { authStatus, greetingName, isSignedIn, isExtensionRuntime } from '../lib/auth'
import { fetchConfig } from '../lib/api'
import WeatherCard from './WeatherCard'
import Reveal from './ui/Reveal'
import Sparkline from './ui/Sparkline'
import Globe from './ui/globe-cdn'
import { REGIONS, intensityShare } from '../lib/regions'
import './WeeklyStats.css'

// Resolve a friendly name for the greeting: signed-in display name (or email
// guess), else a locally saved name for local-only users, else nothing.
function useGreeting() {
  const [name, setName] = useState(null)
  useEffect(() => {
    let done = false
    async function run() {
      if (isExtensionRuntime()) {
        const s = await authStatus()
        const n = isSignedIn(s) ? greetingName(s) : null
        if (n) { if (!done) setName(n); return }
      }
      const cfg = await fetchConfig()
      if (!done && cfg && typeof cfg.displayName === 'string' && cfg.displayName.trim()) {
        setName(cfg.displayName.trim())
      }
    }
    run()
    return () => { done = true }
  }, [])
  return name
}

/* ── Metric definitions ─────────────────────────────────────────────────────
   One row per headline number. `hex` duplicates `color` because Recharts and
   inline SVG need a literal, not a CSS variable. */
const METRICS = [
  {
    id: 'tokens',
    label: 'Tokens',
    icon: Hash,
    hex: '#5B7C3A',
    unit: '',
    totalKey: 'totalTokens',
    dailyKey: 'tokens',
    format: (v) => Math.round(v).toLocaleString(),
    info: 'Every piece of text the model read and wrote — roughly ¾ of a word each. Every other number here is derived from this one.',
  },
  {
    id: 'energy',
    label: 'Energy',
    icon: Zap,
    hex: '#C17F24',
    unit: 'Wh',
    totalKey: 'totalEnergyWh',
    dailyKey: 'energyWh',
    format: (v) => formatValue(v),
    info: 'Estimated electricity used by the data-center GPUs, in watt-hours.',
  },
  {
    id: 'water',
    label: 'Water',
    icon: Droplets,
    hex: '#2E6B8A',
    unit: 'mL',
    totalKey: 'totalWaterMl',
    dailyKey: 'waterMl',
    format: (v) => formatValue(v),
    info: 'Fresh water evaporated to cool the hardware — at the data center and at the power plant feeding it.',
  },
  {
    id: 'carbon',
    label: 'CO₂',
    icon: Wind,
    hex: '#8B7355',
    unit: 'g',
    totalKey: 'totalCo2G',
    dailyKey: 'co2G',
    format: (v) => formatValue(v),
    info: 'Grams of CO₂-equivalent from generating that electricity, at a mid-range grid intensity.',
  },
  {
    id: 'prompts',
    label: 'Prompts',
    icon: MessageSquare,
    hex: '#A0522D',
    unit: '',
    totalKey: 'queryCount',
    dailyKey: 'queries',
    format: (v) => Math.round(v).toLocaleString(),
    info: 'Messages you sent across ChatGPT and Claude in this period.',
  },
]

/* Energy, water, and CO₂ all scale off the same token count, so on the
   normalized overview they frequently land on exactly the same path. Distinct
   dash patterns keep all three readable when they coincide instead of letting
   the last one drawn hide the other two. */
const SERIES_DASH = {
  energy: null,
  water: '7 4',
  carbon: '1.5 4',
}

/** Key of the "% of this week's peak" field each series reads on the overview. */
const SERIES_NORM = {
  energy: 'Energy',
  water: 'Water',
  carbon: 'CO2',
}

const SERIES = METRICS
  .filter((m) => ['energy', 'water', 'carbon'].includes(m.id))
  .map((m) => ({ ...m, dash: SERIES_DASH[m.id], normKey: SERIES_NORM[m.id] }))

const VIEWS = [
  { id: 'overview', label: 'Overview' },
  ...SERIES.map((m) => ({ id: m.id, label: m.label, hex: m.hex })),
]

/* ── Small parts ──────────────────────────────────────────────────────────── */

/** A hover/focus explainer. Rendered as a button so keyboards reach it too. */
function InfoTip({ text, label }) {
  return (
    <button type="button" className="pf-info" aria-label={label ? `About ${label}` : 'More information'}>
      <Info size={13} aria-hidden="true" />
      <span className="pf-info-bubble" role="tooltip">{text}</span>
    </button>
  )
}

function DeltaPill({ change, invert = false, compact = false }) {
  if (!change) {
    return <span className="pf-delta pf-delta-flat" title="No data for the previous period">new</span>
  }
  const { pct, direction } = change
  if (direction === 'flat') {
    return <span className="pf-delta pf-delta-flat"><Minus size={11} aria-hidden="true" />0%</span>
  }
  const rising = direction === 'up'
  // On footprint metrics an increase is the bad direction; on savings it isn't.
  const good = invert ? rising : !rising
  const Icon = rising ? TrendingUp : TrendingDown
  return (
    <span className={`pf-delta ${good ? 'pf-delta-down' : 'pf-delta-up'}`}>
      <Icon size={11} aria-hidden="true" />
      {rising ? '+' : '−'}{Math.abs(pct) >= 100 ? Math.round(Math.abs(pct)) : Math.abs(pct).toFixed(0)}%
      {!compact && <span className="pf-delta-vs">vs last week</span>}
    </span>
  )
}

/**
 * One headline number. The value counts up from zero when the tile scrolls
 * into view, and the sparkline draws itself in behind it.
 */
function MetricCard({ metric, total, previous, series, index }) {
  const [ref, visible] = useReveal({ threshold: 0.3 })
  const animated = useCountUp(total, visible, { duration: 950 + index * 90 })
  const change = changeVs(total, previous)
  const Icon = metric.icon

  return (
    <div
      ref={ref}
      className={`metric-card pf-reveal pf-reveal-pop${visible ? ' is-visible' : ''}`}
      style={{ '--metric': metric.hex, '--reveal-delay': `${index * 60}ms` }}
    >
      <div className="metric-top">
        <span className="metric-icon"><Icon size={19} aria-hidden="true" /></span>
        <DeltaPill change={change} compact />
      </div>

      <div className="metric-body">
        <div className="metric-value">
          <span className="metric-number">{metric.format(animated)}</span>
          {metric.unit && <span className="metric-unit">{metric.unit}</span>}
        </div>
        <div className="metric-label">
          {metric.label}
          <InfoTip text={metric.info} label={metric.label} />
        </div>
      </div>

      <Sparkline values={series} color={metric.hex} active={visible} height={40} />
    </div>
  )
}

/** Tooltip for the normalized overview: shows the real values, not the %. */
function OverviewTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="chart-tooltip">
      <div className="tooltip-date">{d.full || label}</div>
      {SERIES.map((m) => (
        <div className="tooltip-row" key={m.id}>
          <span className="tooltip-dot" style={{ background: m.hex }} />
          <span className="tooltip-label">{m.label}</span>
          <span className="tooltip-value">{formatValue(d[m.dailyKey])}{m.unit && ` ${m.unit}`}</span>
        </div>
      ))}
      <div className="tooltip-foot">{d.queries} prompt{d.queries === 1 ? '' : 's'} · {Math.round(d.tokens).toLocaleString()} tokens</div>
    </div>
  )
}

/** Tooltip for a single-metric view: this week against the same day last week. */
function SeriesTooltip({ active, payload, label, metric }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const value = d[metric.dailyKey]
  const prior = d[`prev_${metric.dailyKey}`]
  const change = changeVs(value, prior)
  return (
    <div className="chart-tooltip">
      <div className="tooltip-date">{d.full || label}</div>
      <div className="tooltip-row">
        <span className="tooltip-dot" style={{ background: metric.hex }} />
        <span className="tooltip-label">This week</span>
        <span className="tooltip-value">{formatValue(value)}{metric.unit && ` ${metric.unit}`}</span>
      </div>
      <div className="tooltip-row">
        <span className="tooltip-dot tooltip-dot-ghost" />
        <span className="tooltip-label">Week before</span>
        <span className="tooltip-value">{formatValue(prior)}{metric.unit && ` ${metric.unit}`}</span>
      </div>
      <div className="tooltip-foot">
        {change
          ? `${change.direction === 'up' ? '↑' : change.direction === 'down' ? '↓' : '→'} ${Math.abs(change.pct).toFixed(0)}% against the same day`
          : 'No matching day last week'}
      </div>
    </div>
  )
}

/** A paired bar: this week over last week, on a shared scale. */
function ComparisonRow({ metric, current, previous, visible, index }) {
  const max = Math.max(current, previous, 1e-9)
  const nowPct = (current / max) * 100
  const thenPct = (previous / max) * 100
  const change = changeVs(current, previous)

  return (
    <div className="wk-cmp-row" style={{ '--metric': metric.hex, '--reveal-delay': `${index * 90}ms` }}>
      <div className="wk-cmp-head">
        <span className="wk-cmp-name">{metric.label}</span>
        <DeltaPill change={change} compact />
      </div>
      <div className="wk-cmp-bars">
        <div className="wk-cmp-track">
          <span
            className="wk-cmp-fill wk-cmp-now"
            style={{ width: visible ? `${nowPct}%` : 0 }}
          />
        </div>
        <div className="wk-cmp-track">
          <span
            className="wk-cmp-fill wk-cmp-then"
            style={{ width: visible ? `${thenPct}%` : 0, transitionDelay: '90ms' }}
          />
        </div>
      </div>
      <div className="wk-cmp-foot">
        <span><i className="wk-cmp-key wk-cmp-key-now" /> {formatValue(current)}{metric.unit && ` ${metric.unit}`}</span>
        <span><i className="wk-cmp-key wk-cmp-key-then" /> {formatValue(previous)}{metric.unit && ` ${metric.unit}`}</span>
      </div>
    </div>
  )
}

/* ── States ───────────────────────────────────────────────────────────────── */

function LoadingState() {
  return (
    <div className="pf-page wk-page" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your weekly data…</span>
      <div className="wk-hero wk-hero-skeleton">
        <div className="wk-hero-copy">
          <div className="pf-skeleton" style={{ width: 150, height: 22, borderRadius: 999 }} />
          <div className="pf-skeleton" style={{ width: '72%', height: 40 }} />
          <div className="pf-skeleton" style={{ width: '92%', height: 16 }} />
          <div className="pf-skeleton" style={{ width: '58%', height: 16 }} />
        </div>
        <div className="pf-skeleton wk-hero-globe-skeleton" />
      </div>
      <div className="metrics-grid">
        {METRICS.map((m) => (
          <div className="pf-skeleton-card" key={m.id}>
            <div className="pf-skeleton" style={{ width: 38, height: 38, borderRadius: 11 }} />
            <div className="pf-skeleton" style={{ width: '65%', height: 26 }} />
            <div className="pf-skeleton" style={{ width: '45%', height: 12 }} />
            <div className="pf-skeleton" style={{ width: '100%', height: 34 }} />
          </div>
        ))}
      </div>
      <div className="pf-skeleton" style={{ height: 340, borderRadius: 'var(--radius-lg)' }} />
    </div>
  )
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="pf-state pf-state-error" role="alert">
      <span className="pf-state-icon"><CloudOff size={26} aria-hidden="true" /></span>
      <h2>We couldn’t load this week</h2>
      <p>Your data is stored on this device, so nothing is lost — the dashboard just failed to read it.</p>
      {message && <p className="pf-state-detail">{message}</p>}
      <button type="button" className="pf-btn" onClick={onRetry}>
        <RefreshCw size={15} aria-hidden="true" /> Try again
      </button>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="pf-state">
      <span className="pf-state-icon"><Leaf size={26} aria-hidden="true" /></span>
      <h2>Nothing tracked yet this week</h2>
      <p>
        Open ChatGPT or Claude with the PromptFootprint extension running. The moment
        you send a prompt, the energy, water, and CO₂ behind it start showing up here.
      </p>
    </div>
  )
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function WeeklyStats() {
  const { data, loading, error, reload } = useWeeklyStats()
  const name = useGreeting()
  const [view, setView] = useState('overview')
  const [cmpRef, cmpVisible] = useReveal({ threshold: 0.25 })

  const model = useMemo(() => {
    const totals = data?.totals || {}
    const daily = data?.daily || []
    const previous = data?.previous || {}
    const previousDaily = data?.previousDaily || []

    const maxOf = (key) => Math.max(...daily.map((d) => d[key] || 0), 1e-9)
    const peaks = { energyWh: maxOf('energyWh'), waterMl: maxOf('waterMl'), co2G: maxOf('co2G') }

    const chartData = daily.map((d, i) => {
      const prior = previousDaily[i] || {}
      return {
        date: formatDayLabel(d.date),
        full: formatDayLabel(d.date, { weekday: 'long', month: 'short', day: 'numeric' }),
        tokens: d.tokens || 0,
        queries: d.queries || 0,
        energyWh: d.energyWh || 0,
        waterMl: d.waterMl || 0,
        co2G: d.co2G || 0,
        prev_energyWh: prior.energyWh || 0,
        prev_waterMl: prior.waterMl || 0,
        prev_co2G: prior.co2G || 0,
        Energy: ((d.energyWh || 0) / peaks.energyWh) * 100,
        Water: ((d.waterMl || 0) / peaks.waterMl) * 100,
        CO2: ((d.co2G || 0) / peaks.co2G) * 100,
      }
    })

    const range = daily.length
      ? `${formatDayLabel(daily[0].date, { month: 'short', day: 'numeric' })} – ${formatDayLabel(daily[daily.length - 1].date, { month: 'short', day: 'numeric' })}`
      : ''

    return {
      totals, daily, previous, chartData, range,
      busiest: peakDay(daily, 'energyWh'),
      equiv: equivalents({
        energyWh: totals.totalEnergyWh || 0,
        waterMl: totals.totalWaterMl || 0,
        co2G: totals.totalCo2G || 0,
      }),
    }
  }, [data])

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} onRetry={reload} />

  const { totals, daily, previous, chartData, range, busiest, equiv } = model
  const empty = isEmptyPeriod(totals)
  const activeMetric = SERIES.find((m) => m.id === view) || null

  return (
    <div className="pf-page wk-page">
      {/* ── Hero: who, when, and the globe that gives it context ─────────── */}
      <Reveal className="wk-hero">
        <span className="wk-hero-glow" aria-hidden="true" />

        <div className="wk-hero-copy">
          <span className="pf-eyebrow">
            <Sparkles size={12} aria-hidden="true" />
            Last 7 days{range && ` · ${range}`}
          </span>
          <h1 className="page-title">
            {name ? <>Hi {name}, <span className="wk-hero-accent">here’s your week</span></> : <>Your week, <span className="wk-hero-accent">measured</span></>}
          </h1>
          <p className="page-subtitle">
            The estimated energy, water, and CO₂ behind your ChatGPT and Claude
            conversations — counted on this device, from the length of what was
            sent and received.
          </p>

          <div className="wk-glance">
            <span className="wk-glance-item">
              <Activity size={14} aria-hidden="true" />
              <strong>{(totals.sessionCount || 0).toLocaleString()}</strong> session{totals.sessionCount === 1 ? '' : 's'}
            </span>
            <span className="wk-glance-item">
              <MessageSquare size={14} aria-hidden="true" />
              <strong>{(totals.queryCount || 0).toLocaleString()}</strong> prompt{totals.queryCount === 1 ? '' : 's'}
            </span>
            {busiest && (busiest.energyWh || 0) > 0 && (
              <span className="wk-glance-item">
                <Zap size={14} aria-hidden="true" />
                busiest day <strong>{formatDayLabel(busiest.date, { weekday: 'long' })}</strong>
              </span>
            )}
          </div>
        </div>

        {/* The globe: eight major AI data-center regions, slowly turning.
            Draggable, with inertia — see ui/globe-cdn.jsx. */}
        <div className="wk-hero-globe">
          <span className="wk-globe-rings" aria-hidden="true" />
          <div className="mission-globe">
            <Globe />
          </div>
          <p className="wk-globe-caption">
            <Globe2 size={13} aria-hidden="true" />
            <span>8 major AI data-center regions · drag to spin</span>
          </p>
        </div>
      </Reveal>

      {empty ? (
        <EmptyState />
      ) : (
        <>
          {/* ── Headline metrics ───────────────────────────────────────── */}
          <section aria-label="This week's totals" className="metrics-grid">
            {METRICS.map((m, i) => (
              <MetricCard
                key={m.id}
                metric={m}
                index={i}
                total={totals[m.totalKey] || 0}
                previous={previous[m.totalKey] || 0}
                series={daily.map((d) => d[m.dailyKey] || 0)}
              />
            ))}
          </section>

          {/* ── Chart + comparison rail ────────────────────────────────── */}
          <section className="wk-analytics">
            <Reveal className="chart-card wk-chart">
              <div className="chart-head">
                <div>
                  <h2 className="chart-title">Daily breakdown</h2>
                  <p className="chart-label">
                    {activeMetric
                      ? `${activeMetric.label} per day, against the same day the week before`
                      : 'Each metric as a share of its own peak day, so all three fit one axis'}
                  </p>
                </div>
                <div className="pf-segmented" role="group" aria-label="Choose a metric">
                  {VIEWS.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className="pf-seg"
                      aria-pressed={view === v.id}
                      style={v.hex ? { '--seg-color': v.hex } : undefined}
                      onClick={() => setView(v.id)}
                    >
                      {v.hex && <span className="pf-seg-dot" aria-hidden="true" />}
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Keyed on the view so switching metrics re-runs the draw-in
                  animation rather than snapping to the new series. */}
              <div className="chart-plot" key={view}>
                <ResponsiveContainer width="100%" height={288}>
                  {activeMetric ? (
                    <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id={`fill-${activeMetric.id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={activeMetric.hex} stopOpacity={0.34} />
                          <stop offset="100%" stopColor={activeMetric.hex} stopOpacity={0.02} />
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
                      />
                      <Tooltip
                        content={<SeriesTooltip metric={activeMetric} />}
                        cursor={{ stroke: activeMetric.hex, strokeWidth: 1, strokeDasharray: '3 4', strokeOpacity: 0.5 }}
                      />
                      <Area
                        type="monotone"
                        dataKey={`prev_${activeMetric.dailyKey}`}
                        name="Week before"
                        stroke="var(--border-strong)"
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                        fill="none"
                        dot={false}
                        animationDuration={900}
                        animationEasing="ease-out"
                      />
                      <Area
                        type="monotone"
                        dataKey={activeMetric.dailyKey}
                        name={activeMetric.label}
                        stroke={activeMetric.hex}
                        strokeWidth={2.4}
                        fill={`url(#fill-${activeMetric.id})`}
                        dot={{ r: 0 }}
                        activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--bg-card)' }}
                        animationDuration={1000}
                        animationEasing="ease-out"
                      />
                    </AreaChart>
                  ) : (
                    <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="2 6" stroke="var(--border-subtle)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} dy={6} />
                      <YAxis
                        tickFormatter={(v) => `${Math.round(v)}%`}
                        domain={[0, 100]}
                        tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        width={46}
                      />
                      <Tooltip content={<OverviewTooltip />} cursor={{ stroke: 'var(--border)', strokeWidth: 1, strokeDasharray: '3 4' }} />
                      {SERIES.map((m, i) => (
                        <Line
                          key={m.id}
                          type="monotone"
                          dataKey={m.normKey}
                          name={`${m.label}${m.unit ? ` (${m.unit})` : ''}`}
                          stroke={m.hex}
                          strokeWidth={m.dash ? 2.2 : 2.6}
                          strokeDasharray={m.dash || undefined}
                          strokeLinecap="round"
                          dot={false}
                          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--bg-card)' }}
                          animationDuration={1000 + i * 120}
                          animationEasing="ease-out"
                        />
                      ))}
                    </LineChart>
                  )}
                </ResponsiveContainer>
              </div>

              {!activeMetric && (
                <div className="wk-legend">
                  {SERIES.map((m) => (
                    <span className="wk-legend-item" key={m.id}>
                      <i
                        className={`wk-legend-key wk-legend-key-${m.id}`}
                        style={{ '--metric': m.hex }}
                        aria-hidden="true"
                      />
                      {m.label} <span className="wk-legend-unit">{m.unit}</span>
                    </span>
                  ))}
                  <span className="wk-legend-note">
                    All three follow the same shape while your ChatGPT/Claude mix stays steady —
                    pick a metric above for real values.
                  </span>
                </div>
              )}
            </Reveal>

            <Reveal className="pf-panel pf-panel-pad wk-cmp" delay={60}>
              <div ref={cmpRef} className="wk-cmp-inner">
                <div className="wk-rail-head">
                  <h2 className="chart-title">This week vs last</h2>
                  <p className="chart-label">Solid is the last 7 days; the hatched bar is the 7 before it.</p>
                </div>
                {SERIES.map((m, i) => (
                  <ComparisonRow
                    key={m.id}
                    metric={m}
                    index={i}
                    current={totals[m.totalKey] || 0}
                    previous={previous[m.totalKey] || 0}
                    visible={cmpVisible}
                  />
                ))}
              </div>
            </Reveal>
          </section>

          {/* ── Everyday equivalents ───────────────────────────────────── */}
          <Reveal as="section" className="pf-panel pf-panel-pad wk-equiv">
            <div className="pf-section-bar">
              <div>
                <h2 className="chart-title">What that adds up to</h2>
                <p className="chart-label">Rough, everyday comparisons for this week’s totals.</p>
              </div>
              <p className="wk-equiv-note">
                Round reference figures — 9 W bulb, 50 W laptop, 250 mL glass, 120 g CO₂/km.
                For intuition, not accounting.
              </p>
            </div>
            <ul className="wk-equiv-list">
              {equiv.map((e) => (
                <li className={`wk-equiv-item wk-equiv-${e.metric}`} key={e.id} title={e.basis}>
                  <span className="wk-equiv-value">{e.value}</span>
                  <span className="wk-equiv-label">{e.label}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </>
      )}

      {/* ── Why this matters ───────────────────────────────────────────── */}
      <Reveal as="section" className="mission-section">
        <div className="mission-inner">
          <div className="mission-text">
            <div className="mission-badge">
              <Leaf size={13} aria-hidden="true" />
              <span>Why this matters</span>
            </div>
            <h2 className="mission-heading">Every prompt runs in a data center</h2>
            <p className="mission-body">
              AI replies run on data centers that use electricity and water for cooling. One prompt may
              seem small, but over time, those prompts add up. PromptFootprint estimates the energy,
              water, and CO₂ tied to your ChatGPT and Claude use, helping you spot trends and reduce
              unnecessary usage.
            </p>
            <div className="mission-pills">
              <span className="mission-pill"><Zap size={13} aria-hidden="true" /> Grid electricity</span>
              <span className="mission-pill"><Droplets size={13} aria-hidden="true" /> Water cooling</span>
              <span className="mission-pill"><Globe2 size={13} aria-hidden="true" /> 8 data-center regions shown</span>
            </div>
            <p className="mission-note">
              The globe above marks 8 major AI data-center regions; bigger dots mean higher carbon
              intensity and water stress. It’s for context only — your prompts aren’t traced to a location.
            </p>
          </div>

          {/* The globe's markers, spelled out. Same ordering and the same
              intensity scale, so the legend and the sphere agree. */}
          <div className="mission-regions">
            <div className="mission-regions-head">
              <span>Region</span>
              <span>gCO₂e / kWh</span>
            </div>
            <ul className="mission-region-list">
              {[...REGIONS].sort((a, b) => b.intensity - a.intensity).map((r) => (
                <li className="mission-region" key={r.id}>
                  <span
                    className="mission-region-dot"
                    style={{ '--dot': `${6 + intensityShare(r.intensity) * 7}px` }}
                    aria-hidden="true"
                  />
                  <span className="mission-region-name">{r.label}</span>
                  <span className="mission-region-bar" aria-hidden="true">
                    <i style={{ width: `${28 + intensityShare(r.intensity) * 72}%` }} />
                  </span>
                  <span className="mission-region-val">{r.intensity}</span>
                </li>
              ))}
            </ul>
            <p className="mission-regions-note">Approximate annual grid averages, for context.</p>
          </div>
        </div>
      </Reveal>

      {/* Weather-aware estimate — surfaced here (not buried in How it Works). */}
      <Reveal as="section" className="weather-section">
        <WeatherCard />
      </Reveal>
    </div>
  )
}
