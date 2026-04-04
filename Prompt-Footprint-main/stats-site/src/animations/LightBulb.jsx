import { useEffect } from 'react'
import { motion, useAnimation } from 'framer-motion'

const MAX_ENERGY_WH = 50 // reference max

export default function LightBulb({ energyWh = 0 }) {
  const fillPercent = Math.min((energyWh / MAX_ENERGY_WH) * 100, 100)
  const glowControls = useAnimation()
  const fillControls = useAnimation()

  useEffect(() => {
    const intensity = fillPercent / 100
    glowControls.start({
      opacity: 0.1 + intensity * 0.9,
      filter: `blur(${8 + intensity * 16}px)`,
      scale: 0.5 + intensity * 0.8,
      transition: { duration: 2.5, ease: 'easeOut' }
    })
    fillControls.start({
      fillOpacity: 0.1 + intensity * 0.85,
      transition: { duration: 2, ease: 'easeOut' }
    })
  }, [fillPercent])

  const bulbColor = fillPercent < 30 ? '#6E6E73' : fillPercent < 60 ? '#FBBF24' : '#FDE68A'
  const ledHours = (energyWh / 10).toFixed(2) // 10W LED

  return (
    <div className="anim-card">
      <div className="anim-label">Energy Usage</div>
      <div className="anim-value">{energyWh.toFixed(4)} Wh</div>
      <div className="anim-sub">of a {MAX_ENERGY_WH} Wh reference</div>

      <div className="bulb-wrapper">
        {/* Glow effect */}
        <motion.div
          className="bulb-glow"
          animate={glowControls}
          initial={{ opacity: 0.05, filter: 'blur(8px)', scale: 0.4 }}
          style={{ background: `radial-gradient(circle, ${bulbColor}, transparent 70%)` }}
        />

        <svg viewBox="0 0 120 180" className="bulb-svg">
          <defs>
            <radialGradient id="bulbGrad" cx="50%" cy="40%" r="60%">
              <stop offset="0%" stopColor={bulbColor} stopOpacity="0.9" />
              <stop offset="100%" stopColor={bulbColor} stopOpacity="0.2" />
            </radialGradient>
          </defs>
          {/* Bulb globe */}
          <motion.ellipse cx="60" cy="70" rx="42" ry="50"
            fill="url(#bulbGrad)"
            stroke="#2A2A2E" strokeWidth="2"
            animate={fillControls}
            initial={{ fillOpacity: 0.1 }}
          />
          {/* Filament lines */}
          <motion.g animate={{ opacity: fillPercent > 20 ? 0.8 : 0.2 }} transition={{ duration: 1.5 }}>
            <line x1="53" y1="62" x2="53" y2="82" stroke={bulbColor} strokeWidth="1.5" />
            <line x1="67" y1="62" x2="67" y2="82" stroke={bulbColor} strokeWidth="1.5" />
            <path d="M53 62 Q60 56 67 62" fill="none" stroke={bulbColor} strokeWidth="1.5" />
            <path d="M53 82 Q60 88 67 82" fill="none" stroke={bulbColor} strokeWidth="1.5" />
          </motion.g>
          {/* Neck */}
          <rect x="47" y="118" width="26" height="8" rx="2" fill="#2A2A2E" />
          {/* Base segments */}
          <rect x="45" y="124" width="30" height="7" rx="2" fill="#222225" stroke="#2A2A2E" strokeWidth="1" />
          <rect x="45" y="130" width="30" height="7" rx="2" fill="#222225" stroke="#2A2A2E" strokeWidth="1" />
          <rect x="45" y="136" width="30" height="7" rx="2" fill="#222225" stroke="#2A2A2E" strokeWidth="1" />
          {/* Bottom prong */}
          <rect x="56" y="142" width="8" height="14" rx="2" fill="#1A1A1D" stroke="#2A2A2E" strokeWidth="1" />
        </svg>

        <div className="bulb-pct" style={{ color: bulbColor }}>{fillPercent.toFixed(1)}%</div>
      </div>

      <div className="anim-context">
        Could power a 10W LED for <strong>{ledHours} hours</strong>
      </div>
    </div>
  )
}
