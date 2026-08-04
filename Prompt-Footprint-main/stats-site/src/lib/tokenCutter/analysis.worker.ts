// Analysis worker.
// ---------------------------------------------------------------------------
// Stages 1–5 run off the main thread so a long prompt can never make the editor
// stutter while someone is typing in it. The result is plain data (no functions,
// no class instances), so it crosses the boundary by structured clone with no
// serialization step of our own.
//
// Protocol: every request carries an id and the worker echoes it back. The hook
// ignores any reply whose id is not the newest one, which is how a burst of
// keystrokes collapses to a single rendered result.

import { analyzePrompt } from './index.ts'
import type { CutterOptions, CutterResult } from './types.ts'

export interface AnalyzeRequest {
  id: number
  text: string
  options: Partial<CutterOptions>
}

export type AnalyzeResponse =
  | { id: number; ok: true; result: CutterResult }
  | { id: number; ok: false; error: string }

self.addEventListener('message', (event: MessageEvent<AnalyzeRequest>) => {
  const { id, text, options } = event.data
  try {
    const result = analyzePrompt(text, options)
    const reply: AnalyzeResponse = { id, ok: true, result }
    self.postMessage(reply)
  } catch (err) {
    // A worker crash would leave the UI stuck in "analyzing" forever, so every
    // failure is reported and the caller falls back to on-thread analysis.
    const reply: AnalyzeResponse = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : 'Analysis failed',
    }
    self.postMessage(reply)
  }
})
