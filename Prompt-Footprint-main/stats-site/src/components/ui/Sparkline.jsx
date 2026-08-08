import { useId, useMemo } from 'react'

/**
 * A small trend line for a metric tile.
 *
 * Purely decorative context — no axes, no labels — so it is hidden from the
 * accessibility tree; the number above it and the daily chart below already
 * carry the same information. The line draws itself in once its tile becomes
 * visible, using `pathLength="1"` so the dash animation is independent of the
 * real path length.
 */
export default function Sparkline({
  values = [],
  color = 'currentColor',
  height = 40,
  active = true,
  strokeWidth = 1.75,
  className = '',
}) {
  const gradientId = useId()
  const W = 100
  const H = 100

  const { line, area } = useMemo(() => {
    const nums = values.map((v) => Number(v) || 0)
    if (nums.length < 2) return { line: '', area: '' }

    const max = Math.max(...nums)
    const min = Math.min(...nums)
    // A flat series should sit mid-height rather than collapse onto the floor.
    const span = max - min || Math.max(max, 1)
    const pad = 12
    const points = nums.map((v, i) => [
      (i / (nums.length - 1)) * W,
      H - pad - ((v - min) / span) * (H - pad * 2),
    ])

    // Smooth the polyline with midpoint quadratics — cheap, and it never
    // overshoots the way a naive cubic through every point can.
    let d = `M ${points[0][0]} ${points[0][1]}`
    for (let i = 1; i < points.length; i++) {
      const [px, py] = points[i - 1]
      const [cx, cy] = points[i]
      const mx = (px + cx) / 2
      d += ` Q ${px} ${py} ${mx} ${(py + cy) / 2}`
      if (i === points.length - 1) d += ` T ${cx} ${cy}`
    }

    return { line: d, area: `${d} L ${W} ${H} L 0 ${H} Z` }
  }, [values])

  if (!line) return null

  return (
    <svg
      className={`pf-spark${active ? ' is-active' : ''} ${className}`.trim()}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ height }}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="pf-spark-area" d={area} fill={`url(#${gradientId})`} />
      <path
        className="pf-spark-line"
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength="1"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
