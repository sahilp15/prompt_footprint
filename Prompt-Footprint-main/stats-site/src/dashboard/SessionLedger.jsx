import { useMemo, useState } from 'react'
import { formatValue } from '../lib/metrics'
import { withViewTransition } from '../lib/viewTransition'
import { usePrefersReducedMotion } from '../hooks/useMotion'

/**
 * The session history, as a ledger.
 * ---------------------------------------------------------------------------
 * A table, because that is what this is: one row per session, aligned columns,
 * tabular figures, a sticky header, and hairlines between rows. Cards would put
 * six numbers in six different places on every row and make the one thing a
 * ledger is for — reading down a column — impossible.
 *
 * Only columns the data model actually carries are shown. There is no "saved"
 * column here: realized savings are recorded against the day they happened, not
 * against a session id, so attributing them to a row would be an invention.
 * They are reported on the Efficiency tab, where the data supports it.
 */

const COLUMNS = [
  { id: 'time', label: 'Time', align: 'left', sort: (a, b) => b.time - a.time },
  { id: 'platform', label: 'Platform', align: 'left', sort: (a, b) => a.platform.localeCompare(b.platform) },
  { id: 'prompts', label: 'Prompts', align: 'right', sort: (a, b) => b.prompts - a.prompts },
  { id: 'promptTokens', label: 'Prompt tok', align: 'right', sort: (a, b) => b.promptTokens - a.promptTokens },
  { id: 'responseTokens', label: 'Response tok', align: 'right', sort: (a, b) => b.responseTokens - a.responseTokens },
  { id: 'totalTokens', label: 'Total tok', align: 'right', sort: (a, b) => b.totalTokens - a.totalTokens },
  { id: 'energyWh', label: 'Est. Wh', align: 'right', sort: (a, b) => b.energyWh - a.energyWh },
  { id: 'waterMl', label: 'Est. mL', align: 'right', sort: (a, b) => b.waterMl - a.waterMl },
  { id: 'co2G', label: 'Est. g CO₂', align: 'right', sort: (a, b) => b.co2G - a.co2G },
]

const PLATFORM_LABEL = { chatgpt: 'ChatGPT', claude: 'Claude', other: 'Chat' }

export default function SessionLedger({ rows, dense = false }) {
  const reduced = usePrefersReducedMotion()
  const [sort, setSort] = useState('time')
  const [filter, setFilter] = useState('all')
  const [open, setOpen] = useState(null)

  // Opening a row is a row becoming a detail — the one place in the ledger
  // where a continuity animation says something. Feature-detected; without
  // support the row simply expands.
  const toggle = (id) =>
    withViewTransition(() => setOpen((cur) => (cur === id ? null : id)), { reducedMotion: reduced })

  const view = useMemo(() => {
    const col = COLUMNS.find((c) => c.id === sort) || COLUMNS[0]
    const filtered = filter === 'all' ? rows : rows.filter((r) => r.platform === filter)
    return [...filtered].sort(col.sort)
  }, [rows, sort, filter])

  const platforms = useMemo(
    () => Array.from(new Set(rows.map((r) => r.platform))),
    [rows],
  )

  if (!rows.length) {
    return (
      <div className="dsh-empty">
        <p className="u-micro u-micro-strong">No sessions in this period</p>
        <p>Sessions appear here the moment you send a prompt on ChatGPT or Claude.</p>
      </div>
    )
  }

  return (
    <div className="ldg">
      <div className="ldg-controls">
        <div className="pf2-switch" role="group" aria-label="Filter by platform">
          <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
          {platforms.map((p) => (
            <button key={p} type="button" aria-pressed={filter === p} onClick={() => setFilter(p)}>
              {PLATFORM_LABEL[p] || p}
            </button>
          ))}
        </div>
        <span className="u-micro ldg-count">
          {view.length} session{view.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="ldg-scroll">
        <table className="ldg-table">
          <caption className="u-sr">
            Session history. Select a column heading to sort; select a row to open its prompts.
          </caption>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.id}
                  scope="col"
                  className={c.align === 'right' ? 'is-num' : ''}
                  aria-sort={sort === c.id ? 'descending' : 'none'}
                >
                  <button type="button" onClick={() => setSort(c.id)}>
                    {c.label}
                    {sort === c.id && <span aria-hidden="true"> ↓</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map((r) => (
              <Row key={r.id} row={r} open={open === r.id} onToggle={() => toggle(r.id)} dense={dense} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Row({ row, open, onToggle, dense }) {
  return (
    <>
      <tr
        className={`ldg-row${open ? ' is-open' : ''}`}
        onClick={onToggle}
      >
        <td>
          <button
            type="button"
            className="ldg-rowbtn"
            aria-expanded={open}
            aria-controls={`ldg-detail-${row.id}`}
            onClick={(e) => { e.stopPropagation(); onToggle() }}
          >
            <span className="ldg-date">{row.dateLabel}</span>
            <span className="ldg-time">{row.timeLabel}</span>
          </button>
        </td>
        <td className="ldg-platform">{PLATFORM_LABEL[row.platform] || row.platform}</td>
        <td className="is-num">{row.prompts}</td>
        <td className="is-num">{row.promptTokens.toLocaleString()}</td>
        <td className="is-num">{row.responseTokens.toLocaleString()}</td>
        <td className="is-num is-strong">{row.totalTokens.toLocaleString()}</td>
        <td className="is-num is-quiet">{formatValue(row.energyWh)}</td>
        <td className="is-num is-quiet">{formatValue(row.waterMl)}</td>
        <td className="is-num is-quiet">{formatValue(row.co2G)}</td>
      </tr>
      {open && (
        <tr className="ldg-detail" id={`ldg-detail-${row.id}`}>
          <td colSpan={9}>
            <div className="ldg-detail-inner">
              <p className="u-micro u-micro-strong">Prompts in this session</p>
              {row.queries.length ? (
                <ol className="ldg-queries">
                  {row.queries.map((q, i) => (
                    <li key={q.id || i}>
                      <span className="u-micro">#{i + 1}</span>
                      <span className="ldg-q-nums">
                        <b>{q.totalTokens.toLocaleString()}</b> tok
                        <em>{q.promptTokens} in / {q.responseTokens} out</em>
                      </span>
                      {!dense && (
                        <span className="ldg-q-env u-micro">
                          {formatValue(q.energyWh)} Wh · {formatValue(q.waterMl)} mL · {formatValue(q.co2G)} g
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="u-micro">No per-prompt detail stored for this session.</p>
              )}
              <p className="u-micro ldg-detail-note">
                Token counts only. The text of these prompts was never stored.
              </p>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
