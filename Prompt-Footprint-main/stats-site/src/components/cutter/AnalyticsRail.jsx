import { Droplets, Gauge, Hash, Leaf, Lock, ShieldCheck, Type, Wind, Zap } from 'lucide-react'
import { readabilityLabel } from '../../lib/tokenCutter/readability.ts'

/** Small numbers need decimals; large ones need separators. */
function fmt(value, decimals = 0) {
  if (!Number.isFinite(value)) return '0'
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function Row({ icon, label, value, sub, tone }) {
  return (
    <div className={`tc-stat${tone ? ` tc-stat-${tone}` : ''}`}>
      <span className="tc-stat-icon">{icon}</span>
      <span className="tc-stat-body">
        <span className="tc-stat-label">{label}</span>
        {sub && <span className="tc-stat-sub">{sub}</span>}
      </span>
      <span className="tc-stat-value">{value}</span>
    </div>
  )
}

export default function AnalyticsRail({ analytics, validation, platform }) {
  if (!analytics) return null

  const {
    originalWords, optimizedWords, originalTokens, optimizedTokens, tokensSaved,
    percentReduction, saved, readability, readabilityDelta, preservedConstraints,
    protectedTerms, suggestionsAccepted, suggestionsRejected,
  } = analytics

  const platformLabel = platform === 'claude' ? 'Claude' : 'ChatGPT'

  return (
    <section className="tc-panel tc-analytics" aria-labelledby="tc-stats-title">
      <header className="tc-panel-head">
        <h2 id="tc-stats-title" className="tc-panel-title">Impact</h2>
        <span className="tc-panel-count">{platformLabel} rates</span>
      </header>

      <div className="tc-headline" role="group" aria-label="Token reduction">
        <div className="tc-headline-value">
          <span className="tc-headline-number">{fmt(percentReduction, 1)}</span>
          <span className="tc-headline-unit">%</span>
        </div>
        <div className="tc-headline-label">
          smaller — {fmt(tokensSaved)} token{tokensSaved === 1 ? '' : 's'} saved
        </div>
        <div
          className="tc-bar"
          role="progressbar"
          aria-valuenow={Math.round(percentReduction)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Percentage token reduction"
        >
          <span className="tc-bar-fill" style={{ width: `${Math.min(100, percentReduction)}%` }} />
        </div>
      </div>

      <div className="tc-stat-group">
        <Row icon={<Hash size={14} aria-hidden="true" />} label="Tokens" sub="original → optimized" value={`${fmt(originalTokens)} → ${fmt(optimizedTokens)}`} />
        <Row icon={<Type size={14} aria-hidden="true" />} label="Words" sub="original → optimized" value={`${fmt(originalWords)} → ${fmt(optimizedWords)}`} />
      </div>

      <h3 className="tc-subhead"><Leaf size={12} aria-hidden="true" /> Avoided by not sending</h3>
      <div className="tc-stat-group">
        <Row icon={<Zap size={14} aria-hidden="true" />} label="Energy" value={`${fmt(saved.energyWh, 4)} Wh`} />
        <Row icon={<Droplets size={14} aria-hidden="true" />} label="Water" value={`${fmt(saved.waterMl, 4)} mL`} />
        <Row icon={<Wind size={14} aria-hidden="true" />} label="CO₂" value={`${fmt(saved.co2G, 4)} g`} />
      </div>

      <h3 className="tc-subhead"><ShieldCheck size={12} aria-hidden="true" /> Safety</h3>
      <div className="tc-stat-group">
        <Row
          icon={<ShieldCheck size={14} aria-hidden="true" />}
          label="Meaning check"
          sub={validation?.ok ? 'All tracked details survived' : 'Something needs review'}
          tone={validation?.ok ? 'ok' : 'warn'}
          value={`${Math.round((validation?.meaningScore ?? 0) * 100)}%`}
        />
        <Row icon={<Lock size={14} aria-hidden="true" />} label="Constraints kept" value={fmt(preservedConstraints)} />
        <Row icon={<Lock size={14} aria-hidden="true" />} label="Protected terms" value={fmt(protectedTerms)} />
        <Row
          icon={<Gauge size={14} aria-hidden="true" />}
          label="Clarity"
          sub={`${readabilityLabel(readability)}${readabilityDelta ? ` · ${readabilityDelta > 0 ? '+' : ''}${fmt(readabilityDelta, 0)}` : ''}`}
          value={fmt(readability)}
        />
      </div>

      <div className="tc-stat-group">
        <Row icon={<Hash size={14} aria-hidden="true" />} label="Accepted" value={fmt(suggestionsAccepted)} />
        <Row icon={<Hash size={14} aria-hidden="true" />} label="Rejected" value={fmt(suggestionsRejected)} />
      </div>

      <p className="tc-footnote">
        Energy, water, and CO₂ use PromptFootprint’s per-token model — the same
        figures as the rest of the dashboard.
      </p>
    </section>
  )
}
