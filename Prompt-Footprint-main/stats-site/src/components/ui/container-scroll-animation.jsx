import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'

export function ContainerScroll({ titleComponent, children }) {
  const containerRef = useRef(null)
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end start'],
  })

  const rotate = useTransform(scrollYProgress, [0, 1], [20, 0])
  const scale = useTransform(scrollYProgress, [0, 1], [1.05, 1])
  const translateY = useTransform(scrollYProgress, [0, 1], [0, -80])

  return (
    <div
      ref={containerRef}
      className="container-scroll-outer"
      style={{ height: '140vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}
    >
      <div
        className="container-scroll-sticky"
        style={{
          position: 'sticky',
          top: 0,
          width: '100%',
          paddingTop: '80px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <motion.div style={{ translateY }} className="container-scroll-header">
          {titleComponent}
        </motion.div>

        <motion.div
          style={{
            rotateX: rotate,
            scale,
            transformPerspective: 1200,
            transformOrigin: 'top center',
            marginTop: '32px',
            width: '100%',
            maxWidth: '900px',
          }}
        >
          {children}
        </motion.div>
      </div>
    </div>
  )
}

export function Header({ children, className = '' }) {
  return (
    <div
      className={`container-scroll-title ${className}`}
      style={{ textAlign: 'center', marginBottom: '16px' }}
    >
      {children}
    </div>
  )
}
