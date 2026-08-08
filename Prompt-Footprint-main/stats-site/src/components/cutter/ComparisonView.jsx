import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

/**
 * The comparison pane.
 *
 * Left: the original with every accepted change struck through and each
 * protected region marked, so nothing changes without being visible.
 * Right: the resulting prompt, ready to copy.
 *
 * The strike-throughs describe the FIRST compression pass, because those are the
 * edits whose coordinates address the original text and which the user can
 * toggle. Later refinement rounds work on the previous round's output, so they
 * cannot be drawn here — and going silent about them would mean the right pane
 * were shorter than the left pane explains. They are counted instead.
 */
export default function ComparisonView({ diff, optimized, refinements = [], focusedId, onFocus }) {
  const refined = refinements
    .filter((p) => !p.rejected)
    .reduce((n, p) => n + p.edits.length, 0)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(optimized)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard permission denied — the text is selectable in the pane, so
      // there is still a way through.
      setCopied(false)
    }
  }

  return (
    <div className="tc-compare">
      <section className="tc-pane" aria-labelledby="tc-pane-original">
        <header className="tc-pane-head">
          <h3 id="tc-pane-original" className="tc-pane-title">Original</h3>
          <span className="tc-legend">
            <span className="tc-legend-item"><i className="tc-swatch tc-swatch-removed" />removed</span>
            <span className="tc-legend-item"><i className="tc-swatch tc-swatch-added" />rewritten</span>
            <span className="tc-legend-item"><i className="tc-swatch tc-swatch-protected" />protected</span>
          </span>
        </header>
        <div className="tc-pane-body tc-diff">
          {diff.map((part, i) => {
            const key = `${part.kind}-${i}`
            if (part.kind === 'removed') {
              return (
                <del
                  key={key}
                  className={`tc-removed${focusedId === part.suggestionId ? ' is-focused' : ''}`}
                  onMouseEnter={() => onFocus(part.suggestionId ?? null)}
                  onMouseLeave={() => onFocus(null)}
                >
                  {part.text}
                </del>
              )
            }
            if (part.kind === 'added') {
              return (
                <ins
                  key={key}
                  className={`tc-added${focusedId === part.suggestionId ? ' is-focused' : ''}`}
                  onMouseEnter={() => onFocus(part.suggestionId ?? null)}
                  onMouseLeave={() => onFocus(null)}
                >
                  {part.text}
                </ins>
              )
            }
            if (part.kind === 'protected') {
              return <mark key={key} className="tc-protected" title="Protected — never rewritten">{part.text}</mark>
            }
            return <span key={key}>{part.text}</span>
          })}
        </div>
      </section>

      <section className="tc-pane" aria-labelledby="tc-pane-optimized">
        <header className="tc-pane-head">
          <h3 id="tc-pane-optimized" className="tc-pane-title">Optimized</h3>
          <button type="button" className="tc-chip-btn" onClick={copy}>
            {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </header>
        <div className="tc-pane-body tc-result">{optimized}</div>
        {refined > 0 && (
          <p className="tc-pane-note">
            {refined} further {refined === 1 ? 'reduction was' : 'reductions were'} found by
            re-running the pipeline on this result, so {refined === 1 ? 'it is' : 'they are'} not
            struck through on the left.
          </p>
        )}
      </section>
    </div>
  )
}
