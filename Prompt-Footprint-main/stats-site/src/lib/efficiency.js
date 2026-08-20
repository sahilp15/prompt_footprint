// Efficiency metrics — the single definition of every number the dashboard
// shows above the fold.
// ---------------------------------------------------------------------------
// The dashboard leads with token efficiency, so its headline figures need
// definitions that survive being read aloud. Each one is stated here once, in
// code, next to the reason it is defined that way. Nothing downstream is
// allowed to invent a variant.
//
// ── DEFINITIONS ────────────────────────────────────────────────────────────
//
//   tokensSaved
//     Σ (originalPromptTokens − optimizedPromptTokens) over COMPLETED
//     optimization events — the ones where the user actually replaced their
//     prompt. Suggestions that were shown and ignored are not savings, and
//     never enter this sum.
//
//   optimizedOriginalTokens
//     Σ originalPromptTokens over those same completed events. The denominator
//     is deliberately NOT every token the user has ever produced: dividing a
//     prompt-side saving by a total that is mostly model output would report a
//     number that means nothing.
//
//   avgReduction  (a.k.a. optimizationRate)
//     tokensSaved / optimizedOriginalTokens.
//     Read as: "across the prompts you tightened, this share of the original
//     wording came out." `null` when no event carries an original count —
//     records written before the ledger tracked originals cannot support it,
//     and a made-up denominator is worse than an absent metric.
//
//   totalTokens
//     Σ session.totalTokens — prompts AND responses, as measured. This is
//     usage, not waste. Tokens that were not removed were not "wasted"; most
//     of them are the model's answer.
//
//   removedShare
//     tokensSaved / (totalTokens + tokensSaved).
//     The removed tokens are not inside totalTokens (they were never sent), so
//     the honest comparison adds them back to form the "would have been" total.
//
// Every environmental figure is derived with `impactForTokens` from the token
// cutter's `tokens.ts`, which is the same implementation the extension uses and
// is held to it by `test/parity.test.ts`. There is no second conversion factor.

import { impactForTokens } from './tokenCutter/tokens.ts'
// Explicit extension: this module is imported both by Vite (which would
// resolve either way) and directly by node:test, which will not.
import { localDayKey, formatDayLabel } from './dates.js'

const DAY = 24 * 60 * 60 * 1000

/** Percentage change from `previous` to `current`, or null with no baseline. */
export function changeVs(current, previous) {
  const now = Number(current) || 0
  const before = Number(previous) || 0
  if (before <= 0) return null
  const pct = ((now - before) / before) * 100
  if (Math.abs(pct) < 0.5) return { pct: 0, direction: 'flat' }
  return { pct, direction: pct > 0 ? 'up' : 'down' }
}

/**
 * tokensSaved / optimizedOriginalTokens, as a percentage.
 *
 * Returns null rather than 0 when the denominator is missing, so a caller can
 * tell "nothing was reduced" apart from "this cannot be computed".
 */
export function avgReduction({ tokensSaved = 0, optimizedOriginalTokens = 0 } = {}) {
  if (!(optimizedOriginalTokens > 0)) return null
  return (tokensSaved / optimizedOriginalTokens) * 100
}

/** tokensSaved as a share of what the period would have totalled unreduced. */
export function removedShare({ tokensSaved = 0, totalTokens = 0 } = {}) {
  const wouldHave = totalTokens + tokensSaved
  if (!(wouldHave > 0)) return 0
  return (tokensSaved / wouldHave) * 100
}

/**
 * The dashboard's whole numeric model for one period, from the raw payloads the
 * data layer returns.
 *
 * `weekly` and `savings` are the shapes produced by lib/api.js. Everything
 * below is derived; nothing is stored twice.
 */
export function buildModel({ weekly, savings, sessions = [], days = 7 } = {}) {
  const totals = weekly?.totals || {}
  const previous = weekly?.previous || {}
  const usedDaily = weekly?.daily || []
  const savedDaily = savings?.daily || {}
  const savedPrev = savings?.previous || {}

  // One row per calendar day, carrying both sides of the story. Days come from
  // the usage buckets so the axis is always the requested window, even where a
  // day has usage but no optimization (or the reverse).
  const series = usedDaily.map((d) => {
    const s = savedDaily[d.date] || {}
    return {
      date: d.date,
      label: formatDayLabel(d.date, { weekday: 'short' }),
      longLabel: formatDayLabel(d.date, { weekday: 'long', month: 'short', day: 'numeric' }),
      used: d.tokens || 0,
      prompts: d.queries || 0,
      saved: s.tokens || 0,
      optimizations: s.count || 0,
      originalTokens: s.originalTokens || 0,
      energyWh: d.energyWh || 0,
      waterMl: d.waterMl || 0,
      co2G: d.co2G || 0,
    }
  })

  // The same window, one period earlier, so a delta has something real behind it.
  const prevSeries = (weekly?.previousDaily || []).map((d) => {
    const s = savedDaily[d.date] || {}
    return { date: d.date, used: d.tokens || 0, saved: s.tokens || 0 }
  })

  const tokensSaved = series.reduce((n, d) => n + d.saved, 0)
  const optimizedOriginalTokens = series.reduce((n, d) => n + d.originalTokens, 0)
  const optimizations = series.reduce((n, d) => n + d.optimizations, 0)

  const current = {
    days,
    totalTokens: totals.totalTokens || 0,
    prompts: totals.queryCount || 0,
    sessions: totals.sessionCount || 0,
    energyWh: totals.totalEnergyWh || 0,
    waterMl: totals.totalWaterMl || 0,
    co2G: totals.totalCo2G || 0,
    tokensSaved,
    optimizations,
    optimizedOriginalTokens,
  }

  const prior = {
    totalTokens: previous.totalTokens || 0,
    prompts: previous.queryCount || 0,
    energyWh: previous.totalEnergyWh || 0,
    waterMl: previous.totalWaterMl || 0,
    co2G: previous.totalCo2G || 0,
    tokensSaved: savedPrev.totalTokensSaved || 0,
    optimizations: savedPrev.applyCount || 0,
  }

  return {
    range: series.length
      ? `${formatDayLabel(series[0].date, { month: 'short', day: 'numeric' })} – ${formatDayLabel(series[series.length - 1].date, { month: 'short', day: 'numeric' })}`
      : '',
    series,
    prevSeries,
    current,
    prior,
    avgReduction: avgReduction(current),
    removedShare: removedShare(current),
    // What the removed tokens would have corresponded to under the same model
    // that priced the tokens that WERE sent. Stated as an equivalence, never as
    // an amount prevented.
    savedImpact: impactForTokens(tokensSaved, 'chatgpt'),
    deltas: {
      tokensSaved: changeVs(current.tokensSaved, prior.tokensSaved),
      totalTokens: changeVs(current.totalTokens, prior.totalTokens),
      prompts: changeVs(current.prompts, prior.prompts),
      energyWh: changeVs(current.energyWh, prior.energyWh),
    },
    sessions,
    empty: !(current.totalTokens || current.prompts || current.sessions),
    hasOptimizations: optimizations > 0,
  }
}

/**
 * Facts the data can actually support.
 *
 * Every entry is produced by a deterministic test over the model — no
 * narration, no generated prose, no thresholds chosen to make a sentence
 * appear. A statement that fails its own guard is simply not returned, which is
 * why this can come back empty and the UI has to cope with that.
 */
export function insights(model) {
  const out = []
  if (!model || model.empty) return out
  const { series, current, prior, deltas } = model

  // 1. Period-over-period usage. Needs a non-zero prior period to divide by.
  if (deltas.totalTokens && deltas.totalTokens.direction !== 'flat') {
    const d = deltas.totalTokens
    out.push({
      id: 'usage-delta',
      value: `${Math.abs(d.pct).toFixed(0)}%`,
      text: `${d.direction === 'down' ? 'fewer' : 'more'} tokens than the previous ${current.days} days`,
      basis: `${Math.round(current.totalTokens).toLocaleString()} vs ${Math.round(prior.totalTokens).toLocaleString()}`,
    })
  }

  // 2. Heaviest day — only when one day genuinely stands out. A peak that is
  //    within 25% of the runner-up is not a pattern, it is noise.
  const byUse = [...series].filter((d) => d.used > 0).sort((a, b) => b.used - a.used)
  if (byUse.length >= 3 && byUse[0].used > byUse[1].used * 1.25) {
    out.push({
      id: 'peak-day',
      value: formatDayLabel(byUse[0].date, { weekday: 'long' }),
      text: 'was the highest-usage day',
      basis: `${Math.round(byUse[0].used).toLocaleString()} tokens`,
    })
  }

  // 3. Concentration of savings. Only stated when the ledger records how many
  //    optimizations produced the biggest day's savings.
  const bySave = [...series].filter((d) => d.saved > 0).sort((a, b) => b.saved - a.saved)
  if (bySave.length >= 2 && current.tokensSaved > 0 && bySave[0].optimizations > 0) {
    const share = (bySave[0].saved / current.tokensSaved) * 100
    if (share >= 30) {
      out.push({
        id: 'savings-concentration',
        value: `${share.toFixed(0)}%`,
        text: `of this period's savings came from ${bySave[0].optimizations} optimization${bySave[0].optimizations === 1 ? '' : 's'} on ${formatDayLabel(bySave[0].date, { weekday: 'long' })}`,
        basis: `${Math.round(bySave[0].saved).toLocaleString()} of ${Math.round(current.tokensSaved).toLocaleString()} tokens`,
      })
    }
  }

  // 4. Reduction rate. Only where originals are recorded for every event
  //    counted, which `avgReduction` already guarantees by returning null.
  if (model.avgReduction != null && current.optimizations >= 2) {
    out.push({
      id: 'reduction-rate',
      value: `${model.avgReduction.toFixed(1)}%`,
      text: `of the original wording came out of the ${current.optimizations} prompts you tightened`,
      basis: `${Math.round(current.tokensSaved).toLocaleString()} of ${Math.round(current.optimizedOriginalTokens).toLocaleString()} tokens`,
    })
  }

  return out
}

/** Rows for the session ledger, flattened and pre-formatted for the table. */
export function ledgerRows(sessions, { limit = 0 } = {}) {
  const rows = (sessions || []).map((s) => {
    const start = new Date(s.startTime)
    return {
      id: s.id,
      time: start.getTime(),
      date: localDayKey(start),
      dateLabel: formatDayLabel(localDayKey(start), { month: 'short', day: 'numeric' }),
      timeLabel: start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
      platform: s.platform || 'other',
      promptTokens: (s.queries || []).reduce((n, q) => n + (q.promptTokens || 0), 0),
      responseTokens: (s.queries || []).reduce((n, q) => n + (q.responseTokens || 0), 0),
      totalTokens: s.totalTokens || 0,
      prompts: s.queryCount || 0,
      energyWh: s.totalEnergyWh || 0,
      waterMl: s.totalWaterMl || 0,
      co2G: s.totalCo2G || 0,
      queries: s.queries || [],
    }
  })
  rows.sort((a, b) => b.time - a.time)
  return limit > 0 ? rows.slice(0, limit) : rows
}

/** Day keys for the last `days` calendar days ending now — used by empty states. */
export function windowDays(days = 7, now = Date.now()) {
  const out = []
  for (let i = days - 1; i >= 0; i -= 1) out.push(localDayKey(now - i * DAY))
  return out
}
