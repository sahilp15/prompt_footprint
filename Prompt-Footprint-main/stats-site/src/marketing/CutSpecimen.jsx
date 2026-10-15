import { useMemo, useState } from 'react'
import { analyzePrompt } from '../lib/tokenCutter/index.ts'
import { buildDiff } from '../lib/tokenCutter/apply.ts'
import { impactForTokens } from '../lib/tokenCutter/tokens.ts'

// The hero figure. Not an illustration: this is the real Token Cutter engine —
// the one the extension ships — running in the visitor's browser on three
// sample drafts. Every number below is computed, none is typed in.
const SAMPLES = [
  {
    id: 'email',
    label: 'Email',
    text: 'Hi! I was wondering if you could please help me write a short email to my professor asking for an extension on my lab report. I would really appreciate it if you could make sure that it sounds polite and professional. Thank you so much in advance!',
  },
  {
    id: 'code',
    label: 'Debugging',
    text: 'Hello, could you please take a look at the following Python function and explain to me why it is basically returning None instead of the list? I would really like you to also suggest a fix if possible. Thanks!',
  },
  {
    id: 'study',
    label: 'Studying',
    text: 'Hello! Could you please explain in simple terms how photosynthesis works? I am basically just a high school student, so I would really like it if you could keep the explanation short. Thanks a lot!',
  },
]

// Per-prompt figures are a few hundredths of a watt-hour — true, but too small
// to mean anything. Scaling to a stated volume keeps them honest and legible.
const SCALE = 1000

function fmt(n, digits) {
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export default function CutSpecimen() {
  const [sampleId, setSampleId] = useState(SAMPLES[0].id)
  const sample = SAMPLES.find((s) => s.id === sampleId)

  const view = useMemo(() => {
    const r = analyzePrompt(sample.text)
    const diff = buildDiff(r.original, r.suggestions, new Set(r.defaultAccepted), r.protectedSpans)
    const { originalTokens, optimizedTokens } = r.analytics
    const avoided = Math.max(0, originalTokens - optimizedTokens)
    return {
      diff,
      optimized: r.optimized,
      before: originalTokens,
      after: optimizedTokens,
      avoided,
      pct: originalTokens ? Math.round((avoided / originalTokens) * 100) : 0,
      impact: impactForTokens(avoided * SCALE, 'chatgpt'),
    }
  }, [sample])

  // Arrow keys move between tabs, per the WAI-ARIA tabs pattern.
  const onTabKey = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const i = SAMPLES.findIndex((s) => s.id === sampleId)
    const next = SAMPLES[(i + (e.key === 'ArrowRight' ? 1 : SAMPLES.length - 1)) % SAMPLES.length]
    setSampleId(next.id)
    e.currentTarget.querySelectorAll('[role="tab"]')[SAMPLES.indexOf(next)]?.focus()
  }

  return (
    <div className="cs" aria-label="Token Cutter example">
      <div className="cs-head">
        <span className="cs-title">Token Cutter</span>
        <div className="cs-tabs" role="tablist" aria-label="Sample prompt" onKeyDown={onTabKey}>
          {SAMPLES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === sampleId}
              tabIndex={s.id === sampleId ? 0 : -1}
              aria-controls="cs-panel"
              className={`cs-tab${s.id === sampleId ? ' is-active' : ''}`}
              onClick={() => setSampleId(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="cs-body" id="cs-panel" role="tabpanel" key={sampleId}>
        <p className="cs-label">Draft</p>
        <p className="cs-draft">
          {view.diff.map((part, i) => {
            if (part.kind === 'removed') return <del key={i}>{part.text}</del>
            if (part.kind === 'added') return <ins key={i}>{part.text}</ins>
            return <span key={i}>{part.text}</span>
          })}
        </p>

        <p className="cs-label">What gets sent</p>
        <p className="cs-sent">{view.optimized}</p>
      </div>

      <div className="cs-meter" aria-label={`${view.before} tokens before, ${view.after} after`}>
        <div className="cs-bar-row">
          <span className="cs-bar-name">Before</span>
          <span className="cs-bar"><span style={{ '--w': '100%' }} /></span>
          <span className="cs-bar-val">{view.before}</span>
        </div>
        <div className="cs-bar-row is-after">
          <span className="cs-bar-name">After</span>
          <span className="cs-bar"><span style={{ '--w': `${(view.after / view.before) * 100}%` }} /></span>
          <span className="cs-bar-val">{view.after}</span>
        </div>
      </div>

      <dl className="cs-readout">
        <div className="cs-read cs-read-lead">
          <dt>Input tokens avoided</dt>
          <dd><strong>{view.avoided}</strong> <span>−{view.pct}%</span></dd>
        </div>
        <div className="cs-read">
          <dt>Energy</dt>
          <dd className="is-energy">{fmt(view.impact.energyWh, 1)} <span>Wh</span></dd>
        </div>
        <div className="cs-read">
          <dt>Water</dt>
          <dd className="is-water">{fmt(view.impact.waterMl, 0)} <span>mL</span></dd>
        </div>
        <div className="cs-read">
          <dt>CO₂e</dt>
          <dd className="is-carbon">{fmt(view.impact.co2G, 1)} <span>g</span></dd>
        </div>
      </dl>
      <p className="cs-foot">
        Estimated input-processing reduction across {SCALE.toLocaleString()} prompts like this one.
      </p>
    </div>
  )
}
