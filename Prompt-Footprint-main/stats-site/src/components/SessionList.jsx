import { useMemo, useState } from 'react'
import {
  ChevronDown, Zap, Droplets, Wind, Hash, Clock, MessageSquare,
  CloudOff, RefreshCw, Search, ArrowUpDown,
} from 'lucide-react'
import { useSessions } from '../hooks/useStats'
import { fetchQueries } from '../lib/api'
import { formatValue } from '../lib/metrics'
import Reveal from './ui/Reveal'
import './SessionList.css'

const PLATFORMS = {
  chatgpt: { label: 'ChatGPT', className: 'is-chatgpt' },
  claude: { label: 'Claude', className: 'is-claude' },
}
// Older records predate the platform field. They still get a chip, so the row
// grid keeps the same shape for every session.
const UNKNOWN_PLATFORM = { label: 'Chat', className: 'is-other' }

const SORTS = [
  { id: 'recent', label: 'Newest', compare: (a, b) => new Date(b.startTime) - new Date(a.startTime) },
  { id: 'impact', label: 'Heaviest', compare: (a, b) => (b.totalEnergyWh || 0) - (a.totalEnergyWh || 0) },
  { id: 'length', label: 'Longest', compare: (a, b) => (b.totalTokens || 0) - (a.totalTokens || 0) },
]

function formatDuration(ms) {
  if (ms == null) return 'Active'
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`
}

/**
 * One session. Collapsed it is a scannable row; expanded it reveals the
 * per-prompt table, which is fetched lazily the first time it is opened.
 */
function SessionRow({ session, share, index }) {
  const [expanded, setExpanded] = useState(false)
  const [queries, setQueries] = useState(null)
  const [loadingQueries, setLoadingQueries] = useState(false)

  const start = new Date(session.startTime)
  const end = session.endTime ? new Date(session.endTime) : null
  const duration = formatDuration(end ? end - start : null)
  const platform = PLATFORMS[session.platform] || UNKNOWN_PLATFORM

  async function toggle() {
    if (!expanded && !queries) {
      setLoadingQueries(true)
      try {
        const q = await fetchQueries(session.id)
        setQueries(q)
      } catch { setQueries([]) }
      setLoadingQueries(false)
    }
    setExpanded((e) => !e)
  }

  return (
    <Reveal as="li" className="session-row" delay={Math.min(index, 8) * 45}>
      <button
        type="button"
        className="session-header"
        onClick={toggle}
        aria-expanded={expanded}
        aria-controls={`queries-${session.id}`}
      >
        <span className={`session-toggle${expanded ? ' is-open' : ''}`} aria-hidden="true">
          <ChevronDown size={15} />
        </span>

        <span className="session-when">
          <span className="session-date-main">
            {start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
          <span className="session-date-time">
            {start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            <span className="session-sep" aria-hidden="true">·</span>
            <Clock size={11} aria-hidden="true" /> {duration}
          </span>
        </span>

        <span className={`session-platform ${platform.className}`}>{platform.label}</span>

        <span className="session-metrics">
          <span className="session-metric" style={{ '--metric': 'var(--metric-tokens)' }}>
            <Hash size={12} aria-hidden="true" />
            <span className="session-metric-val">{(session.totalTokens || 0).toLocaleString()}</span>
            <span className="session-metric-unit">tokens</span>
          </span>
          <span className="session-metric" style={{ '--metric': 'var(--metric-energy)' }}>
            <Zap size={12} aria-hidden="true" />
            <span className="session-metric-val">{formatValue(session.totalEnergyWh)}</span>
            <span className="session-metric-unit">Wh</span>
          </span>
          <span className="session-metric" style={{ '--metric': 'var(--metric-water)' }}>
            <Droplets size={12} aria-hidden="true" />
            <span className="session-metric-val">{formatValue(session.totalWaterMl)}</span>
            <span className="session-metric-unit">mL</span>
          </span>
          <span className="session-metric" style={{ '--metric': 'var(--metric-carbon)' }}>
            <Wind size={12} aria-hidden="true" />
            <span className="session-metric-val">{formatValue(session.totalCo2G)}</span>
            <span className="session-metric-unit">g</span>
          </span>
        </span>

        <span className="session-count">
          <MessageSquare size={12} aria-hidden="true" />
          {session.queryCount || 0}
        </span>

        {/* How heavy this session was against the heaviest one on the page. */}
        <span
          className="session-share"
          title={`${Math.round(share * 100)}% of the heaviest session's energy`}
          aria-hidden="true"
        >
          <i style={{ width: `${Math.max(4, share * 100)}%` }} />
        </span>
      </button>

      <div
        id={`queries-${session.id}`}
        className={`session-queries${expanded ? ' is-open' : ''}`}
        hidden={!expanded}
      >
        <div className="session-queries-inner">
          {loadingQueries && (
            <div className="queries-loading">
              <span className="pf-skeleton" style={{ height: 13, width: '38%' }} />
              <span className="pf-skeleton" style={{ height: 13, width: '62%' }} />
              <span className="pf-skeleton" style={{ height: 13, width: '48%' }} />
            </div>
          )}
          {queries && queries.length === 0 && <div className="queries-empty">No query details stored for this session.</div>}
          {queries && queries.length > 0 && (
            <div className="queries-scroll">
              <table className="queries-table">
                <thead>
                  <tr>
                    <th>#</th><th>Tokens</th><th>Prompt</th><th>Response</th>
                    <th>Energy (Wh)</th><th>Water (mL)</th><th>CO₂ (g)</th>
                  </tr>
                </thead>
                <tbody>
                  {queries.map((q, i) => (
                    <tr key={q.id}>
                      <td className="query-num">{i + 1}</td>
                      <td className="mono strong">{q.totalTokens}</td>
                      <td className="mono">{q.promptTokens}</td>
                      <td className="mono">{q.responseTokens}</td>
                      <td className="mono amber">{(q.energyWh || 0).toFixed(5)}</td>
                      <td className="mono blue">{(q.waterMl || 0).toFixed(5)}</td>
                      <td className="mono">{(q.co2G || 0).toFixed(5)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Reveal>
  )
}

export default function SessionList() {
  const { sessions, loading, error, reload } = useSessions()
  const [sort, setSort] = useState('recent')
  const [query, setQuery] = useState('')

  const { rows, peakEnergy, totals } = useMemo(() => {
    const term = query.trim().toLowerCase()
    const filtered = term
      ? sessions.filter((s) => {
        const when = new Date(s.startTime).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        return `${s.platform || ''} ${when}`.toLowerCase().includes(term)
      })
      : sessions
    const compare = (SORTS.find((s) => s.id === sort) || SORTS[0]).compare
    return {
      rows: [...filtered].sort(compare),
      peakEnergy: Math.max(...sessions.map((s) => s.totalEnergyWh || 0), 1e-9),
      totals: sessions.reduce(
        (a, s) => ({
          tokens: a.tokens + (s.totalTokens || 0),
          prompts: a.prompts + (s.queryCount || 0),
        }),
        { tokens: 0, prompts: 0 },
      ),
    }
  }, [sessions, sort, query])

  if (loading) {
    return (
      <div className="pf-page sessions-page" aria-busy="true">
        <span className="sr-only">Loading sessions…</span>
        <div className="page-header">
          <div className="pf-skeleton" style={{ width: 220, height: 34 }} />
          <div className="pf-skeleton" style={{ width: 320, height: 16 }} />
        </div>
        <div className="sessions-list">
          {[0, 1, 2, 3, 4].map((i) => (
            <div className="pf-skeleton" key={i} style={{ height: 74, borderRadius: 'var(--radius-lg)' }} />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="pf-state pf-state-error" role="alert">
        <span className="pf-state-icon"><CloudOff size={26} aria-hidden="true" /></span>
        <h2>Couldn’t load your sessions</h2>
        <p>Sessions are read from this device’s local storage. Nothing was lost — the read just failed.</p>
        <p className="pf-state-detail">{error}</p>
        <button type="button" className="pf-btn" onClick={reload}>
          <RefreshCw size={15} aria-hidden="true" /> Try again
        </button>
      </div>
    )
  }

  return (
    <div className="pf-page sessions-page">
      <Reveal className="pf-head-row">
        <div className="page-header">
          <span className="pf-eyebrow">Session history</span>
          <h1 className="page-title">Every conversation, itemised</h1>
          <p className="page-subtitle">
            {sessions.length.toLocaleString()} session{sessions.length === 1 ? '' : 's'} ·{' '}
            {totals.prompts.toLocaleString()} prompt{totals.prompts === 1 ? '' : 's'} ·{' '}
            {totals.tokens.toLocaleString()} tokens. Open a row to see the per-prompt breakdown.
          </p>
        </div>

        {sessions.length > 0 && (
          <div className="sessions-controls">
            <label className="sessions-search">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by date or platform"
                aria-label="Filter sessions"
              />
            </label>
            <div className="pf-segmented" role="group" aria-label="Sort sessions">
              <span className="sessions-sort-icon" aria-hidden="true"><ArrowUpDown size={13} /></span>
              {SORTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="pf-seg"
                  aria-pressed={sort === s.id}
                  onClick={() => setSort(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </Reveal>

      {sessions.length === 0 ? (
        <div className="pf-state">
          <span className="pf-state-icon"><Zap size={26} aria-hidden="true" /></span>
          <h2>No sessions yet</h2>
          <p>Start chatting on ChatGPT or Claude and PromptFootprint will record each conversation here.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="pf-state">
          <span className="pf-state-icon"><Search size={24} aria-hidden="true" /></span>
          <h2>Nothing matches “{query.trim()}”</h2>
          <p>Try a month name, a year, or a platform — “claude” or “chatgpt”.</p>
          <button type="button" className="pf-btn" onClick={() => setQuery('')}>Clear the filter</button>
        </div>
      ) : (
        <ul className="sessions-list">
          {rows.map((s, i) => (
            <SessionRow
              key={s.id}
              session={s}
              index={i}
              share={(s.totalEnergyWh || 0) / peakEnergy}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
