import { useEffect, useRef, useCallback } from 'react'
import createGlobe from 'cobe'

const MARKERS = [
  { id: 'ashburn',   location: [39.0458, -76.8755], label: 'Ashburn, VA' },
  { id: 'dublin',    location: [53.3498, -6.2603],  label: 'Dublin, IE' },
  { id: 'mumbai',    location: [19.0760, 72.8777],  label: 'Mumbai, IN' },
  { id: 'singapore', location: [1.3521, 103.8198],  label: 'Singapore' },
  { id: 'tokyo',     location: [35.6762, 139.6503], label: 'Tokyo, JP' },
  { id: 'dallas',    location: [32.7767, -96.7970], label: 'Dallas, TX' },
  { id: 'london',    location: [51.5074, -0.1278],  label: 'London, UK' },
  { id: 'sydney',    location: [-33.8688, 151.209], label: 'Sydney, AU' },
]

const COBE_MARKERS = MARKERS.map(m => ({ location: m.location, size: 0.05 }))

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
        diffuse: 1.5,
        mapSamples: 16000,
        mapBrightness: 10,
        baseColor:   [1, 1, 1],
        markerColor: [0.63, 0.32, 0.14],
        glowColor:   [0.94, 0.93, 0.91],
        markers: COBE_MARKERS,
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
      return () => {
        ro.disconnect()
        if (animIdRef.current) cancelAnimationFrame(animIdRef.current)
        globeRef.current?.destroy()
      }
    }
    return () => {
      if (animIdRef.current) cancelAnimationFrame(animIdRef.current)
      globeRef.current?.destroy()
    }
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
