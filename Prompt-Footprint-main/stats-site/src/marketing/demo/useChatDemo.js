// The hero demo, as a state machine.
// ---------------------------------------------------------------------------
// One reducer owns the whole interaction. Scattered booleans are what makes a
// multi-step demo unpredictable — "is it optimizing or already optimized and
// also mid-send?" is not a question this file can be asked.
//
//   idle ──edit──► editing ──analysis lands──► idle
//    │
//    ├──tighten──► optimizing ──animation ends──► optimized
//    │                                              │
//    └──────────────── send ─────────────────────► sending
//                                                   │
//                                              responding
//                                                   │
//                                               complete ──compare──► comparing
//                                                   ▲                    │
//                                                   └────────────────────┘
//
// ── PRIVACY ────────────────────────────────────────────────────────────────
// Everything in here is ephemeral React state. The draft is never written to
// localStorage, sessionStorage, IndexedDB, cookies, a server action, or an
// analytics call, and it is never logged. There is no fetch in this module or
// anything it imports: `analyzePrompt` and `estimateTokens` are pure functions
// that run in the tab. Closing the tab is the whole deletion story.

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { analyzePrompt } from '../../lib/tokenCutter/index.ts'
import { buildDiff } from '../../lib/tokenCutter/apply.ts'
import { estimateTokens, impactForTokens } from '../../lib/tokenCutter/tokens.ts'
import { SAMPLE_PROMPT, SAMPLE_RESPONSE, CHUNK_MS } from './sample'

/** Analysis is debounced so typing does not run the pipeline on every keystroke. */
const ANALYZE_DEBOUNCE_MS = 300
/**
 * Above this the local pipeline is no longer instant on a slow machine. The
 * demo still counts tokens and estimates impact for longer text — it just stops
 * offering to rewrite it, and says so, rather than freezing the page.
 */
const ANALYZE_MAX_CHARS = 6000

/**
 * How long the reduction runs before the state settles.
 *
 * 190 ms of marking, then the collapse itself (--t-reduce, 640 ms), plus a beat
 * so the composer is not swapped back in over the last frame of the animation.
 */
export const REDUCE_MS = 900

const initial = {
  status: 'idle',
  /** The composer's contents. Ephemeral; see the privacy note above. */
  draft: SAMPLE_PROMPT,
  /** Local optimizer output for `draft`, or null while pending/unavailable. */
  analysis: null,
  /** True once the visitor has replaced the sample with their own writing. */
  custom: false,
  /** The exchange, once sent. */
  sent: null,
  /** Streamed chunks of the reply so far. */
  streamed: 0,
  /**
   * The reduction that was actually committed, captured at the moment Tighten
   * fires. `analysis` is immediately recomputed against the new shorter draft,
   * so this is the only point at which both halves of the before/after exist
   * together — and the landing page's headline metric reads it too.
   */
  reduction: null,
  /** Which side of the comparison the readout is showing. */
  compareSide: 'optimized',
}

function reducer(state, action) {
  switch (action.type) {
    case 'edit':
      // Any keystroke invalidates a pending or finished optimization: the
      // analysis on screen must always describe the text on screen.
      return {
        ...state,
        status: 'editing',
        draft: action.draft,
        analysis: null,
        // A hand edit ends the before/after: the text on screen is no longer
        // the optimizer's output, so the comparison no longer describes it.
        reduction: null,
        custom: action.draft !== SAMPLE_PROMPT,
      }
    case 'analysis':
      // A stale result (the draft moved on) is dropped rather than shown.
      if (action.forDraft !== state.draft) return state
      return { ...state, status: state.status === 'editing' ? 'idle' : state.status, analysis: action.analysis }
    case 'tighten': {
      const a = state.analysis
      if (!a?.tokensSaved) return state
      return {
        ...state,
        status: 'optimizing',
        reduction: {
          before: a.originalTokens,
          after: a.optimizedTokens,
          saved: a.tokensSaved,
          percent: a.percent,
          edits: a.edits,
          diff: a.diff,
        },
      }
    }
    case 'tightened':
      return {
        ...state,
        status: 'optimized',
        draft: state.analysis.optimized,
        // The optimized text becomes the draft, so it is re-analyzed from
        // scratch. Its own analysis is what decides whether anything is left to
        // remove — the demo never claims convergence it has not tested.
        analysis: null,
      }
    case 'send': {
      const text = state.draft.trim()
      if (!text) return state
      return {
        ...state,
        status: 'sending',
        sent: {
          text,
          promptTokens: estimateTokens(text),
          // Only set when this exact text came out of the optimizer this
          // session, so "compare original" can never invent a before-state.
          originalText: action.originalText || null,
          originalTokens: action.originalText ? estimateTokens(action.originalText) : null,
        },
        streamed: 0,
      }
    }
    case 'respond':
      return { ...state, status: 'responding' }
    case 'chunk':
      return { ...state, streamed: Math.min(action.n, SAMPLE_RESPONSE.length) }
    case 'complete':
      return { ...state, status: 'complete', streamed: SAMPLE_RESPONSE.length }
    case 'compare':
      return { ...state, status: 'comparing', compareSide: action.side || 'original' }
    case 'compareSide':
      return { ...state, compareSide: action.side }
    case 'endCompare':
      return { ...state, status: 'complete', compareSide: 'optimized' }
    case 'reset':
      return { ...initial, draft: action.draft ?? SAMPLE_PROMPT, custom: false }
    default:
      return state
  }
}

export function useChatDemo({ reducedMotion = false } = {}) {
  const [state, dispatch] = useReducer(reducer, initial)
  // The text as it was before Tighten replaced it — held only to power the
  // before/after readout, and cleared by Reset like everything else.
  const preTightenRef = useRef(null)

  // ── Analysis ──────────────────────────────────────────────────────────────
  // Local, pure, debounced. `analyzePrompt` performs no I/O; see privacy note.
  useEffect(() => {
    const text = state.draft
    if (!text.trim() || text.length > ANALYZE_MAX_CHARS) {
      dispatch({ type: 'analysis', forDraft: text, analysis: null })
      return undefined
    }
    const timer = setTimeout(() => {
      let result
      try {
        result = analyzePrompt(text, { level: 'balanced', platform: 'chatgpt' })
      } catch {
        // A pipeline failure must not take the demo down: token counting and
        // the resource estimate still work, the offer to tighten simply is not
        // made.
        dispatch({ type: 'analysis', forDraft: text, analysis: null })
        return
      }
      const originalTokens = estimateTokens(text)
      const optimizedTokens = estimateTokens(result.optimized)
      dispatch({
        type: 'analysis',
        forDraft: text,
        analysis: {
          optimized: result.optimized,
          originalTokens,
          optimizedTokens,
          tokensSaved: Math.max(0, originalTokens - optimizedTokens),
          percent: originalTokens > 0 ? ((originalTokens - optimizedTokens) / originalTokens) * 100 : 0,
          edits: result.suggestions.filter((s) => !s.advisory).length,
          valid: result.validation.ok,
          diff: buildDiff(text, result.suggestions, new Set(result.defaultAccepted), result.protectedSpans),
        },
      })
    }, ANALYZE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [state.draft])

  // ── Reduction animation ───────────────────────────────────────────────────
  // The state settles after the collapse has played. Under reduced motion the
  // swap is immediate — the information (what was removed, and what it cost) is
  // identical either way, it just does not move.
  useEffect(() => {
    if (state.status !== 'optimizing') return undefined
    const ms = reducedMotion ? 0 : REDUCE_MS
    const t = setTimeout(() => dispatch({ type: 'tightened' }), ms)
    return () => clearTimeout(t)
  }, [state.status, reducedMotion])

  // ── Send → stream ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (state.status !== 'sending') return undefined
    const t = setTimeout(() => dispatch({ type: 'respond' }), reducedMotion ? 0 : 320)
    return () => clearTimeout(t)
  }, [state.status, reducedMotion])

  useEffect(() => {
    if (state.status !== 'responding') return undefined
    if (reducedMotion) {
      dispatch({ type: 'complete' })
      return undefined
    }
    // rAF-driven rather than setInterval so the cadence does not drift and the
    // measurement rail climbs in step with the text, on one clock.
    let raf = 0
    let start = 0
    let last = -1
    const step = (now) => {
      if (!start) start = now
      const n = Math.min(SAMPLE_RESPONSE.length, Math.floor((now - start) / CHUNK_MS) + 1)
      if (n !== last) { last = n; dispatch({ type: 'chunk', n }) }
      if (n >= SAMPLE_RESPONSE.length) { dispatch({ type: 'complete' }); return }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [state.status, reducedMotion])

  // ── Derived readings ──────────────────────────────────────────────────────
  const responseText = useMemo(
    () => SAMPLE_RESPONSE.slice(0, state.streamed).join(''),
    [state.streamed],
  )

  /**
   * The live measurement for the exchange in flight.
   *
   * Prompt tokens are fixed the moment the message is sent; response tokens
   * accumulate as the reply arrives. The impact conversion is
   * `impactForTokens` — the extension's own model, GPT-4o anchor.
   */
  const live = useMemo(() => {
    if (!state.sent) return null
    const responseTokens = estimateTokens(responseText)
    const promptTokens = state.status === 'comparing' && state.compareSide === 'original' && state.sent.originalTokens
      ? state.sent.originalTokens
      : state.sent.promptTokens
    const total = promptTokens + responseTokens
    return { promptTokens, responseTokens, total, ...impactForTokens(total, 'chatgpt') }
  }, [state.sent, state.status, state.compareSide, responseText])

  /** The finished exchange, both ways, once a reply has completed. */
  const exchange = useMemo(() => {
    if (!state.sent || (state.status !== 'complete' && state.status !== 'comparing')) return null
    const responseTokens = estimateTokens(responseText)
    const optimized = state.sent.promptTokens
    const original = state.sent.originalTokens ?? optimized
    return {
      responseTokens,
      optimized: { promptTokens: optimized, total: optimized + responseTokens, ...impactForTokens(optimized + responseTokens, 'chatgpt') },
      original: { promptTokens: original, total: original + responseTokens, ...impactForTokens(original + responseTokens, 'chatgpt') },
      tokensSaved: Math.max(0, original - optimized),
      comparable: state.sent.originalTokens != null && state.sent.originalTokens > optimized,
    }
  }, [state.sent, state.status, responseText])

  // ── Actions ───────────────────────────────────────────────────────────────
  const setDraft = useCallback((draft) => {
    preTightenRef.current = null
    dispatch({ type: 'edit', draft })
  }, [])

  const tighten = useCallback(() => {
    preTightenRef.current = state.draft
    dispatch({ type: 'tighten' })
  }, [state.draft])

  const send = useCallback(() => {
    dispatch({ type: 'send', originalText: preTightenRef.current })
  }, [])

  const reset = useCallback(() => {
    preTightenRef.current = null
    dispatch({ type: 'reset' })
  }, [])

  const compare = useCallback((side) => {
    if (side === null) dispatch({ type: 'endCompare' })
    else if (state.status === 'comparing') dispatch({ type: 'compareSide', side })
    else dispatch({ type: 'compare', side })
  }, [state.status])

  return {
    ...state,
    responseText,
    live,
    exchange,
    /** True while a fresh analysis for the current draft has not landed yet. */
    analyzing: state.status === 'editing',
    /** Text long enough that the demo counts it but does not offer to rewrite it. */
    tooLongToOptimize: state.draft.length > ANALYZE_MAX_CHARS,
    /** Token count for whatever is in the composer right now. */
    draftTokens: estimateTokens(state.draft),
    setDraft, tighten, send, reset, compare,
  }
}
