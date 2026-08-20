import { useCallback, useId, useMemo, useRef, useState } from 'react'
import { scaleLinear, scalePoint } from 'd3-scale'
import { line as d3line, curveLinear } from 'd3-shape'
import { usePrefersReducedMotion } from '../hooks/useMotion'

/**
 * The main reading.
 * ---------------------------------------------------------------------------
 * D3 is used here for what it is good at — scales, ticks, and a path generator
 * — and for nothing else. Every mark on screen is written out below as SVG this
 * file controls: a hairline baseline grid, a plain polyline, square markers,
 * and a measurement cursor. There is no chart library theme underneath it,
 * which is why it looks like this product rather than like an admin template.
 *
 * ── Interaction ────────────────────────────────────────────────────────────
 * Hovering or focusing puts a cursor on the nearest reading: one thin vertical
 * rule and one marker. The values appear in a fixed readout above the plot, not
 * in a tooltip that floats over the data it is describing.
 *
 * ── Accessibility ──────────────────────────────────────────────────────────
 * The plot is focusable and driven by the arrow keys; the readout is a live
 * region, so moving the cursor announces the reading. A full table of the same
 * numbers is rendered for screen readers, so nothing is only available by
 * pointing at a picture.
 */

const PAD = { top: 18, right: 34, bottom: 30, left: 54 }

export default function MeterChart({
  series,
  prevSeries = [],
  valueKey = 'saved',
  label,
  unit = '',
  format = (v) => Math.round(v).toLocaleString(),
  height = 300,
  compareLabel = 'previous period',
}) {
  const reduced = usePrefersReducedMotion()
  const uid = useId().replace(/[:]/g, '')
  const wrapRef = useRef(null)
  const [width, setWidth] = useState(880)
  const [cursor, setCursor] = useState(null)

  // Width comes from the element, so the chart fills whatever column it is put
  // in — including the full-bleed one on the landing page.
  const measure = useCallback((node) => {
    wrapRef.current = node
    if (!node || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(node)
    setWidth(node.getBoundingClientRect().width)
  }, [])

  const geom = useMemo(() => {
    const w = Math.max(320, width)
    const innerW = w - PAD.left - PAD.right
    const innerH = height - PAD.top - PAD.bottom

    const values = series.map((d) => d[valueKey] || 0)
    const prevValues = prevSeries.map((d) => d[valueKey] || 0)
    const peak = Math.max(...values, ...prevValues, 0)

    const x = scalePoint()
      .domain(series.map((d) => d.date))
      .range([0, innerW])
    // `.nice()` puts the top of the axis on a round number rather than on the
    // largest reading, so the grid lines land somewhere a person would choose.
    const y = scaleLinear().domain([0, peak || 1]).range([innerH, 0]).nice(4)

    // Positional, not keyed by date: the reference trace is the SAME weekday
    // one period earlier, so it belongs at the same slot on the axis. Looking
    // its date up in this period's domain would find nothing.
    const path = d3line()
      .x((_d, i) => x(series[i]?.date) ?? 0)
      .y((d) => y(d[valueKey] || 0))
      .curve(curveLinear)

    return {
      w, innerW, innerH, x, y,
      ticks: y.ticks(4),
      // The axis gets d3's own formatter for this domain — consistent decimal
      // places across the whole scale. `format` is for the readout, where a
      // single value is being reported and adaptive precision is right.
      tickFormat: y.tickFormat(4),
      line: series.length > 1 ? path(series) || '' : '',
      prevLine: prevSeries.length === series.length && series.length > 1 ? path(prevSeries) || '' : '',
      points: series.map((d) => ({ d, cx: x(d.date) ?? 0, cy: y(d[valueKey] || 0) })),
      peak,
    }
  }, [series, prevSeries, valueKey, width, height])

  const nearest = useCallback((clientX) => {
    const node = wrapRef.current
    if (!node || !series.length) return null
    const rect = node.getBoundingClientRect()
    const px = clientX - rect.left - PAD.left
    const step = geom.innerW / Math.max(1, series.length - 1)
    return Math.max(0, Math.min(series.length - 1, Math.round(px / step)))
  }, [geom.innerW, series.length])

  const onKeyDown = (e) => {
    if (!series.length) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      setCursor((c) => {
        const next = c == null ? (e.key === 'ArrowRight' ? 0 : series.length - 1) : c + (e.key === 'ArrowRight' ? 1 : -1)
        return Math.max(0, Math.min(series.length - 1, next))
      })
    } else if (e.key === 'Home') { e.preventDefault(); setCursor(0) }
    else if (e.key === 'End') { e.preventDefault(); setCursor(series.length - 1) }
    else if (e.key === 'Escape') { setCursor(null) }
  }

  const active = cursor != null ? series[cursor] : null
  const activePrev = cursor != null ? prevSeries[cursor] : null
  const activeValue = active ? active[valueKey] || 0 : null
  const priorValue = activePrev ? activePrev[valueKey] || 0 : null
  const delta = priorValue > 0 && activeValue != null
    ? ((activeValue - priorValue) / priorValue) * 100
    : null

  const total = series.reduce((n, d) => n + (d[valueKey] || 0), 0)

  return (
    <figure className="mtr" style={{ '--mtr-h': `${height}px` }}>
      {/* ── Fixed readout. Never floats over the data. ─────────────────── */}
      <div className="mtr-readout" aria-live="polite">
        {active ? (
          <>
            <span className="u-micro">{active.longLabel || active.label}</span>
            <span className="mtr-readout-value">
              {format(activeValue)}{unit && <i>{unit}</i>}
            </span>
            <span className="u-micro mtr-readout-meta">
              {label}
              {delta != null && (
                <>
                  {' · '}
                  <b className={delta >= 0 ? 'is-up' : 'is-down'}>
                    {delta >= 0 ? '+' : '−'}{Math.abs(delta).toFixed(1)}%
                  </b>
                  {` vs ${compareLabel}`}
                </>
              )}
            </span>
          </>
        ) : (
          <>
            <span className="u-micro">Period total</span>
            <span className="mtr-readout-value">{format(total)}{unit && <i>{unit}</i>}</span>
            <span className="u-micro mtr-readout-meta">
              {label} · hover or focus the plot to inspect a day
            </span>
          </>
        )}
      </div>

      <div
        className="mtr-plot"
        ref={measure}
        tabIndex={0}
        role="group"
        aria-label={`${label} by day. ${series.length} readings, ${format(total)}${unit} in total. Use the arrow keys to inspect each day.`}
        onKeyDown={onKeyDown}
        onPointerMove={(e) => setCursor(nearest(e.clientX))}
        onPointerLeave={() => setCursor(null)}
        onBlur={() => setCursor(null)}
      >
        <svg
          width={geom.w}
          height={height}
          viewBox={`0 0 ${geom.w} ${height}`}
          aria-hidden="true"
          className={reduced ? '' : 'is-recording'}
          style={{ viewTransitionName: `mtr-${uid}` }}
        >
          <g transform={`translate(${PAD.left},${PAD.top})`}>
            {/* Hairline grid: horizontal only, and the zero line is the one
                that is allowed to be darker. */}
            {geom.ticks.map((t) => (
              <g key={t}>
                <line
                  x1={0} x2={geom.innerW}
                  y1={geom.y(t)} y2={geom.y(t)}
                  className={t === 0 ? 'mtr-rule is-base' : 'mtr-rule'}
                />
                <text x={-10} y={geom.y(t)} className="mtr-tick" dominantBaseline="middle" textAnchor="end">
                  {geom.tickFormat(t)}
                </text>
              </g>
            ))}

            {/* The period before, for reference. Dashed, unlabelled, quiet. */}
            {geom.prevLine && <path d={geom.prevLine} className="mtr-prev" />}

            {/* The trace. Drawn on, once, when the mode changes. */}
            <path d={geom.line} className="mtr-line" key={valueKey} />

            {geom.points.map((p, i) => (
              <rect
                key={p.d.date}
                x={p.cx - 2.5}
                y={p.cy - 2.5}
                width={5}
                height={5}
                className={`mtr-point${cursor === i ? ' is-active' : ''}`}
              />
            ))}

            {/* Measurement cursor. */}
            {cursor != null && geom.points[cursor] && (
              <g className="mtr-cursor">
                <line
                  x1={geom.points[cursor].cx} x2={geom.points[cursor].cx}
                  y1={0} y2={geom.innerH}
                />
                <circle cx={geom.points[cursor].cx} cy={geom.points[cursor].cy} r={4} />
              </g>
            )}

            {/* X labels, direct on the baseline. */}
            {geom.points.map((p, i) => (
              <text
                key={`x-${p.d.date}`}
                x={p.cx}
                y={geom.innerH + 18}
                textAnchor="middle"
                className={`mtr-xlabel${cursor === i ? ' is-active' : ''}`}
              >
                {p.d.label}
              </text>
            ))}
          </g>
        </svg>
      </div>

      {/* Same numbers, in a form that does not require pointing. */}
      <table className="u-sr">
        <caption>{label} by day</caption>
        <thead>
          <tr><th scope="col">Day</th><th scope="col">{label}{unit && ` (${unit})`}</th></tr>
        </thead>
        <tbody>
          {series.map((d) => (
            <tr key={d.date}>
              <th scope="row">{d.longLabel || d.label}</th>
              <td>{format(d[valueKey] || 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
