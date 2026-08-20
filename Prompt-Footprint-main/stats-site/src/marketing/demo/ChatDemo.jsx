import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePrefersReducedMotion } from '../../hooks/useMotion'
import { REDUCE_MS } from './useChatDemo'
import { formatValue } from '../../lib/metrics'
import { SAMPLE_RESPONSE } from './sample'
import ReductionView from './ReductionView'
import MeasureRail from './MeasureRail'
import './demo.css'

/* ── Message rendering ──────────────────────────────────────────────────────
   The sample reply is written with **bold** runs and *emphasis*, because that
   is how a model actually answers a request for an outline. Rendering it means
   parsing exactly those two things — not shipping a Markdown library to a
   landing page for one fixed string. */

function inline(text, key) {
  const out = []
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1]) out.push(<strong key={`${key}-${m.index}`}>{m[1]}</strong>)
    else out.push(<em key={`${key}-${m.index}`}>{m[2]}</em>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function Reply({ text, streaming }) {
  const paragraphs = text.split('\n\n')
  return (
    <div className="pfd-reply">
      {paragraphs.map((p, i) => (
        <p key={i}>
          {inline(p, i)}
          {streaming && i === paragraphs.length - 1 && <span className="pfd-caret" aria-hidden="true" />}
        </p>
      ))}
    </div>
  )
}

/* ── Efficiency check ───────────────────────────────────────────────────────
   PromptFootprint noticing something, in the language of an instrument rather
   than a wish. It only ever states measured counts, and it only appears when
   the local optimizer has actually found something to remove. */

function EfficiencyCheck({ demo }) {
  const { analysis, analyzing, status, draftTokens, tooLongToOptimize, tighten } = demo
  const busy = status === 'optimizing'

  if (status === 'sending' || status === 'responding' || status === 'complete' || status === 'comparing') {
    return null
  }

  if (tooLongToOptimize) {
    return (
      <div className="pfd-check is-quiet" role="status">
        <span className="u-micro u-micro-strong">PromptFootprint</span>
        <span className="u-micro">
          {draftTokens.toLocaleString()} tokens · too long to rewrite in the browser demo
        </span>
      </div>
    )
  }

  if (analyzing || !analysis) {
    return (
      <div className="pfd-check is-quiet" role="status">
        <span className="u-micro u-micro-strong">PromptFootprint</span>
        <span className="u-micro">{analyzing ? 'Checking…' : `${draftTokens.toLocaleString()} tokens`}</span>
      </div>
    )
  }

  if (!analysis.tokensSaved) {
    return (
      <div className="pfd-check is-clear" role="status">
        <span className="u-micro u-micro-strong">Efficiency check</span>
        <span className="u-micro">
          Nothing left to remove · {analysis.originalTokens.toLocaleString()} tokens
        </span>
      </div>
    )
  }

  return (
    <div className="pfd-check" role="status">
      <span className="pfd-check-title">
        <span className="u-micro u-micro-strong">Efficiency check</span>
        <span className="u-micro">Prompt can be tightened</span>
      </span>

      <span className="pfd-check-figures">
        <span className="pfd-fig">
          <span className="u-micro">Current</span>
          <b>{analysis.originalTokens.toLocaleString()}</b>
        </span>
        <span className="pfd-fig">
          <span className="u-micro">Est. after</span>
          <b>{analysis.optimizedTokens.toLocaleString()}</b>
        </span>
        <span className="pfd-fig is-signal">
          <span className="u-micro">Saving</span>
          <b>{analysis.tokensSaved.toLocaleString()}</b>
        </span>
      </span>

      <button type="button" className="pf2-btn is-sm" onClick={tighten} disabled={busy}>
        {busy ? 'Tightening…' : 'Tighten prompt'}
      </button>
    </div>
  )
}

/* ── Before / after ─────────────────────────────────────────────────────────
   One horizontal measurement strip attached to the composer, not four cards.
   VIEW CHANGES toggles the retained/removed text in place. */

function BeforeAfter({ before, after, diff, open, onToggle }) {
  const saved = Math.max(0, before - after)
  const pct = before > 0 ? (saved / before) * 100 : 0
  return (
    <div className="pfd-ba">
      <div className="pfd-ba-strip">
        <span className="pfd-fig"><span className="u-micro">Before</span><b>{before.toLocaleString()}</b></span>
        <span className="pfd-fig"><span className="u-micro">After</span><b>{after.toLocaleString()}</b></span>
        <span className="pfd-fig is-signal"><span className="u-micro">Saved</span><b>{saved.toLocaleString()}</b></span>
        <span className="pfd-fig"><span className="u-micro">Reduction</span><b>{pct.toFixed(1)}<i>%</i></b></span>
        <button
          type="button"
          className="pf2-btn is-quiet is-sm pfd-ba-toggle"
          aria-expanded={open}
          onClick={onToggle}
        >
          {open ? 'Hide changes' : 'View changes'}
        </button>
      </div>
      {open && (
        <p className="pfd-ba-diff">
          {diff.map((part, i) => {
            if (part.kind === 'removed') return <del key={i}>{part.text}</del>
            if (part.kind === 'added') return <ins key={i}>{part.text}</ins>
            return <span key={i}>{part.text}</span>
          })}
        </p>
      )}
    </div>
  )
}

/* ── This exchange ──────────────────────────────────────────────────────────
   Two thin measurement bars on one shared scale. No donut, no gauge: the
   comparison is a length, so it is drawn as a length. */

function ExchangeCompare({ exchange, side, onSide }) {
  const { original, optimized, tokensSaved, comparable } = exchange
  const max = Math.max(original.total, optimized.total, 1)

  return (
    <section className="pfd-exchange" aria-label="This exchange">
      <header className="pfd-exchange-head">
        <span className="u-micro u-micro-strong">This exchange</span>
        {comparable ? (
          <div className="pf2-switch" role="group" aria-label="Compare prompts">
            <button type="button" aria-pressed={side === 'original'} onClick={() => onSide('original')}>Original</button>
            <button type="button" aria-pressed={side !== 'original'} onClick={() => onSide('optimized')}>Optimized</button>
          </div>
        ) : (
          <span className="u-micro">Sent as written</span>
        )}
      </header>

      {comparable ? (
        <>
          <ul className="pfd-bars">
            <li className={side === 'original' ? 'is-active' : ''}>
              <span className="u-micro">Original prompt</span>
              <span className="pfd-mbar" aria-hidden="true">
                <i className="is-original" style={{ transform: `scaleX(${original.total / max})` }} />
              </span>
              <span className="pfd-bar-value">{original.total.toLocaleString()}<em>tok</em></span>
            </li>
            <li className={side !== 'original' ? 'is-active' : ''}>
              <span className="u-micro">Optimized prompt</span>
              <span className="pfd-mbar" aria-hidden="true">
                <i className="is-optimized" style={{ transform: `scaleX(${optimized.total / max})` }} />
              </span>
              <span className="pfd-bar-value">{optimized.total.toLocaleString()}<em>tok</em></span>
            </li>
          </ul>

          <div className="pf2-strip pfd-exchange-strip">
            <div>
              <span className="pf2-cell-label">Input tokens saved</span>
              <span className="pf2-cell-value">{tokensSaved.toLocaleString()}</span>
            </div>
            <div>
              <span className="pf2-cell-label">Est. energy difference</span>
              <span className="pf2-cell-value">
                {formatValue(original.energyWh - optimized.energyWh)}
                <span className="pf2-cell-unit">Wh</span>
              </span>
            </div>
            <div>
              <span className="pf2-cell-label">Est. water difference</span>
              <span className="pf2-cell-value">
                {formatValue(original.waterMl - optimized.waterMl)}
                <span className="pf2-cell-unit">mL</span>
              </span>
            </div>
            <div>
              <span className="pf2-cell-label">Est. CO₂ difference</span>
              <span className="pf2-cell-value">
                {formatValue(original.co2G - optimized.co2G)}
                <span className="pf2-cell-unit">g</span>
              </span>
            </div>
          </div>

          <p className="pfd-exchange-note">
            The reply is held constant so the difference shown is the input side alone.
            Same intent, fewer input tokens — not a guarantee that a model would answer
            identically.
          </p>
        </>
      ) : (
        <p className="pfd-exchange-note">
          This prompt was sent as written, so there is no before-state to compare against.
          Tighten a prompt before sending to see the difference.
        </p>
      )}
    </section>
  )
}

/* ── The token readout during a reduction ───────────────────────────────────
   The count walks down from the old figure to the new one over exactly the
   window the text is contracting in, so the number and the paragraph are
   describing the same event. Tabular figures, so it never reflows the bar.
   Reduced motion lands on the final value immediately. */

function useCountdown(from, to, active, { reduced = false, duration = REDUCE_MS } = {}) {
  // The animation clock is the only thing in state, and it is only ever written
  // from inside the frame callback — never synchronously from the effect body,
  // which would just cascade a render on every activation. `from` is stored
  // alongside it so a fresh run is recognisable before its first frame lands.
  const [frame, setFrame] = useState({ from: null, t: 1 })

  useEffect(() => {
    if (!active || reduced) return undefined
    let raf = 0
    let start = 0
    const step = (now) => {
      if (!start) start = now
      const t = Math.min(1, (now - start) / duration)
      setFrame({ from, t })
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [from, active, reduced, duration])

  if (!active || reduced) return to
  if (frame.from !== from) return from
  return Math.round(from + (to - from) * frame.t)
}

/* ── The demo ───────────────────────────────────────────────────────────── */

/**
 * `demo` is the state machine, owned by the page rather than by this component:
 * the hero's headline metric is the same reading as the rail's, and two copies
 * of it would be two chances to disagree.
 */
export default function ChatDemo({ demo }) {
  const reduced = usePrefersReducedMotion()
  const [diffOpen, setDiffOpen] = useState(false)
  const taRef = useRef(null)
  const threadRef = useRef(null)

  const { status, analysis, draft, sent, live, exchange, responseText, reduction } = demo
  const streaming = status === 'responding'
  const conversing = status === 'sending' || streaming || status === 'complete' || status === 'comparing'

  // Grow the composer with its contents, the way a real one does. On desktop
  // the demo is a fixed-height panel, so the field stops growing and scrolls;
  // on a phone the whole panel grows with the page and the cap would just
  // reintroduce a nested scroller.
  useLayoutEffect(() => {
    const ta = taRef.current
    if (!ta || conversing || status === 'optimizing') return
    const cap = window.matchMedia('(max-width: 1000px)').matches ? Infinity : 260
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, cap)}px`
  }, [draft, conversing, status])

  // Follow the reply as it arrives, unless the visitor has asked for less motion.
  useEffect(() => {
    const el = threadRef.current
    if (!el || !conversing) return
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' })
  }, [responseText, conversing, reduced, sent])

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); demo.send() }
  }

  const onReset = () => { setDiffOpen(false); demo.reset() }

  const progress = streaming || status === 'complete' || status === 'comparing'
    ? demo.streamed / SAMPLE_RESPONSE.length
    : 0

  const reducing = status === 'optimizing'
  const shownTokens = useCountdown(
    reduction?.before ?? demo.draftTokens,
    reduction?.after ?? demo.draftTokens,
    reducing,
    { reduced },
  )

  return (
    <div className={`pfd pfd-${status}`} data-demo>
      {/* ── Top bar. Neutral by design: this is a sample surface, not an
             imitation of anyone's product. ─────────────────────────────── */}
      <header className="pfd-bar">
        <span className="pfd-model">
          <span className="u-micro u-micro-strong">AI chat</span>
          <span className="pfd-model-sep" aria-hidden="true" />
          <span className="u-micro">Demo</span>
        </span>
        <span className="pfd-bar-tag u-micro">Simulated · nothing is sent</span>
        <div className="pfd-bar-actions">
          {conversing && (
            <button type="button" className="pf2-btn is-quiet is-sm" onClick={onReset}>Reset</button>
          )}
          {!conversing && demo.custom && (
            <button type="button" className="pf2-btn is-quiet is-sm" onClick={onReset}>Try sample</button>
          )}
        </div>
      </header>

      <div className="pfd-body">
        <div className="pfd-main">
          {/* ── Conversation ──────────────────────────────────────────── */}
          {/* A scroll container is keyboard-focusable in Chromium, and a
              focusable region needs a name. `log` is the right role for a
              surface that gains messages over time. */}
          <div
            className="pfd-thread"
            ref={threadRef}
            role="log"
            aria-label="Demo conversation"
            tabIndex={0}
          >
            {!conversing && (
              <div className="pfd-blank">
                <p className="u-micro">A prompt is waiting below</p>
                <p>Tighten it, send it, and watch what the exchange costs.</p>
              </div>
            )}

            {conversing && sent && (
              <>
                <article className="pfd-msg is-user">
                  <span className="u-micro pfd-msg-role">You</span>
                  <p>{sent.text}</p>
                  <span className="u-micro pfd-msg-meta">{sent.promptTokens.toLocaleString()} input tokens</span>
                </article>

                <article className="pfd-msg is-assistant" aria-live="polite" aria-busy={streaming}>
                  <span className="u-micro pfd-msg-role">Sample assistant</span>
                  {responseText
                    ? <Reply text={responseText} streaming={streaming} />
                    : <p className="pfd-thinking"><span className="pfd-caret" aria-hidden="true" /></p>}
                </article>

                {exchange && (
                  <ExchangeCompare
                    exchange={exchange}
                    side={demo.compareSide}
                    onSide={(s) => demo.compare(s)}
                  />
                )}
              </>
            )}
          </div>

          {/* ── Composer ─────────────────────────────────────────────── */}
          {!conversing && (
            <div className="pfd-foot">
              <EfficiencyCheck demo={demo} />

              {reduction && status !== 'optimizing' && (
                <BeforeAfter
                  before={reduction.before}
                  after={reduction.after}
                  diff={reduction.diff}
                  open={diffOpen}
                  onToggle={() => setDiffOpen((o) => !o)}
                />
              )}

              <div className="pfd-composer">
                {status === 'optimizing' && analysis ? (
                  <ReductionView diff={analysis.diff} optimized={analysis.optimized} reduced={reduced} />
                ) : (
                  <>
                    <label className="u-sr" htmlFor="pfd-input">
                      Demo prompt. Edited and measured in this tab only.
                    </label>
                    <textarea
                      id="pfd-input"
                      ref={taRef}
                      className="pfd-input"
                      value={draft}
                      spellCheck="false"
                      rows={4}
                      onChange={(e) => { setDiffOpen(false); demo.setDraft(e.target.value) }}
                      onKeyDown={onKeyDown}
                      placeholder="Write a prompt…"
                    />
                  </>
                )}

                <div className="pfd-composer-bar">
                  <span className={`u-micro pfd-count${reducing ? ' is-falling' : ''}`}>
                    {(reducing ? shownTokens : demo.draftTokens).toLocaleString()} tokens
                  </span>
                  <div className="pfd-composer-actions">
                    {demo.custom && (
                      <button type="button" className="pf2-btn is-quiet is-sm" onClick={onReset}>
                        Try sample
                      </button>
                    )}
                    <button
                      type="button"
                      className="pf2-btn is-primary is-sm"
                      onClick={demo.send}
                      disabled={!draft.trim() || status === 'optimizing'}
                    >
                      Send
                    </button>
                  </div>
                </div>
              </div>

              <p className="pfd-privacy u-micro">
                Demo text stays in this tab — no request, no storage, no analytics.
              </p>
            </div>
          )}
        </div>

        <MeasureRail
          live={live}
          active={streaming}
          progress={progress}
          side={demo.compareSide}
        />
      </div>
    </div>
  )
}
