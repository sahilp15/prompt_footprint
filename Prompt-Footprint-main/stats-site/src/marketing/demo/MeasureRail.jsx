import { formatValue } from '../../lib/metrics'

/**
 * The instrument attached to the live exchange.
 * ---------------------------------------------------------------------------
 * A narrow rail, not a popup: it sits beside the conversation and reads it,
 * the way a meter sits beside the thing it measures. The numbers move because
 * tokens are arriving, not because a counter was told to animate — every value
 * is recomputed from the text on screen at that instant.
 *
 * The three resource figures are labelled EST. throughout, and the rail names
 * the model assumption they rest on. They are conversions of a token count, not
 * readings taken from a data centre, and the surface never pretends otherwise.
 */
export default function MeasureRail({ live, active, progress = 0, side }) {
  const has = Boolean(live)
  return (
    <aside
      className={`pfd-rail${active ? ' is-live' : ''}`}
      aria-label="Live measurement for this exchange"
    >
      <div className="pfd-rail-head">
        <span className="pfd-rail-mark" aria-hidden="true" />
        <span className="u-micro u-micro-strong">PF</span>
        <span className="u-micro">{active ? 'LIVE' : has ? 'HELD' : 'IDLE'}</span>
      </div>

      {/* Recording progress: a rule that fills as the reply accumulates. */}
      <div className="pfd-rail-progress" aria-hidden="true">
        <i style={{ transform: `scaleX(${Math.max(0, Math.min(1, progress))})` }} />
      </div>

      <dl className="pfd-rail-values">
        <div className="pfd-rail-row is-lead">
          <dt className="u-micro">Tokens</dt>
          <dd className="pfd-rail-value">
            {has ? live.total.toLocaleString() : <span className="pfd-rail-idle">—</span>}
          </dd>
        </div>
        <div className="pfd-rail-row">
          <dt className="u-micro">Est. energy</dt>
          <dd className="pfd-rail-value">
            {has ? formatValue(live.energyWh) : <span className="pfd-rail-idle">—</span>}
            {has && <span className="pfd-rail-unit">Wh</span>}
          </dd>
        </div>
        <div className="pfd-rail-row">
          <dt className="u-micro">Est. water</dt>
          <dd className="pfd-rail-value">
            {has ? formatValue(live.waterMl) : <span className="pfd-rail-idle">—</span>}
            {has && <span className="pfd-rail-unit">mL</span>}
          </dd>
        </div>
        <div className="pfd-rail-row">
          <dt className="u-micro">Est. CO₂</dt>
          <dd className="pfd-rail-value">
            {has ? formatValue(live.co2G) : <span className="pfd-rail-idle">—</span>}
            {has && <span className="pfd-rail-unit">g</span>}
          </dd>
        </div>
      </dl>

      <div className="pfd-rail-foot">
        <p className="u-micro">
          {has ? `${live.promptTokens} in / ${live.responseTokens} out` : 'Send to measure'}
        </p>
        <p className="u-micro pfd-rail-basis">
          {side === 'original' ? 'Original prompt · ' : ''}Estimated, not metered · GPT-4o anchor
        </p>
      </div>
    </aside>
  )
}
