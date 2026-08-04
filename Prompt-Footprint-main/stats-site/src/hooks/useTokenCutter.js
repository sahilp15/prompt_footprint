// Token Cutter — UI state.
// ---------------------------------------------------------------------------
// One hook owns the whole feature's state so the components stay presentational.
//
// Three invariants it enforces:
//   1. `text` is the user's writing and is only ever changed by the user.
//   2. Everything shown is derived from (text, acceptedIds). Accept, reject,
//      undo, and restore are all just changes to that pair.
//   3. Heavy analysis runs in a worker, debounced; toggling a suggestion is a
//      cheap main-thread recompute so the UI stays instant.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analyzePrompt, recompute } from '../lib/tokenCutter/index.ts'
import { buildDiff } from '../lib/tokenCutter/apply.ts'
import { enhanceWithGemini } from '../lib/tokenCutter/gemini.ts'
import { culpableSuggestionIds } from '../lib/tokenCutter/validate.ts'
import { countWords, estimateTokens, impactForTokens } from '../lib/tokenCutter/tokens.ts'
import AnalysisWorker from '../lib/tokenCutter/analysis.worker.ts?worker'

const DEBOUNCE_MS = 320
/** Below this, on-thread analysis is faster than the round trip to a worker. */
const WORKER_THRESHOLD_CHARS = 600
const MAX_HISTORY = 50

/** Token/impact figures for a wholesale replacement (the enhanced path). */
function analyticsFor(original, optimized, platform) {
  const originalTokens = estimateTokens(original)
  const optimizedTokens = estimateTokens(optimized)
  const tokensSaved = Math.max(0, originalTokens - optimizedTokens)
  return {
    originalWords: countWords(original),
    optimizedWords: countWords(optimized),
    originalTokens,
    optimizedTokens,
    tokensSaved,
    percentReduction: originalTokens > 0 ? (tokensSaved / originalTokens) * 100 : 0,
    saved: impactForTokens(tokensSaved, platform),
  }
}

export function useTokenCutter({ memory, platform = 'chatgpt', proxyUrl = '', mode = 'local' }) {
  const [text, setText] = useState('')
  const [level, setLevel] = useState('balanced')
  const [analysis, setAnalysis] = useState(null)
  const [accepted, setAccepted] = useState(() => new Set())
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState(null)
  const [enhancement, setEnhancement] = useState(null)
  const [enhancing, setEnhancing] = useState(false)
  // Undo stack of accepted-id snapshots. The draft text is never on it — a
  // textarea has native undo and hijacking that would be hostile.
  const [history, setHistory] = useState([])
  // The draft as it was before "Use optimized prompt" replaced it. Applying
  // starts a fresh analysis whose own `original` is the optimized text, so
  // without this the user's actual writing would be unrecoverable.
  const [restorePoint, setRestorePoint] = useState(null)

  const workerRef = useRef(null)
  const requestIdRef = useRef(0)

  // ── Worker lifecycle ──────────────────────────────────────────────────────
  useEffect(() => {
    let worker
    try {
      worker = new AnalysisWorker()
    } catch {
      // No worker support, or a blocked blob URL. Analysis still runs, just on
      // the main thread — degraded, not broken.
      return undefined
    }
    workerRef.current = worker
    return () => {
      workerRef.current = null
      worker.terminate()
    }
  }, [])

  // ── Analysis ──────────────────────────────────────────────────────────────
  const options = useMemo(
    () => ({ level, platform, memory, allowProtectedEdits: false }),
    [level, platform, memory],
  )

  useEffect(() => {
    if (!text.trim()) {
      requestIdRef.current += 1 // invalidate anything in flight
      setAnalysis(null)
      setAccepted(new Set())
      setEnhancement(null)
      setHistory([])
      setAnalyzing(false)
      setError(null)
      return undefined
    }

    setAnalyzing(true)
    const timer = setTimeout(() => {
      const id = ++requestIdRef.current
      const worker = workerRef.current

      const finish = (next) => {
        if (id !== requestIdRef.current) return // a newer request won
        setAnalysis(next)
        setAccepted(new Set(next.defaultAccepted))
        setHistory([])
        setEnhancement(null)
        setError(null)
        setAnalyzing(false)
      }

      const fail = (message) => {
        if (id !== requestIdRef.current) return
        setError(message)
        setAnalyzing(false)
      }

      if (!worker || text.length < WORKER_THRESHOLD_CHARS) {
        try {
          finish(analyzePrompt(text, options))
        } catch (err) {
          fail(err instanceof Error ? err.message : 'Analysis failed')
        }
        return
      }

      const onMessage = (event) => {
        if (event.data?.id !== id) return
        worker.removeEventListener('message', onMessage)
        if (event.data.ok) { finish(event.data.result); return }
        // The worker failed; retry on the main thread rather than showing the
        // user an error they can do nothing about.
        try { finish(analyzePrompt(text, options)) } catch { fail(event.data.error) }
      }
      worker.addEventListener('message', onMessage)
      worker.postMessage({ id, text, options })
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [text, options])

  // ── Derived result ────────────────────────────────────────────────────────
  const result = useMemo(() => {
    if (!analysis) return null
    const local = recompute(analysis, accepted, platform)
    if (!enhancement?.optimized) return local

    // An enhanced rewrite replaces the optimized text wholesale, so its figures
    // are measured against that text and its validation report is the one the
    // enhancement path produced — locally, with the same validator.
    return {
      ...local,
      optimized: enhancement.optimized,
      validation: enhancement.validation ?? local.validation,
      mode: 'enhanced',
      enhancement: enhancement.report,
      analytics: {
        ...local.analytics,
        ...analyticsFor(analysis.original, enhancement.optimized, platform),
      },
    }
  }, [analysis, accepted, platform, enhancement])

  const diff = useMemo(() => {
    if (!analysis) return []
    return buildDiff(analysis.original, analysis.suggestions, accepted, analysis.protectedSpans)
  }, [analysis, accepted])

  // ── Suggestion controls ───────────────────────────────────────────────────
  const commit = useCallback((nextFrom) => {
    setAccepted((prev) => {
      setHistory((h) => [...h.slice(-(MAX_HISTORY - 1)), prev])
      return nextFrom(prev)
    })
    setEnhancement(null)
  }, [])

  const setDecision = useCallback((id, value) => {
    commit((prev) => {
      const next = new Set(prev)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })
  }, [commit])

  const acceptAll = useCallback(() => {
    if (!analysis) return
    commit(() => new Set(analysis.suggestions.filter((s) => !s.advisory).map((s) => s.id)))
  }, [analysis, commit])

  const acceptSafe = useCallback(() => {
    if (!analysis) return
    commit(() => new Set(analysis.defaultAccepted))
  }, [analysis, commit])

  const rejectAll = useCallback(() => commit(() => new Set()), [commit])

  /**
   * Undo exactly the changes the validator blamed for losing information —
   * rather than making the user throw away every saving to recover one
   * requirement.
   */
  const repairLosses = useCallback(() => {
    const culpable = culpableSuggestionIds(result?.validation ?? { issues: [] })
    if (!culpable.length) return
    commit((prev) => {
      const next = new Set(prev)
      for (const id of culpable) next.delete(id)
      return next
    })
  }, [result, commit])

  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h
      setAccepted(new Set(h[h.length - 1]))
      setEnhancement(null)
      return h.slice(0, -1)
    })
  }, [])

  /**
   * Replace the draft with the optimized text — the only destructive action in
   * the feature, and only ever on an explicit click. The text being replaced
   * becomes the restore point.
   */
  const applyToEditor = useCallback(() => {
    if (!result?.optimized || result.optimized === text) return
    setRestorePoint(text)
    setText(result.optimized)
  }, [result, text])

  /** Put the user's own writing back, exactly as they last typed it. */
  const restoreOriginal = useCallback(() => {
    if (restorePoint === null) return
    setText(restorePoint)
    setRestorePoint(null)
    setAccepted(new Set())
    setEnhancement(null)
    setHistory([])
  }, [restorePoint])

  // ── Optional enhancement ──────────────────────────────────────────────────
  const runEnhancement = useCallback(async () => {
    if (!analysis || mode !== 'enhanced') return
    setEnhancing(true)
    try {
      setEnhancement(await enhanceWithGemini({
        text: analysis.original,
        proxyUrl,
        level,
        protectedContent: analysis.protectedSpans.map((s) => s.text),
        constraints: analysis.constraints,
        entities: analysis.entities,
      }))
    } finally {
      setEnhancing(false)
    }
  }, [analysis, mode, proxyUrl, level])

  // Switching back to local processing drops any remote result.
  useEffect(() => {
    if (mode === 'local') setEnhancement(null)
  }, [mode])

  return {
    text, setText,
    level, setLevel,
    analysis, result, diff,
    accepted, setDecision, acceptAll, acceptSafe, rejectAll,
    undo, canUndo: history.length > 0, repairLosses,
    canRepair: culpableSuggestionIds(result?.validation ?? { issues: [] }).length > 0,
    applyToEditor, restoreOriginal, canRestore: restorePoint !== null,
    analyzing, error,
    runEnhancement, enhancing,
    enhancement: enhancement?.report ?? null,
  }
}
