import { useState } from 'react'
import { ChevronDown, ChevronRight, Zap, Droplets, Wind, Hash, Clock } from 'lucide-react'
import { useSessions } from '../hooks/useStats'
import { fetchQueries } from '../lib/api'
import './SessionList.css'

function SessionRow({ session }) {
  const [expanded, setExpanded] = useState(false)
  const [queries, setQueries] = useState(null)
  const [loadingQueries, setLoadingQueries] = useState(false)

  const start = new Date(session.startTime)
  const end = session.endTime ? new Date(session.endTime) : null
  const durationMs = end ? end - start : null
  const duration = durationMs
    ? durationMs < 60000
      ? `${Math.round(durationMs / 1000)}s`
      : durationMs < 3600000
        ? `${Math.floor(durationMs / 60000)}m ${Math.round((durationMs % 60000) / 1000)}s`
        : `${Math.floor(durationMs / 3600000)}h ${Math.floor((durationMs % 3600000) / 60000)}m`
    : 'Active'

  async function toggle() {
    if (!expanded && !queries) {
      setLoadingQueries(true)
      try {
        const q = await fetchQueries(session.id)
        setQueries(q)
      } catch { setQueries([]) }
      setLoadingQueries(false)
    }
    setExpanded(e => !e)
  }

  return (
    <div className="session-row">
      <div className="session-header" onClick={toggle}>
        <div className="session-toggle">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </div>
        <div className="session-date">
          <div className="session-date-main">{start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
          <div className="session-date-time">{start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
        <div className="session-meta">
          <Clock size={12} />
          <span>{duration}</span>
        </div>
        <div className="session-metric amber">
          <Hash size={12} /><span>{session.totalTokens?.toLocaleString() || 0}</span>
        </div>
        <div className="session-metric yellow">
          <Zap size={12} /><span>{(session.totalEnergyWh || 0).toFixed(4)} Wh</span>
        </div>
        <div className="session-metric blue">
          <Droplets size={12} /><span>{(session.totalWaterMl || 0).toFixed(4)} mL</span>
        </div>
        <div className="session-metric gray">
          <Wind size={12} /><span>{(session.totalCo2G || 0).toFixed(4)} g</span>
        </div>
        <div className="session-count">{session.queryCount || 0} queries</div>
      </div>

      {expanded && (
        <div className="session-queries">
          {loadingQueries && <div className="queries-loading">Loading queries...</div>}
          {queries && queries.length === 0 && <div className="queries-empty">No query details stored.</div>}
          {queries && queries.length > 0 && (
            <table className="queries-table">
              <thead>
                <tr>
                  <th>#</th><th>Tokens</th><th>Prompt</th><th>Response</th>
                  <th>Energy (Wh)</th><th>Water (mL)</th><th>CO2 (g)</th>
                </tr>
              </thead>
              <tbody>
                {queries.map((q, i) => (
                  <tr key={q.id}>
                    <td className="query-num">{i + 1}</td>
                    <td className="mono">{q.totalTokens}</td>
                    <td className="mono">{q.promptTokens}</td>
                    <td className="mono">{q.responseTokens}</td>
                    <td className="mono amber">{(q.energyWh || 0).toFixed(5)}</td>
                    <td className="mono blue">{(q.waterMl || 0).toFixed(5)}</td>
                    <td className="mono">{(q.co2G || 0).toFixed(5)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

export default function SessionList() {
  const { sessions, loading, error } = useSessions()

  if (loading) return <div className="page-loading">Loading sessions...</div>
  if (error) return <div className="page-error"><Wind size={40} /><p>{error}</p></div>

  return (
    <div className="sessions-page">
      <div className="page-header">
        <h1 className="page-title">All Sessions</h1>
        <p className="page-subtitle">{sessions.length} session{sessions.length !== 1 ? 's' : ''} recorded</p>
      </div>

      {sessions.length === 0 ? (
        <div className="empty-sessions">
          <Zap size={40} />
          <p>No sessions yet. Start chatting on ChatGPT to begin tracking.</p>
        </div>
      ) : (
        <div className="sessions-list">
          {sessions.map(s => <SessionRow key={s.id} session={s} />)}
        </div>
      )}
    </div>
  )
}
