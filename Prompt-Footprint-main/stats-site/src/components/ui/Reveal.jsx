import { useReveal } from '../../hooks/useMotion'

/**
 * Scroll-reveal wrapper for the dashboard pages.
 *
 * The resting state is the visible one (see `.pf-reveal` in
 * styles/dashboard.css): the entrance is layered on top and only exists where
 * the browser reports no motion preference, so a stalled observer, a print
 * job, or a reduced-motion setting can never leave content hidden.
 */
export default function Reveal(props) {
  const { className = '', delay = 0, pop = false, style, children, ...rest } = props
  const Tag = props.as || 'div'
  delete rest.as
  const [ref, visible] = useReveal({ threshold: 0.12 })
  const classes = [
    'pf-reveal',
    pop ? 'pf-reveal-pop' : '',
    visible ? 'is-visible' : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <Tag ref={ref} className={classes} style={{ '--reveal-delay': `${delay}ms`, ...style }} {...rest}>
      {children}
    </Tag>
  )
}
