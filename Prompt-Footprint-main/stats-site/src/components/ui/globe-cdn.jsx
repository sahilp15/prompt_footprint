import { useEffect, useRef, useCallback } from 'react'
import createGlobe from 'cobe'

const MARKERS = [
  // Extreme impact (largest data centers / worst carbon intensity)
  { location: [39.0458, -76.8755], size: 0.12, label: 'Ashburn, VA' },
  { location: [53.3498, -6.2603],  size: 0.12, label: 'Dublin, IE' },
  { location: [19.0760, 72.8777],  size: 0.12, label: 'Mumbai, IN' },
  // High impact
  { location: [33.4484, -112.074], size: 0.09, label: 'Phoenix, AZ' },
  { location: [32.7767, -96.797],  size: 0.09, label: 'Dallas, TX' },
  { location: [1.3521, 103.8198],  size: 0.09, label: 'Singapore' },
  { location: [35.6762, 139.6503], size: 0.09, label: 'Tokyo, JP' },
  { location: [-33.8688, 151.209], size: 0.09, label: 'Sydney, AU' },
  // Moderate impact
  { location: [47.6062, -122.332], size: 0.07, label: 'Seattle, WA' },
  { location: [37.3382, -121.886], size: 0.07, label: 'San Jose, CA' },
  { location: [48.8566, 2.3522],   size: 0.07, label: 'Paris, FR' },
  { location: [51.5074, -0.1278],  size: 0.07, label: 'London, UK' },
  // Lower impact
  { location: [55.7558, 37.6173],  size: 0.05, label: 'Moscow, RU' },
]

export default function Globe({ className = '' }) {
  const canvasRef = useRef(null)
  const phiRef = useRef(0)
  const isDragging = useRef(false)
  const prevX = useRef(0)
  const globeRef = useRef(null)

  const onMouseDown = useCallback((e) => {
    isDragging.current = true
    prevX.current = e.clientX
  }, [])

  const onMouseMove = useCallback((e) => {
    if (!isDragging.current) return
    const delta = e.clientX - prevX.current
    phiRef.current += delta * 0.005
    prevX.current = e.clientX
  }, [])

  const onMouseUp = useCallback(() => { isDragging.current = false }, [])

  const onTouchStart = useCallback((e) => {
    isDragging.current = true
    prevX.current = e.touches[0].clientX
  }, [])

  const onTouchMove = useCallback((e) => {
    if (!isDragging.current) return
    const delta = e.touches[0].clientX - prevX.current
    phiRef.current += delta * 0.005
    prevX.current = e.touches[0].clientX
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const size = canvas.offsetWidth || 400
    canvas.width = size * window.devicePixelRatio
    canvas.height = size * window.devicePixelRatio

    globeRef.current = createGlobe(canvas, {
      devicePixelRatio: window.devicePixelRatio,
      width: size * window.devicePixelRatio,
      height: size * window.devicePixelRatio,
      phi: 0,
      theta: 0.3,
      dark: 0,
      diffuse: 1.2,
      mapSamples: 16000,
      mapBrightness: 6,
      baseColor: [0.56, 0.47, 0.33],
      markerColor: [0.63, 0.32, 0.14],
      glowColor: [0.36, 0.49, 0.23],
      markers: MARKERS,
      onRender(state) {
        if (!isDragging.current) phiRef.current += 0.003
        state.phi = phiRef.current
      },
    })

    canvas.style.opacity = '1'

    return () => { globeRef.current?.destroy() }
  }, [])

  return (
    <div
      className={`globe-container ${className}`}
      style={{ position: 'relative', width: '100%', aspectRatio: '1', cursor: 'grab' }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onMouseUp}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          opacity: 0,
          transition: 'opacity 1s ease',
        }}
      />
    </div>
  )
}
