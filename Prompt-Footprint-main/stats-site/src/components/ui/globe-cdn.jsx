import { useEffect, useRef, useCallback } from 'react'
import createGlobe from 'cobe'

const MARKERS = [
  // Extreme impact
  { location: [39.0458, -76.8755], size: 0.12 },  // Ashburn, VA
  { location: [53.3498, -6.2603],  size: 0.12 },  // Dublin, IE
  { location: [19.0760, 72.8777],  size: 0.12 },  // Mumbai, IN
  // High impact
  { location: [33.4484, -112.074], size: 0.09 },  // Phoenix, AZ
  { location: [32.7767, -96.797],  size: 0.09 },  // Dallas, TX
  { location: [1.3521, 103.8198],  size: 0.09 },  // Singapore
  { location: [35.6762, 139.6503], size: 0.09 },  // Tokyo, JP
  { location: [-33.8688, 151.209], size: 0.09 },  // Sydney, AU
  // Moderate impact
  { location: [47.6062, -122.332], size: 0.07 },  // Seattle, WA
  { location: [37.3382, -121.886], size: 0.07 },  // San Jose, CA
  { location: [48.8566, 2.3522],   size: 0.07 },  // Paris, FR
  { location: [51.5074, -0.1278],  size: 0.07 },  // London, UK
  { location: [55.7558, 37.6173],  size: 0.05 },  // Moscow, RU
]

export default function Globe({ className = '' }) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const phiRef = useRef(0)
  const globeRef = useRef(null)
  const isDragging = useRef(false)
  const prevX = useRef(0)

  const onPointerDown = useCallback((e) => {
    isDragging.current = true
    prevX.current = e.clientX ?? e.touches?.[0]?.clientX
  }, [])

  const onPointerMove = useCallback((e) => {
    if (!isDragging.current) return
    const x = e.clientX ?? e.touches?.[0]?.clientX
    phiRef.current += (x - prevX.current) * 0.006
    prevX.current = x
  }, [])

  const onPointerUp = useCallback(() => { isDragging.current = false }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Wait for paint so offsetWidth is correct
    const init = () => {
      const size = container.clientWidth || 360
      const canvas = canvasRef.current
      if (!canvas) return

      globeRef.current?.destroy()
      globeRef.current = createGlobe(canvas, {
        devicePixelRatio: window.devicePixelRatio || 2,
        width: size * (window.devicePixelRatio || 2),
        height: size * (window.devicePixelRatio || 2),
        phi: 0.6,
        theta: 0.2,
        dark: 0,
        diffuse: 1.8,
        mapSamples: 20000,
        mapBrightness: 8,
        // Earth-like: blue ocean, greenish-white landmasses
        baseColor: [0.18, 0.48, 0.82],   // ocean blue
        markerColor: [1.0, 0.35, 0.1],   // vivid red-orange markers
        glowColor: [0.55, 0.78, 1.0],    // pale blue atmosphere
        markers: MARKERS,
        onRender(state) {
          if (!isDragging.current) phiRef.current += 0.004
          state.phi = phiRef.current
        },
      })
      canvas.style.opacity = '1'
    }

    // Use requestAnimationFrame to ensure layout is done
    const raf = requestAnimationFrame(init)
    return () => {
      cancelAnimationFrame(raf)
      globeRef.current?.destroy()
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: 'relative', width: '100%', aspectRatio: '1', cursor: 'grab', userSelect: 'none' }}
      onMouseDown={onPointerDown}
      onMouseMove={onPointerMove}
      onMouseUp={onPointerUp}
      onMouseLeave={onPointerUp}
      onTouchStart={(e) => { isDragging.current = true; prevX.current = e.touches[0].clientX }}
      onTouchMove={(e) => { if (!isDragging.current) return; const x = e.touches[0].clientX; phiRef.current += (x - prevX.current) * 0.006; prevX.current = x }}
      onTouchEnd={onPointerUp}
    >
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', opacity: 0, transition: 'opacity 1.2s ease' }}
      />
    </div>
  )
}
