import { useLayoutEffect, useRef } from 'react'

/**
 * The reduction, as an edit rather than an effect.
 * ---------------------------------------------------------------------------
 * The removable wording is struck through where it sits, then physically
 * contracts out of the paragraph and the block closes up behind it. That is the
 * whole animation: proofreader's marks and a shorter piece of text. There is no
 * particle system here, and there is nothing to watch that is not information.
 *
 * The measurement it takes is what makes the motion honest: a hidden copy of
 * the optimized text is laid out at the live width, and the block animates to
 * the height that result will really need. Nothing is guessed, and the layout
 * the animation lands on is the layout the composer keeps.
 *
 * Driving type size and block height does cost layout on those frames. That is
 * accepted deliberately and only here: the point of this moment is that the text
 * takes up less room, and a transform cannot say that.
 */
export default function ReductionView({ diff, optimized, reduced }) {
  const rootRef = useRef(null)
  const ghostRef = useRef(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    const ghost = ghostRef.current
    if (!root || reduced) return undefined

    root.style.height = `${root.scrollHeight}px`
    void root.offsetHeight // flush, so the height transition has a start value

    root.classList.add('is-marking')

    // Strike first, collapse second. Reading what is about to go needs a beat of
    // its own; collapsing on the same frame would just look like a glitch.
    const timer = setTimeout(() => {
      root.classList.add('is-collapsing')
      if (ghost) root.style.height = `${ghost.scrollHeight}px`
    }, 190)

    return () => clearTimeout(timer)
  }, [diff, reduced])

  return (
    <div className="pfd-reduce" ref={rootRef} aria-hidden="true">
      <p className="pfd-marks">
        {diff.map((part, i) => {
          if (part.kind === 'removed') {
            return <span className="pfd-cut" data-cut key={i}>{part.text}</span>
          }
          if (part.kind === 'added') {
            return <span className="pfd-add" key={i}>{part.text}</span>
          }
          return <span key={i}>{part.text}</span>
        })}
      </p>
      {/* Measured, never seen: the optimized text at the live width, so the
          block knows the height it is closing to. */}
      <p className="pfd-marks pfd-ghost" ref={ghostRef} data-ghost>{optimized}</p>
    </div>
  )
}
