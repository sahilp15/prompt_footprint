// Native view transitions, used only where they carry meaning.
// ---------------------------------------------------------------------------
// Two places earn one: switching what the main chart is plotting (the axis and
// the trace are replaced, and a crossfade says "same instrument, different
// reading"), and opening a session out of the ledger (the row becomes the
// detail). Everything else changes without one.
//
// Feature-detected and motion-aware. When `document.startViewTransition` is
// missing, or the visitor has asked for reduced motion, the update is applied
// directly — same result, no animation. Nothing about the app depends on
// support: this is a wrapper around a state setter, not a rendering path.

import { flushSync } from 'react-dom'

/**
 * Run `update` inside a view transition where that is available and wanted.
 *
 * `update` sets state. React would normally commit that on its own schedule,
 * which can land after the transition has already captured the "after" frame —
 * so the commit is flushed synchronously inside the callback. That is exactly
 * what `flushSync` is for, and it is scoped to these two interactions rather
 * than being reached for anywhere else.
 */
export function withViewTransition(update, { reducedMotion = false } = {}) {
  if (
    reducedMotion ||
    typeof document === 'undefined' ||
    typeof document.startViewTransition !== 'function'
  ) {
    update()
    return
  }
  document.startViewTransition(() => flushSync(update))
}
