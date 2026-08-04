// Motion primitives shared by the animated pages (Awards, Token Cutter).
//
// Every hook here is accessibility-first: when the OS reports
// `prefers-reduced-motion: reduce`, elements start in their final state and
// counters jump straight to their target value. Nothing animates, nothing is
// hidden — the page is simply static.

import { useEffect, useRef, useState } from 'react'

/** True when the user has asked the OS to minimize animation. Live-updating. */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (e) => setReduced(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return reduced
}

/**
 * Reveal-on-scroll. Returns `[ref, visible]`; attach the ref to the element and
 * drive a CSS class off `visible`. Fires once, then disconnects — no scroll
 * listener, no layout thrash. Falls back to "always visible" when
 * IntersectionObserver is unavailable or motion is reduced.
 */
export function useReveal({ threshold = 0.15, rootMargin = '0px 0px -8% 0px', fallbackMs = 1500 } = {}) {
  const reduced = usePrefersReducedMotion()
  const noObserver = typeof IntersectionObserver === 'undefined'
  const ref = useRef(null)
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    const el = ref.current
    // Nothing to observe when motion is reduced or the API is missing — the
    // returned flag is already true in those cases, so content stays visible.
    if (!el || reduced || noObserver) return

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true)
          io.disconnect()
        }
      },
      { threshold, rootMargin },
    )
    io.observe(el)

    // Safety net. An entrance animation must never be the reason content is
    // missing — full-page screenshots, printing, in-page search, and scroll
    // containers the observer does not track can all leave an element that
    // never "intersects". After a short delay everything is shown regardless.
    const timer = setTimeout(() => { setSeen(true); io.disconnect() }, fallbackMs)

    return () => { clearTimeout(timer); io.disconnect() }
  }, [reduced, noObserver, threshold, rootMargin, fallbackMs])

  return [ref, seen || reduced || noObserver]
}

/**
 * Count a number up from 0 to `target` once `active` turns true.
 * Uses a single rAF loop with an ease-out curve and stops exactly on target.
 * Reduced motion (or `active === false`) returns the final value immediately.
 */
export function useCountUp(target, active, { duration = 1100 } = {}) {
  const reduced = usePrefersReducedMotion()
  const skip = reduced || typeof requestAnimationFrame === 'undefined'
  // Only the 0→1 progress lives in state; the displayed number is derived, so
  // `target` can change without restarting or desyncing the animation.
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (skip || !active) return
    let raf = 0
    let start = 0
    const step = (now) => {
      if (!start) start = now
      const t = Math.min(1, (now - start) / duration)
      // easeOutCubic — fast start, gentle settle. Ends exactly on 1.
      setProgress(1 - Math.pow(1 - t, 3))
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [active, skip, duration])

  return skip ? target : target * progress
}
