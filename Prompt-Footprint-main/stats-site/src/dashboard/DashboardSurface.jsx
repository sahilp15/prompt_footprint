import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useWeeklyStats, useSessions, useSavings } from '../hooks/useStats'
import { usePrefersReducedMotion } from '../hooks/useMotion'
import { buildModel, insights, ledgerRows } from '../lib/efficiency'
import { formatValue } from '../lib/metrics'
import { withViewTransition } from '../lib/viewTransition'
import { isDemoMode } from '../lib/api'
import MeterChart from './MeterChart'
import SessionLedger from './SessionLedger'
import './dashboard.css'

/**
 * The dashboard.
 * ---------------------------------------------------------------------------
 * Ordered by what the product is for. Token efficiency leads; the resource
 * translation follows, once the thing being translated is on screen. Energy,
 * water, and CO₂ are not three equal headline cards — they are one readout,
 * derived from the number above them.
 *
 * Every figure comes from `lib/efficiency.js`, which is where the definitions
 * live. Nothing is computed twice, and nothing here invents a metric.
 */

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'efficiency', label: 'Efficiency' },
  { id: 'footprint', label: 'Footprint' },
  { id: 'sessions', label: 'Sessions' },
]

/** The chart's modes. Token views come first, deliberately. */
const MODES = [
  { id: 'saved', key: 'saved', label: 'Tokens saved', unit: '', format: (v) => Math.round(v).toLocaleString() },
  { id: 'used', key: 'used', label: 'Tokens used', unit: '', format: (v) => Math.round(v).toLocaleString() },
  { id: 'energy', key: 'energyWh', label: 'Est. energy', unit: ' Wh', format: formatValue },
  { id: 'water', key: 'waterMl', label: 'Est. water', unit: ' mL', format: formatValue },
  { id: 'co2', key: 'co2G', label: 'Est. CO₂', unit: ' g', format: formatValue },
]

/* ── Small parts ─────────────────────────────────────────────────────────── */

function Delta({ change, goodDirection = 'down', label = 'vs previous period' }) {
  if (!change) return <span className="dsh-delta is-none">No prior period</span>
  if (change.direction === 'flat') return <span className="dsh-delta is-flat">Unchanged {label}</span>
  const good = change.direction === goodDirection
  return (
    <span className={`dsh-delta ${good ? 'is-good' : 'is-bad'}`}>
      <span aria-hidden="true">{change.direction === 'up' ? '↑' : '↓'}</span>
      {Math.abs(change.pct).toFixed(1)}% {label}
    </span>
  )
}

function Cell({ label, value, unit, note }) {
  return (
    <div>
      <span className="pf2-cell-label">{label}</span>
      <span className="pf2-cell-value">
        {value}
        {unit && <span className="pf2-cell-unit">{unit}</span>}
      </span>
      {note && <span className="dsh-cell-note u-micro">{note}</span>}
    </div>
  )
}

/** Loading: the shape of the page, in the page's own geometry. No shimmer. */
function Skeleton() {
  return (
    <div className="dsh-skeleton" aria-busy="true" aria-live="polite">
      <span className="u-sr">Loading your dashboard…</span>
      <div className="sk sk-figure" />
      <div className="sk-strip">{[0, 1, 2, 3].map((i) => <div className="sk sk-cell" key={i} />)}</div>
      <div className="sk sk-chart" />
      <div className="sk-strip">{[0, 1, 2].map((i) => <div className="sk sk-cell" key={i} />)}</div>
    </div>
  )
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="dsh-empty is-error" role="alert">
      <p className="u-micro u-micro-strong">Could not read this period</p>
      <p>
        Your data is stored on this device, so nothing is lost — the dashboard just failed
        to read it.
      </p>
      {message && <p className="u-micro dsh-empty-detail">{message}</p>}
      <button type="button" className="pf2-btn is-sm" onClick={onRetry}>Try again</button>
    </div>
  )
}

/* ── Sections ────────────────────────────────────────────────────────────── */

/** The headline: tokens saved, then the measurement rail beneath it. */
function Headline({ model }) {
  const { current, deltas, avgReduction } = model
  return (
    <header className="dsh-headline">
      <div className="dsh-headline-lead">
        <p className="u-micro">This period · {model.range}</p>
        <p className="u-figure dsh-figure">{current.tokensSaved.toLocaleString()}</p>
        <p className="u-h3 dsh-figure-label">tokens saved</p>
        <Delta change={deltas.tokensSaved} goodDirection="up" />
      </div>

      <div className="pf2-strip dsh-rail">
        <Cell label="Total tokens" value={current.totalTokens.toLocaleString()} />
        <Cell label="Prompts" value={current.prompts.toLocaleString()} />
        <Cell label="Optimizations" value={current.optimizations.toLocaleString()} />
        <Cell
          label="Avg. reduction"
          value={avgReduction != null ? avgReduction.toFixed(1) : '—'}
          unit={avgReduction != null ? '%' : ''}
          note={avgReduction == null ? 'needs original counts' : 'of the prompts you tightened'}
        />
      </div>
    </header>
  )
}

/** Used against removed, on one shared scale. A length compared to a length. */
function SavedVsUsed({ model }) {
  const { current } = model
  const wouldHave = current.totalTokens + current.tokensSaved
  const max = Math.max(wouldHave, 1)
  return (
    <section className="dsh-block" aria-labelledby="dsh-svu">
      <h3 className="u-micro u-micro-strong" id="dsh-svu">Tokens</h3>
      <ul className="dsh-bars">
        <li>
          <span className="u-micro">Sent</span>
          <span className="dsh-bar"><i className="is-used" style={{ transform: `scaleX(${current.totalTokens / max})` }} /></span>
          <span className="dsh-bar-value">{current.totalTokens.toLocaleString()}</span>
        </li>
        <li>
          <span className="u-micro">Removed before sending</span>
          <span className="dsh-bar"><i className="is-saved" style={{ transform: `scaleX(${current.tokensSaved / max})` }} /></span>
          <span className="dsh-bar-value">{current.tokensSaved.toLocaleString()}</span>
        </li>
      </ul>
      <p className="u-micro dsh-note">
        {model.removedShare > 0
          ? `${model.removedShare.toFixed(1)}% of what this period would have totalled came out before it was sent. `
          : ''}
        Sent tokens are usage, not waste — most of them are the model’s answer.
      </p>
    </section>
  )
}

/** The resource translation: one continuous readout, divided by rules. */
function ResourceReadout({ model, showSaved = true }) {
  const { current, savedImpact } = model
  return (
    <section className="dsh-block dsh-resource" aria-labelledby="dsh-res">
      <div className="dsh-block-head">
        <h3 className="u-micro u-micro-strong" id="dsh-res">What those tokens represent</h3>
        <span className="dsh-est u-micro">Estimated, not metered</span>
        <Link className="u-micro dsh-method-link" to="/app/learn">Methodology ↗</Link>
      </div>

      <div className="pf2-strip">
        <Cell label="Est. energy" value={formatValue(current.energyWh)} unit="Wh" />
        <Cell label="Est. water" value={formatValue(current.waterMl)} unit="mL" />
        <Cell label="Est. CO₂" value={formatValue(current.co2G)} unit="g" />
        <Cell label="From" value={current.totalTokens.toLocaleString()} unit="tokens" />
      </div>

      {showSaved && current.tokensSaved > 0 && (
        <>
          <div className="pf2-strip dsh-resource-saved">
            <Cell label="Equivalent · energy" value={formatValue(savedImpact.energyWh)} unit="Wh" />
            <Cell label="Equivalent · water" value={formatValue(savedImpact.waterMl)} unit="mL" />
            <Cell label="Equivalent · CO₂" value={formatValue(savedImpact.co2G)} unit="g" />
            <Cell label="Of" value={current.tokensSaved.toLocaleString()} unit="tokens removed" />
          </div>
          <p className="u-micro dsh-note">
            The second row is the resource equivalent of the tokens you removed, priced with
            the same per-token model as the row above it. It is what those tokens would have
            corresponded to — not a measurement of anything that was prevented. Input tokens
            are a minority of an interaction’s energy, so the real difference is smaller again.
          </p>
        </>
      )}
    </section>
  )
}

/** Facts the data supports, or nothing. */
function Insights({ items }) {
  if (!items.length) return null
  return (
    <section className="dsh-block" aria-labelledby="dsh-ins">
      <h3 className="u-micro u-micro-strong" id="dsh-ins">From this period</h3>
      <ul className="dsh-insights">
        {items.map((f) => (
          <li key={f.id}>
            <b>{f.value}</b>
            <span>{f.text}</span>
            <span className="u-micro">{f.basis}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ── Surface ─────────────────────────────────────────────────────────────── */

export default function DashboardSurface({ embedded = false, initialTab = 'overview' }) {
  const reduced = usePrefersReducedMotion()
  const weekly = useWeeklyStats()
  const savings = useSavings()
  const sessions = useSessions()
  const [tab, setTab] = useState(initialTab)
  const [mode, setMode] = useState('saved')

  const loading = weekly.loading || savings.loading || sessions.loading
  const error = weekly.error || savings.error || sessions.error

  const model = useMemo(
    () => buildModel({ weekly: weekly.data, savings: savings.data, sessions: sessions.sessions }),
    [weekly.data, savings.data, sessions.sessions],
  )
  const facts = useMemo(() => insights(model), [model])
  const rows = useMemo(() => ledgerRows(sessions.sessions), [sessions.sessions])

  const activeMode = MODES.find((m) => m.id === mode) || MODES[0]
  const sample = isDemoMode()

  const retry = () => { weekly.reload(); savings.reload(); sessions.reload() }

  const chart = (
    <section className="dsh-chart-block" aria-labelledby="dsh-chart-h">
      <div className="dsh-block-head">
        <h3 className="u-micro u-micro-strong" id="dsh-chart-h">{activeMode.label} over time</h3>
        <div className="pf2-switch dsh-modes" role="group" aria-label="Choose what the chart plots">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={mode === m.id}
              onClick={() => withViewTransition(() => setMode(m.id), { reducedMotion: reduced })}
            >
              {m.label.replace('Est. ', '')}
            </button>
          ))}
        </div>
      </div>
      <MeterChart
        series={model.series}
        prevSeries={model.prevSeries}
        valueKey={activeMode.key}
        label={activeMode.label}
        unit={activeMode.unit}
        format={activeMode.format}
        height={embedded ? 280 : 320}
      />
    </section>
  )

  const body = () => {
    if (loading) return <Skeleton />
    if (error) return <ErrorState message={error} onRetry={retry} />

    if (model.empty) {
      return (
        <div className="dsh-empty">
          <p className="u-micro u-micro-strong">No activity in this period</p>
          <p>
            Open ChatGPT or Claude with the extension running. Counting starts with your
            next prompt, and this page fills in from there.
          </p>
          <Link className="pf2-btn is-sm" to="/app/learn">How the counting works</Link>
        </div>
      )
    }

    switch (tab) {
      case 'efficiency':
        return (
          <>
            <Headline model={model} />
            {chart}
            <SavedVsUsed model={model} />
            {!model.hasOptimizations && (
              <div className="dsh-empty is-inline">
                <p className="u-micro u-micro-strong">No optimization history yet</p>
                <p>Token savings appear here after you use the Energy Saver on a prompt.</p>
                <Link className="pf2-btn is-sm" to="/app/cutter">Open the Token Cutter</Link>
              </div>
            )}
            <Insights items={facts} />
          </>
        )
      case 'footprint':
        return (
          <>
            <ResourceReadout model={model} />
            {chart}
            <section className="dsh-block" aria-labelledby="dsh-basis">
              <h3 className="u-micro u-micro-strong" id="dsh-basis">Basis</h3>
              <p className="dsh-prose">
                Each figure is a token count multiplied by a published per-token intensity —
                ChatGPT from OpenAI’s 2025 sustainability disclosure, Claude as that anchor
                scaled and labelled an estimate. Nothing here is measured at a data centre,
                and the model states its own error bars.
              </p>
              <Link className="pf2-btn is-sm" to="/app/learn">Read the method</Link>
            </section>
          </>
        )
      case 'sessions':
        return (
          <>
            <div className="pf2-strip dsh-rail">
              <Cell label="Sessions" value={model.current.sessions.toLocaleString()} />
              <Cell label="Prompts" value={model.current.prompts.toLocaleString()} />
              <Cell label="Total tokens" value={model.current.totalTokens.toLocaleString()} />
              <Cell label="Est. energy" value={formatValue(model.current.energyWh)} unit="Wh" />
            </div>
            <SessionLedger rows={rows} dense={embedded} />
          </>
        )
      default:
        return (
          <>
            <Headline model={model} />
            {chart}
            <div className="dsh-split">
              <SavedVsUsed model={model} />
              <Insights items={facts} />
            </div>
            <ResourceReadout model={model} />
          </>
        )
    }
  }

  return (
    <div className={`dsh pf2${embedded ? ' is-embedded' : ' pf2-page'}`}>
      <div className={`dsh-inner${embedded ? '' : ' pf2-grid'}`}>
        <div className="dsh-col">
          {/* Standalone this surface is the page, so it owns the page heading.
              Embedded, the landing section above it already provides one and a
              second h1 would break the outline. */}
          {!embedded && (
            <h1 className="u-sr">
              PromptFootprint dashboard — last {model.current.days} days
              {sample ? ', sample data' : ''}
            </h1>
          )}
          <nav className="dsh-tabs" aria-label="Dashboard sections">
            <div className="pf2-switch" role="tablist" aria-label="Dashboard sections">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {sample && <span className="dsh-sample u-micro">Sample data</span>}
            {!embedded && <Link className="u-micro dsh-method-link" to="/app/learn">Method ↗</Link>}
          </nav>

          <div className="dsh-body" role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
            {body()}
          </div>
        </div>
      </div>
    </div>
  )
}
