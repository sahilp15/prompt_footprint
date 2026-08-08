import { useEffect, useRef, useCallback } from 'react'
import createGlobe from 'cobe'
import { GLOBE_MARKERS } from '../../lib/regions'

export default function Globe({ className = '' }) {
  const canvasRef = useRef(null)
  const globeRef = useRef(null)
  const animIdRef = useRef(null)
  const phiRef = useRef(0)

  // Drag / inertia state
  const pointerInteracting = useRef(null)
  const lastPointer = useRef(null)
  const dragOffset = useRef({ phi: 0, theta: 0 })
  const velocity = useRef({ phi: 0, theta: 0 })
  const phiOffsetRef = useRef(0)
  const thetaOffsetRef = useRef(0)
  const isPausedRef = useRef(false)

  const handlePointerDown = useCallback((e) => {
    pointerInteracting.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.style.cursor = 'grabbing'
    isPausedRef.current = true
  }, [])

  useEffect(() => {
    const onMove = (e) => {
      if (!pointerInteracting.current) return
      const dx = e.clientX - pointerInteracting.current.x
      const dy = e.clientY - pointerInteracting.current.y
      dragOffset.current = { phi: dx / 300, theta: dy / 1000 }
      const now = Date.now()
      if (lastPointer.current) {
        const dt = Math.max(now - lastPointer.current.t, 1)
        velocity.current = {
          phi:   Math.max(-0.15, Math.min(0.15, ((e.clientX - lastPointer.current.x) / dt) * 0.3)),
          theta: Math.max(-0.15, Math.min(0.15, ((e.clientY - lastPointer.current.y) / dt) * 0.08)),
        }
      }
      lastPointer.current = { x: e.clientX, y: e.clientY, t: now }
    }
    const onUp = () => {
      if (pointerInteracting.current) {
        phiOffsetRef.current += dragOffset.current.phi
        thetaOffsetRef.current += dragOffset.current.theta
        dragOffset.current = { phi: 0, theta: 0 }
        lastPointer.current = null
      }
      pointerInteracting.current = null
      isPausedRef.current = false
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerup', onUp,   { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Tear down completely, including the ref guard below. Without clearing
    // it, StrictMode's mount → unmount → remount in development left the guard
    // pointing at an already-destroyed instance, so the second mount bailed out
    // and the canvas kept whatever frame the first one happened to end on.
    const teardown = () => {
      if (animIdRef.current) cancelAnimationFrame(animIdRef.current)
      animIdRef.current = null
      globeRef.current?.destroy()
      globeRef.current = null
    }

    const init = () => {
      const width = canvas.offsetWidth
      if (width === 0 || globeRef.current) return

      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      globeRef.current = createGlobe(canvas, {
        devicePixelRatio: dpr,
        width:  width * dpr,
        height: width * dpr,
        phi: 0,
        theta: 0.2,
        dark: 0,
        diffuse: 1.2,
        mapSamples: 16000,
        // With `dark: 0` cobe shades a land dot as baseColor × (1 − mapBrightness
        // + 0.1), so a brightness *below* 1 is what draws the continents darker
        // than the sphere. At the previous value of 10 the term went negative
        // and clamped, and a pure-white base left nothing to see either way.
        // Parchment sphere, sepia landmasses, clay markers.
        mapBrightness: 0.72,
        baseColor:   [0.87, 0.84, 0.78],
        markerColor: [0.63, 0.32, 0.14],
        glowColor:   [0.82, 0.80, 0.76],
        markers: GLOBE_MARKERS,
      })

      const animate = () => {
        if (!isPausedRef.current) {
          phiRef.current += 0.003
          if (Math.abs(velocity.current.phi) > 0.0001 || Math.abs(velocity.current.theta) > 0.0001) {
            phiOffsetRef.current   += velocity.current.phi
            thetaOffsetRef.current += velocity.current.theta
            velocity.current.phi   *= 0.95
            velocity.current.theta *= 0.95
          }
          const tMin = -0.4, tMax = 0.4
          if (thetaOffsetRef.current < tMin) thetaOffsetRef.current += (tMin - thetaOffsetRef.current) * 0.1
          if (thetaOffsetRef.current > tMax) thetaOffsetRef.current += (tMax - thetaOffsetRef.current) * 0.1
        }
        globeRef.current.update({
          phi:   phiRef.current + phiOffsetRef.current + dragOffset.current.phi,
          theta: 0.2 + thetaOffsetRef.current + dragOffset.current.theta,
        })
        animIdRef.current = requestAnimationFrame(animate)
      }
      animate()
      setTimeout(() => { if (canvas) canvas.style.opacity = '1' })
    }

    if (canvas.offsetWidth > 0) {
      init()
    } else {
      const ro = new ResizeObserver(entries => {
        if (entries[0]?.contentRect.width > 0) { ro.disconnect(); init() }
      })
      ro.observe(canvas)
      return () => { ro.disconnect(); teardown() }
    }
    return teardown
  }, [])

  return (
    <div
      className={className}
      style={{ position: 'relative', width: '100%', aspectRatio: '1', userSelect: 'none' }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        style={{
          width: '100%',
          height: '100%',
          cursor: 'grab',
          opacity: 0,
          transition: 'opacity 1.2s ease',
          borderRadius: '50%',
          touchAction: 'none',
        }}
      />
    </div>
  )
}
