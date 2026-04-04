import { useEffect } from 'react'
import { motion, useAnimation } from 'framer-motion'

const MAX_ENERGY_WH = 50

export default function LightBulb({ energyWh = 0 }) {
  const fillPercent = Math.min((energyWh / MAX_ENERGY_WH) * 100, 100)
  const intensity = fillPercent / 100
  const glowControls = useAnimation()
  const fillControls = useAnimation()
  const filamentControls = useAnimation()

  useEffect(() => {
    glowControls.start({
      opacity: 0.08 + intensity * 0.92,
      scale: 0.4 + intensity * 0.8,
      transition: { duration: 2.5, ease: 'easeOut' }
    })
    fillControls.start({
      fillOpacity: 0.08 + intensity * 0.87,
      transition: { duration: 2, ease: 'easeOut' }
    })
    filamentControls.start({
      opacity: fillPercent > 20 ? 0.9 : 0.15,
      transition: { duration: 1.5 }
    })
  }, [fillPercent])

  const bulbColor = fillPercent < 30 ? '#6B7D5E' : fillPercent < 60 ? '#D4A843' : '#F0C860'
  const ledHours = (energyWh / 10).toFixed(2)

  return (
    <div className="anim-card">
      <div className="anim-label">Energy Usage</div>
      <div className="anim-value" style={{ color: '#D4A843' }}>{energyWh.toFixed(4)} Wh</div>
      <div className="anim-sub">of a {MAX_ENERGY_WH} Wh reference</div>

      <div className="bulb-wrapper">
        <motion.div
          className="bulb-glow"
          animate={glowControls}
          initial={{ opacity: 0.05, scale: 0.4 }}
          style={{ background: `radial-gradient(circle, ${bulbColor}88, transparent 70%)` }}
        />

        <svg viewBox="0 0 120 180" className="bulb-svg">
          <defs>
            <radialGradient id="bulbGrad" cx="50%" cy="40%" r="60%">
              <stop offset="0%" stopColor={bulbColor} stopOpacity="0.9" />
              <stop offset="100%" stopColor={bulbColor} stopOpacity="0.15" />
            </radialGradient>
          </defs>

          <motion.ellipse
            cx="60" cy="70" rx="42" ry="50"
            fill="url(#bulbGrad)"
            stroke="#243524"
            strokeWidth="2"
            animate={fillControls}
            initial={{ fillOpacity: 0.08 }}
          />

          <motion.g animate={filamentControls} initial={{ opacity: 0.15 }}>
            <line x1="53" y1="62" x2="53" y2="82" stroke={bulbColor} strokeWidth="1.5" />
            <line x1="67" y1="62" x2="67" y2="82" stroke={bulbColor} strokeWidth="1.5" />
            <path d="M53 62 Q60 56 67 62" fill="none" stroke={bulbColor} strokeWidth="1.5" />
            <path d="M53 82 Q60 88 67 82" fill="none" stroke={bulbColor} strokeWidth="1.5" />
          </motion.g>

          <rect x="47" y="118" width="26" height="8" rx="2" fill="#162416" />
          <rect x="45" y="124" width="30" height="7" rx="2" fill="#111A11" stroke="#243524" strokeWidth="1" />
          <rect x="45" y="130" width="30" height="7" rx="2" fill="#111A11" stroke="#243524" strokeWidth="1" />
          <rect x="45" y="136" width="30" height="7" rx="2" fill="#111A11" stroke="#243524" strokeWidth="1" />
          <rect x="56" y="142" width="8" height="14" rx="2" fill="#0A120A" stroke="#243524" strokeWidth="1" />
        </svg>

        <div className="bulb-pct" style={{ color: bulbColor }}>{fillPercent.toFixed(1)}%</div>
      </div>

      <div className="anim-context">
        Could power a 10W LED for <strong>{ledHours} hours</strong>
      </div>
    </div>
  )
}
