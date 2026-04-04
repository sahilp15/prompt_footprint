import { useEffect } from 'react'
import { motion, useAnimation } from 'framer-motion'

const MAX_CO2_G = 20

export default function GasTank({ co2G = 0 }) {
  const fillPercent = Math.min((co2G / MAX_CO2_G) * 100, 100)
  const controls = useAnimation()

  useEffect(() => {
    controls.start({
      scaleY: fillPercent / 100,
      transition: { duration: 2.2, ease: [0.25, 0.46, 0.45, 0.94] }
    })
  }, [fillPercent])

  const carMiles = (co2G / 404).toFixed(4)
  const fillColor = fillPercent < 40 ? '#7A8C5A' : fillPercent < 70 ? '#9AAD6A' : '#B8CC80'

  return (
    <div className="anim-card">
      <div className="anim-label">CO2 Emissions</div>
      <div className="anim-value" style={{ color: '#7A8C5A' }}>{co2G.toFixed(4)} g</div>
      <div className="anim-sub">of a {MAX_CO2_G}g reference</div>

      <div className="tank-wrapper">
        <svg viewBox="0 0 120 200" className="tank-svg gas-tank-svg">
          <defs>
            <clipPath id="gasTankClip">
              <ellipse cx="60" cy="100" rx="40" ry="75" />
            </clipPath>
            <linearGradient id="gasGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={fillColor} stopOpacity="0.9" />
              <stop offset="100%" stopColor={fillColor} stopOpacity="0.6" />
            </linearGradient>
          </defs>

          <ellipse cx="60" cy="100" rx="40" ry="75"
            fill="none" stroke="#243524" strokeWidth="3" />

          <g clipPath="url(#gasTankClip)">
            <motion.rect
              x="20"
              y="25"
              width="80"
              height="150"
              fill="url(#gasGrad)"
              style={{ transformBox: 'fill-box', transformOrigin: 'bottom' }}
              animate={controls}
              initial={{ scaleY: 0 }}
            />
          </g>

          {[25, 50, 75].map(pct => {
            const yPos = 25 + (150 * (100 - pct) / 100)
            return (
              <g key={pct}>
                <line x1="20" y1={yPos} x2="30" y2={yPos} stroke="#243524" strokeWidth="1.5" />
                <text x="32" y={yPos + 3} fill="#6B7D5E" fontSize="7">{pct}%</text>
              </g>
            )
          })}

          <rect x="52" y="16" width="16" height="12" rx="3" fill="#162416" stroke="#243524" strokeWidth="2" />
          <rect x="56" y="10" width="8" height="8" rx="2" fill="#243524" />
          <ellipse cx="42" cy="80" rx="8" ry="20" fill="white" fillOpacity="0.04" />
        </svg>

        <div className="tank-pct" style={{ color: '#7A8C5A' }}>{fillPercent.toFixed(1)}%</div>
      </div>

      <div className="anim-context">
        Equivalent to driving <strong>{carMiles} miles</strong> in an average car
      </div>
    </div>
  )
}
