import { useRef, useState } from 'react'
import { Brain, ChevronDown, Download, Plus, Trash2, Upload } from 'lucide-react'
import { MEMORY_CATEGORY_LABELS, proposeMemories } from '../../lib/tokenCutter/memory.ts'

const CATEGORIES = Object.keys(MEMORY_CATEGORY_LABELS)

const PLACEHOLDERS = {
  tone: 'Professional but warm',
  length: 'Under 300 words unless I say otherwise',
  format: 'Markdown with short paragraphs',
  style: 'Plain English, no jargon',
  terminology: 'Kubernetes',
  project: 'Northwind Logistics',
  'never-remove': 'Acme Corp',
  'always-apply': 'Cite sources for factual claims',
}

/**
 * Memory manager.
 *
 * Everything here is local and inspectable: what is stored, whether it is on,
 * and — via `applied` — which entries actually influenced the current result.
 */
export default function MemoryPanel({ memory, applied, constraints = [], open, onToggle, controls }) {
  const { setEnabled, addEntry, updateEntry, removeEntry, clearAll, exportAll, importAll } = controls
  const [category, setCategory] = useState('never-remove')
  const [value, setValue] = useState('')
  const [notice, setNotice] = useState(null)
  const [dismissed, setDismissed] = useState([])
  const fileRef = useRef(null)

  // Preferences the cutter noticed in this prompt. They are OFFERED, never
  // saved on the user's behalf — transparent learning means they choose.
  const proposals = proposeMemories(constraints, memory.entries)
    .filter((p) => !dismissed.includes(p.value))

  const submit = (event) => {
    event.preventDefault()
    if (!value.trim()) return
    addEntry(category, value)
    setValue('')
    setNotice({ kind: 'ok', text: 'Saved to this device.' })
  }

  const download = () => {
    const blob = new Blob([exportAll()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'promptfootprint-memory.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const upload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const count = importAll(await file.text())
      setNotice({ kind: 'ok', text: `Imported ${count} ${count === 1 ? 'memory' : 'memories'}.` })
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Import failed.' })
    }
    event.target.value = ''
  }

  return (
    <section className={`tc-memory${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="tc-explain-toggle"
        aria-expanded={open}
        aria-controls="tc-memory-body"
        onClick={onToggle}
      >
        <Brain size={15} aria-hidden="true" />
        <span className="tc-explain-title">Memory &amp; preferences</span>
        <span className="tc-explain-hint">
          {memory.enabled
            ? `${memory.entries.length} stored${applied.length ? ` · ${applied.length} applied here` : ''}`
            : 'Turned off'}
        </span>
        <ChevronDown size={16} className="tc-explain-chev" aria-hidden="true" />
      </button>

      <div id="tc-memory-body" className="tc-explain-body" hidden={!open}>
        <p className="tc-footnote tc-footnote-lead">
          Memories are stored on this device only and are never sent anywhere.
          They are used to protect wording you care about and to fill gaps the
          current prompt leaves open — a preference never overrides something you
          have written in the prompt itself.
        </p>

        <label className="tc-switch">
          <input
            type="checkbox"
            checked={memory.enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>Use my saved preferences</span>
        </label>

        {applied.length > 0 && (
          <div className="tc-applied">
            <h4 className="tc-subhead">Applied to this prompt</h4>
            <ul>
              {applied.map((m) => (
                <li key={m.id}>
                  <span className="tc-applied-dot" aria-hidden="true" />
                  {m.effect}
                </li>
              ))}
            </ul>
          </div>
        )}

        {proposals.length > 0 && (
          <div className="tc-proposals">
            <h4 className="tc-subhead">Noticed in this prompt — save for next time?</h4>
            <ul>
              {proposals.map((p) => (
                <li key={p.value}>
                  <span className="tc-mem-cat">{MEMORY_CATEGORY_LABELS[p.category]}</span>
                  <span className="tc-proposal-value">{p.value}</span>
                  <button
                    type="button"
                    className="tc-chip-btn"
                    onClick={() => { addEntry(p.category, p.value); setDismissed((d) => [...d, p.value]) }}
                  >
                    <Plus size={12} aria-hidden="true" /> Remember
                  </button>
                  <button
                    type="button"
                    className="tc-chip-btn"
                    onClick={() => setDismissed((d) => [...d, p.value])}
                  >
                    Dismiss
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <form className="tc-mem-form" onSubmit={submit}>
          <label className="tc-visually-hidden" htmlFor="tc-mem-cat">Memory type</label>
          <select id="tc-mem-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{MEMORY_CATEGORY_LABELS[c]}</option>
            ))}
          </select>
          <label className="tc-visually-hidden" htmlFor="tc-mem-val">What to remember</label>
          <input
            id="tc-mem-val"
            type="text"
            value={value}
            placeholder={PLACEHOLDERS[category]}
            onChange={(e) => setValue(e.target.value)}
          />
          <button type="submit" className="tc-chip-btn">
            <Plus size={13} aria-hidden="true" /> Add
          </button>
        </form>

        {notice && (
          <p className={`tc-notice tc-notice-${notice.kind}`} role="status">{notice.text}</p>
        )}

        {memory.entries.length === 0 ? (
          <p className="tc-panel-empty">
            Nothing saved yet. Add a name that must never be shortened, or a
            formatting preference you keep repeating.
          </p>
        ) : (
          <ul className="tc-mem-list">
            {memory.entries.map((entry) => (
              <li key={entry.id} className={`tc-mem-item${entry.enabled ? '' : ' is-off'}`}>
                <label className="tc-mem-toggle">
                  <input
                    type="checkbox"
                    checked={entry.enabled}
                    onChange={(e) => updateEntry(entry.id, { enabled: e.target.checked })}
                    aria-label={`Enable “${entry.value}”`}
                  />
                </label>
                <span className="tc-mem-body">
                  <span className="tc-mem-cat">{MEMORY_CATEGORY_LABELS[entry.category]}</span>
                  <input
                    className="tc-mem-value"
                    type="text"
                    value={entry.value}
                    aria-label={`Edit ${MEMORY_CATEGORY_LABELS[entry.category]}`}
                    onChange={(e) => updateEntry(entry.id, { value: e.target.value })}
                  />
                </span>
                <label className="tc-mem-importance">
                  <span className="tc-visually-hidden">Importance for “{entry.value}”</span>
                  <select
                    value={entry.importance}
                    onChange={(e) => updateEntry(entry.id, { importance: Number(e.target.value) })}
                  >
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <button
                  type="button"
                  className="tc-icon-btn"
                  aria-label={`Delete “${entry.value}”`}
                  onClick={() => removeEntry(entry.id)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="tc-bulk">
          <button type="button" className="tc-chip-btn" onClick={download}>
            <Download size={13} aria-hidden="true" /> Export
          </button>
          <button type="button" className="tc-chip-btn" onClick={() => fileRef.current?.click()}>
            <Upload size={13} aria-hidden="true" /> Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="tc-visually-hidden"
            onChange={upload}
          />
          {memory.entries.length > 0 && (
            <button type="button" className="tc-chip-btn tc-chip-danger" onClick={clearAll}>
              <Trash2 size={13} aria-hidden="true" /> Delete all
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
