import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowRight, Cloud, Cpu, Loader2, RotateCcw, Scissors, Undo2,
} from 'lucide-react'
import { useTokenCutter } from '../../hooks/useTokenCutter'
import { useCutterMemory } from '../../hooks/useCutterMemory'
import { fetchConfig, resolveWritingProvider } from '../../lib/api'
import AnalyticsRail from './AnalyticsRail'
import ComparisonView from './ComparisonView'
import ExplainPanel from './ExplainPanel'
import MemoryPanel from './MemoryPanel'
import SuggestionList from './SuggestionList'
import './TokenCutter.css'

const LEVELS = [
  { id: 'light', label: 'Light', blurb: 'Fix errors and obvious filler. Keeps your voice.' },
  { id: 'balanced', label: 'Balanced', blurb: 'Cut hard while preserving tone, context, and meaning.' },
  { id: 'maximum', label: 'Maximum', blurb: 'Smallest prompt that still carries every requirement.' },
]

const SAMPLE = `Hi there! I was wondering if you could please help me out with something.

Basically, I really just need you to write a summary of our Q3 report for the leadership team. Please make sure the response is professional, but not too formal, and keep it under 200 words.

Oh, and remember to keep it under 200 words. Do not mention the pricing changes. Return it as markdown.

Thanks so much in advance!`

/** Cmd on macOS, Ctrl elsewhere — used only for the shortcut hints. */
function modifierLabel() {
  if (typeof navigator === 'undefined') return 'Ctrl'
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl'
}

export default function TokenCutter() {
  const [mode, setMode] = useState('local')
  const [platform, setPlatform] = useState('chatgpt')
  const [config, setConfig] = useState(null)
  const [explainOpen, setExplainOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [focusedId, setFocusedId] = useState(null)
  const [toast, setToast] = useState(null)
  const textareaRef = useRef(null)

  const memoryStore = useCutterMemory()
  const proxyUrl = config?.proxyUrl ?? ''
  const enhancedAvailable = config ? resolveWritingProvider(config) === 'gemini' : false

  const cutter = useTokenCutter({
    memory: memoryStore.memory,
    platform,
    proxyUrl,
    mode,
  })

  const {
    text, setText, level, setLevel, analysis, result, diff, accepted,
    setDecision, acceptAll, acceptSafe, rejectAll, undo, canUndo,
    applyToEditor, restoreOriginal, canRestore, analyzing, error, repairLosses, canRepair,
    runEnhancement, enhancing, enhancement,
  } = cutter

  // Settings are only readable inside the extension; on the public web build
  // this resolves to the defaults, which means "local only".
  useEffect(() => { fetchConfig().then(setConfig) }, [])

  const showToast = useCallback((message) => {
    setToast(message)
    setTimeout(() => setToast(null), 2200)
  }, [])

  const copyOptimized = useCallback(async () => {
    if (!result?.optimized) return
    try {
      await navigator.clipboard.writeText(result.optimized)
      showToast('Optimized prompt copied')
    } catch {
      showToast('Copy failed — select the text in the Optimized pane instead')
    }
  }, [result, showToast])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  // Deliberately narrow. Ctrl/Cmd+Z is left alone while the textarea has focus
  // so native undo keeps working where people expect it.
  useEffect(() => {
    const onKeyDown = (event) => {
      const mod = event.metaKey || event.ctrlKey
      if (!mod) return
      const inEditor = event.target === textareaRef.current

      if (event.key === 'Enter') {
        event.preventDefault()
        acceptSafe()
        showToast('Safe suggestions applied')
        return
      }
      if (event.shiftKey && (event.key === 'C' || event.key === 'c')) {
        event.preventDefault()
        copyOptimized()
        return
      }
      if (!inEditor && !event.shiftKey && (event.key === 'z' || event.key === 'Z')) {
        event.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [acceptSafe, copyOptimized, undo, showToast])

  const mod = modifierLabel()
  const hasText = text.trim().length > 0
  const suggestions = analysis?.suggestions ?? []
  const validation = result?.validation ?? null

  return (
    <div className="tc-page">
      <header className="tc-hero">
        <p className="tc-eyebrow">
          <Scissors size={13} aria-hidden="true" />
          <span>Token Cutter</span>
        </p>
        <h1 className="tc-title">Say the same thing in fewer tokens</h1>
        <p className="tc-sub">
          Paste a prompt. Every suggestion explains itself, nothing is changed
          without your say-so, and the result is checked against your original
          before it is offered.
        </p>
      </header>

      <div className="tc-toolbar">
        <div className="tc-levels" role="radiogroup" aria-label="Optimization level">
          {LEVELS.map((l) => (
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={level === l.id}
              className={`tc-level${level === l.id ? ' is-on' : ''}`}
              onClick={() => setLevel(l.id)}
              title={l.blurb}
            >
              {l.label}
            </button>
          ))}
        </div>

        <div className="tc-toolbar-right">
          <label className="tc-select">
            <span className="tc-visually-hidden">Platform for impact figures</span>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="chatgpt">ChatGPT</option>
              <option value="claude">Claude</option>
            </select>
          </label>

          <div className="tc-modes" role="radiogroup" aria-label="Processing mode">
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'local'}
              className={`tc-mode${mode === 'local' ? ' is-on' : ''}`}
              onClick={() => setMode('local')}
            >
              <Cpu size={13} aria-hidden="true" /> Local
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'enhanced'}
              className={`tc-mode${mode === 'enhanced' ? ' is-on' : ''}`}
              onClick={() => setMode('enhanced')}
              disabled={!enhancedAvailable}
              title={enhancedAvailable
                ? 'Send this prompt to your configured Gemini proxy for a second opinion'
                : 'Add a Worker URL in Settings to enable enhanced processing'}
            >
              <Cloud size={13} aria-hidden="true" /> Enhanced AI
            </button>
          </div>
        </div>
      </div>

      <p className="tc-mode-note">
        {mode === 'local'
          ? 'Local processing — everything runs on this device and nothing is sent anywhere.'
          : 'Enhanced processing — the prompt is sent to the Gemini proxy you configured. Local results are used if it is unavailable.'}
      </p>

      <div className="tc-layout">
        <div className="tc-main">
          <section className="tc-editor-wrap" aria-labelledby="tc-editor-label">
            <div className="tc-editor-head">
              <label id="tc-editor-label" htmlFor="tc-editor" className="tc-pane-title">Your prompt</label>
              <span className="tc-editor-status" aria-live="polite">
                {analyzing
                  ? <><Loader2 size={13} className="tc-spin" aria-hidden="true" /> Analyzing…</>
                  : hasText ? `${result?.analytics.originalTokens ?? 0} tokens` : 'Ready'}
              </span>
            </div>
            <textarea
              id="tc-editor"
              ref={textareaRef}
              className="tc-editor"
              value={text}
              spellCheck="true"
              placeholder="Paste the prompt you are about to send…"
              onChange={(e) => setText(e.target.value)}
              aria-describedby="tc-editor-help"
            />
            <p id="tc-editor-help" className="tc-editor-help">
              <kbd>{mod}</kbd>+<kbd>Enter</kbd> apply safe suggestions ·{' '}
              <kbd>{mod}</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> copy result ·{' '}
              <kbd>{mod}</kbd>+<kbd>Z</kbd> undo a decision (outside the editor)
            </p>
          </section>

          {!hasText && (
            <div className="tc-empty">
              <Scissors size={24} aria-hidden="true" />
              <h2>Nothing to cut yet</h2>
              <p>
                Paste a prompt above, or try one that shows what the cutter does
                with repetition, filler, and constraints it must protect.
              </p>
              <button type="button" className="tc-primary" onClick={() => setText(SAMPLE)}>
                Load an example prompt
              </button>
            </div>
          )}

          {error && (
            <div className="tc-alert" role="alert">
              <AlertTriangle size={15} aria-hidden="true" />
              <div>
                <strong>Analysis failed.</strong>
                <p>{error} Your prompt is untouched — edit it and it will try again.</p>
              </div>
            </div>
          )}

          {hasText && result && (
            <>
              <div className="tc-actions">
                <button type="button" className="tc-primary" onClick={applyToEditor} disabled={result.optimized === text}>
                  <ArrowRight size={14} aria-hidden="true" /> Use optimized prompt
                </button>
                <button type="button" className="tc-secondary" onClick={copyOptimized}>Copy result</button>
                <button type="button" className="tc-secondary" onClick={undo} disabled={!canUndo}>
                  <Undo2 size={14} aria-hidden="true" /> Undo
                </button>
                <button
                  type="button"
                  className="tc-secondary"
                  onClick={restoreOriginal}
                  disabled={!canRestore}
                  title={canRestore
                    ? 'Put your own wording back, exactly as you last typed it'
                    : 'Available once you have replaced your draft with the optimized prompt'}
                >
                  <RotateCcw size={14} aria-hidden="true" /> Restore original
                </button>
                {mode === 'enhanced' && (
                  <button type="button" className="tc-secondary" onClick={runEnhancement} disabled={enhancing}>
                    {enhancing
                      ? <><Loader2 size={14} className="tc-spin" aria-hidden="true" /> Asking Gemini…</>
                      : <><Cloud size={14} aria-hidden="true" /> Run enhanced pass</>}
                  </button>
                )}
              </div>

              {enhancement && (
                <div className={`tc-enhance ${enhancement.applied ? 'is-ok' : 'is-fallback'}`} role="status">
                  <strong>{enhancement.status}</strong>
                  {enhancement.applied ? (
                    <>
                      <p>
                        The rewrite passed the same local checks as every other
                        suggestion. The model rated meaning preservation at{' '}
                        {Math.round((enhancement.meaningScore ?? 0) * 100)}%; the
                        figure that matters is the local check in the Impact panel.
                      </p>
                      {enhancement.uncertainChanges?.length > 0 && (
                        <>
                          <h4 className="tc-subhead">Changes it was unsure about</h4>
                          <ul>{enhancement.uncertainChanges.map((c) => <li key={c}>{c}</li>)}</ul>
                        </>
                      )}
                    </>
                  ) : (
                    <p>{enhancement.fallbackReason}</p>
                  )}
                </div>
              )}

              <ComparisonView
                diff={diff}
                optimized={result.optimized}
                refinements={result.refinements}
                focusedId={focusedId}
                onFocus={setFocusedId}
              />

              <ExplainPanel
                explanation={result.explanation}
                open={explainOpen}
                onToggle={() => setExplainOpen((v) => !v)}
              />
            </>
          )}

          {/* Outside the has-text branch: preferences must be reachable even
              with an empty editor. */}
          <MemoryPanel
            memory={memoryStore.memory}
            applied={result?.appliedMemories ?? []}
            constraints={result?.constraints ?? []}
            open={memoryOpen}
            onToggle={() => setMemoryOpen((v) => !v)}
            controls={memoryStore}
          />
        </div>

        {hasText && result && (
          <aside className="tc-rail">
            <AnalyticsRail analytics={result.analytics} validation={validation} platform={platform} />
            <SuggestionList
              suggestions={suggestions}
              accepted={accepted}
              onDecide={setDecision}
              onFocus={setFocusedId}
              onAcceptSafe={acceptSafe}
              onAcceptAll={acceptAll}
              onRejectAll={rejectAll}
              validation={validation}
              onRepair={canRepair ? repairLosses : null}
            />
          </aside>
        )}
      </div>

      <div className="tc-toast" role="status" aria-live="polite">
        {toast && <span className="tc-toast-body">{toast}</span>}
      </div>
    </div>
  )
}
