import { useEffect } from 'react'
import { motion, useAnimation } from 'framer-motion'

const MAX_WATER_ML = 200

export default function WaterTank({ waterMl = 0 }) {
  const fillPercent = Math.min((waterMl / MAX_WATER_ML) * 100, 100)
  const fillHeight = 154 * fillPercent / 100
  const waveControls = useAnimation()
  const fillControls = useAnimation()

  useEffect(() => {
    fillControls.start({
      y: 167 - fillHeight,
      height: fillHeight,
      transition: { duration: 2, ease: [0.25, 0.46, 0.45, 0.94] }
    })
    waveControls.start({
      x: [0, -40, 0],
      transition: { duration: 3, ease: 'easeInOut', repeat: Infinity }
    })
  }, [fillPercent])

  const waterTop = 167 - fillHeight

  return (
    <div className="anim-card">
      <div className="anim-label">Water Usage</div>
      <div className="anim-value" style={{ color: '#4AADB5' }}>{waterMl.toFixed(3)} mL</div>
      <div className="anim-sub">of a {MAX_WATER_ML}mL reference</div>

      <div className="tank-wrapper">
        <svg viewBox="0 0 120 180" className="tank-svg">
          <rect x="10" y="10" width="100" height="160" rx="8" ry="8"
            fill="none" stroke="#243524" strokeWidth="3" />
          {[25, 50, 75].map(pct => (
            <g key={pct}>
              <line x1="10" y1={10 + (160 * (100 - pct) / 100)} x2="20"
                y2={10 + (160 * (100 - pct) / 100)} stroke="#243524" strokeWidth="1.5" />
              <text x="22" y={14 + (160 * (100 - pct) / 100)}
                fill="#6B7D5E" fontSize="8">{pct}%</text>
            </g>
          ))}
          <defs>
            <clipPath id="tankClip">
              <rect x="13" y="13" width="94" height="154" rx="6" />
            </clipPath>
          </defs>
          <g clipPath="url(#tankClip)">
            <motion.rect
              x="13"
              width="94"
              fill="#4AADB5"
              fillOpacity="0.55"
              animate={fillControls}
              initial={{ y: 167, height: 0 }}
            />
            <motion.path
              fill="#4AADB5"
              fillOpacity="0.85"
              animate={waveControls}
              d={`M13 ${waterTop} q20-6 40 0 q20 6 40 0 q14-4 27 0 l0 ${fillHeight} l-107 0 z`}
            />
          </g>
          <rect x="13" y="13" width="20" height="154" rx="4"
            fill="white" fillOpacity="0.04" />
        </svg>
        <div className="tank-pct" style={{ color: '#4AADB5' }}>{fillPercent.toFixed(1)}%</div>
      </div>

      <div className="anim-context">
        Equivalent to <strong>{(waterMl / 500 * 100).toFixed(2)}%</strong> of a standard 500mL water bottle
      </div>
    </div>
  )
}
