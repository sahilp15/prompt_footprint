import { AlertTriangle, Check, Info, RotateCcw } from 'lucide-react'

// Category → the label and colour shown on each card. Keeping this as data
// means adding a detector never means touching the rendering code.
const CATEGORY_META = {
  'repeated-instruction': { label: 'Repeated instruction', tint: 'green' },
  filler: { label: 'Unnecessary filler', tint: 'amber' },
  'wordy-phrase': { label: 'Wordy phrase', tint: 'amber' },
  grammar: { label: 'Grammar correction', tint: 'blue' },
  spelling: { label: 'Spelling', tint: 'blue' },
  'redundant-example': { label: 'Redundant example', tint: 'green' },
  'sentence-merge': { label: 'Safe sentence combination', tint: 'green' },
  ambiguous: { label: 'Ambiguous wording', tint: 'red' },
  politeness: { label: 'Unnecessary politeness', tint: 'amber' },
  transition: { label: 'Excess transition', tint: 'amber' },
  hedge: { label: 'Weak phrasing', tint: 'amber' },
  whitespace: { label: 'Spacing', tint: 'blue' },
}

const CONFIDENCE_LABEL = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' }

/** Collapse long snippets so one card can't push the panel off-screen. */
function snippet(value, max = 90) {
  const clean = value.replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function SuggestionCard({ suggestion, accepted, onDecide, onFocus }) {
  const meta = CATEGORY_META[suggestion.category] ?? { label: suggestion.title, tint: 'amber' }
  const isAdvisory = Boolean(suggestion.advisory)

  return (
    <li
      className={`tc-sug tc-tint-${meta.tint}${accepted ? ' is-accepted' : ''}${isAdvisory ? ' is-advisory' : ''}`}
      onMouseEnter={() => onFocus(suggestion.id)}
      onMouseLeave={() => onFocus(null)}
    >
      <div className="tc-sug-head">
        <span className="tc-sug-cat">{meta.label}</span>
        <span className={`tc-sug-conf tc-conf-${suggestion.confidence}`}>
          {CONFIDENCE_LABEL[suggestion.confidence]}
        </span>
      </div>

      {isAdvisory ? (
        <p className="tc-sug-advisory">
          <Info size={13} aria-hidden="true" />
          <span>{snippet(suggestion.original, 110)}</span>
        </p>
      ) : (
        <p className="tc-sug-change">
          <del>{snippet(suggestion.original)}</del>
          {suggestion.replacement && (
            <>
              <span className="tc-sug-arrow" aria-hidden="true">→</span>
              <ins>{snippet(suggestion.replacement)}</ins>
            </>
          )}
        </p>
      )}

      <p className="tc-sug-reason">{suggestion.reason}</p>

      <div className="tc-sug-foot">
        {isAdvisory ? (
          <span className="tc-sug-note">Review only — no automatic change</span>
        ) : (
          <>
            <span className="tc-sug-saving">
              {suggestion.tokensSaved > 0 ? `−${suggestion.tokensSaved} token${suggestion.tokensSaved === 1 ? '' : 's'}` : 'No token change'}
            </span>
            <span className="tc-sug-actions">
              <button
                type="button"
                className={`tc-mini${accepted ? ' is-on' : ''}`}
                aria-pressed={accepted}
                onClick={() => onDecide(suggestion.id, true)}
              >
                <Check size={13} aria-hidden="true" /> Accept
              </button>
              <button
                type="button"
                className={`tc-mini${accepted ? '' : ' is-on'}`}
                aria-pressed={!accepted}
                onClick={() => onDecide(suggestion.id, false)}
              >
                <RotateCcw size={13} aria-hidden="true" /> Reject
              </button>
            </span>
          </>
        )}
      </div>
    </li>
  )
}

export default function SuggestionList({
  suggestions, accepted, onDecide, onFocus, onAcceptSafe, onAcceptAll, onRejectAll,
  validation, onRepair,
}) {
  const actionable = suggestions.filter((s) => !s.advisory)
  const advisory = suggestions.filter((s) => s.advisory)
  const acceptedCount = actionable.filter((s) => accepted.has(s.id)).length

  return (
    <section className="tc-panel" aria-labelledby="tc-sug-title">
      <header className="tc-panel-head">
        <h2 id="tc-sug-title" className="tc-panel-title">Suggestions</h2>
        <span className="tc-panel-count">
          {acceptedCount} of {actionable.length} accepted
        </span>
      </header>

      {validation && !validation.ok && (
        <div className="tc-alert" role="alert">
          <AlertTriangle size={15} aria-hidden="true" />
          <div>
            <strong>Review before using this.</strong>
            <ul>
              {validation.issues
                .filter((i) => i.severity === 'critical')
                .slice(0, 4)
                .map((i) => <li key={`${i.kind}-${i.text}`}>{i.message}</li>)}
            </ul>
            {onRepair && (
              <button type="button" className="tc-chip-btn tc-alert-fix" onClick={onRepair}>
                Undo just the changes that caused this
              </button>
            )}
          </div>
        </div>
      )}

      {actionable.length > 0 && (
        <div className="tc-bulk">
          <button type="button" className="tc-chip-btn" onClick={onAcceptSafe}>Accept safe</button>
          <button type="button" className="tc-chip-btn" onClick={onAcceptAll}>Accept all</button>
          <button type="button" className="tc-chip-btn" onClick={onRejectAll}>Reject all</button>
        </div>
      )}

      {suggestions.length === 0 ? (
        <p className="tc-panel-empty">
          Nothing to change — this prompt is already efficient.
        </p>
      ) : (
        <ul className="tc-sug-list">
          {actionable.map((s) => (
            <SuggestionCard
              key={s.id}
              suggestion={s}
              accepted={accepted.has(s.id)}
              onDecide={onDecide}
              onFocus={onFocus}
            />
          ))}
          {advisory.map((s) => (
            <SuggestionCard
              key={s.id}
              suggestion={s}
              accepted={false}
              onDecide={onDecide}
              onFocus={onFocus}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
