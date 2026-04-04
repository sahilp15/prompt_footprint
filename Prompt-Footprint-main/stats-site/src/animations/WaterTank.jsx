import { useEffect, useRef } from 'react'
import { motion, useAnimation } from 'framer-motion'

const MAX_WATER_ML = 200 // reference max for 100% fill

export default function WaterTank({ waterMl = 0 }) {
  const fillPercent = Math.min((waterMl / MAX_WATER_ML) * 100, 100)
  const controls = useAnimation()
  const waveControls = useAnimation()

  useEffect(() => {
    controls.start({
      height: `${fillPercent}%`,
      transition: { duration: 2, ease: [0.25, 0.46, 0.45, 0.94] }
    })
    waveControls.start({
      x: [0, -40, 0],
      transition: { duration: 3, ease: 'easeInOut', repeat: Infinity }
    })
  }, [fillPercent])

  return (
    <div className="anim-card">
      <div className="anim-label">Water Usage</div>
      <div className="anim-value">{waterMl.toFixed(3)} mL</div>
      <div className="anim-sub">of a {MAX_WATER_ML}mL reference</div>

      <div className="tank-wrapper">
        <svg viewBox="0 0 120 180" className="tank-svg">
          {/* Tank outline */}
          <rect x="10" y="10" width="100" height="160" rx="8" ry="8"
            fill="none" stroke="#2A2A2E" strokeWidth="3" />
          {/* Scale marks */}
          {[25, 50, 75].map(pct => (
            <g key={pct}>
              <line x1="10" y1={10 + (160 * (100 - pct) / 100)} x2="20"
                y2={10 + (160 * (100 - pct) / 100)} stroke="#2A2A2E" strokeWidth="1.5" />
              <text x="22" y={14 + (160 * (100 - pct) / 100)}
                fill="#6E6E73" fontSize="8">{pct}%</text>
            </g>
          ))}
          {/* Clip path for fill */}
          <defs>
            <clipPath id="tankClip">
              <rect x="13" y="13" width="94" height="154" rx="6" />
            </clipPath>
          </defs>
          {/* Fill area */}
          <g clipPath="url(#tankClip)">
            <motion.g
              style={{ originY: 1 }}
              animate={controls}
              initial={{ height: '0%' }}
            >
              {/* Water fill - positioned from bottom */}
              <motion.rect
                x="13"
                width="94"
                height="154"
                fill="#60A5FA"
                fillOpacity="0.7"
                style={{
                  y: `${100 - fillPercent}%`,
                  height: `${fillPercent}%`
                }}
              />
              {/* Wave */}
              <motion.path
                d={`M${13 + 0} ${167 - (154 * fillPercent / 100)}
                   q20-6 40 0 q20 6 40 0 q14-4 27 0
                   l0 ${154 * fillPercent / 100}
                   l-107 0 z`}
                fill="#60A5FA"
                fillOpacity="0.85"
                animate={waveControls}
              />
            </motion.g>
          </g>
          {/* Glass sheen */}
          <rect x="13" y="13" width="20" height="154" rx="4"
            fill="white" fillOpacity="0.04" />
        </svg>

        <div className="tank-pct">{fillPercent.toFixed(1)}%</div>
      </div>

      <div className="anim-context">
        Equivalent to <strong>{(waterMl / 500 * 100).toFixed(2)}%</strong> of a standard 500mL water bottle
      </div>
    </div>
  )
}
