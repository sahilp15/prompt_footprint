// The dashboard's metric definitions, pinned.
// ---------------------------------------------------------------------------
// `lib/efficiency.js` is where every headline figure is defined once. These
// tests exist because the definitions are the kind of thing that quietly drifts
// — someone divides a saving by the wrong total, or an "insight" starts firing
// on data that cannot support it, and the dashboard reads confidently while
// being wrong. Each case below states the definition it is protecting.

import { test } from 'node:test'
import assert from 'node:assert/strict'

// @ts-expect-error — plain JS module, deliberately untyped like the rest of the app.
import { avgReduction, removedShare, changeVs, buildModel, insights, ledgerRows } from '../src/lib/efficiency.js'

const DAY = 24 * 60 * 60 * 1000

/** A weekly payload shaped exactly like lib/api.js produces. */
function weekly(days: number[], prior: number[] = []) {
  const daily = days.map((tokens, i) => ({
    date: `2026-08-${String(14 + i).padStart(2, '0')}`,
    tokens, energyWh: tokens * 0.001, waterMl: tokens * 0.0035, co2G: tokens * 0.0004, queries: tokens > 0 ? 2 : 0,
  }))
  const previousDaily = prior.map((tokens, i) => ({
    date: `2026-08-${String(7 + i).padStart(2, '0')}`,
    tokens, energyWh: tokens * 0.001, waterMl: tokens * 0.0035, co2G: tokens * 0.0004, queries: tokens > 0 ? 2 : 0,
  }))
  const sum = (a: number[]) => a.reduce((n, v) => n + v, 0)
  return {
    daily,
    previousDaily,
    totals: {
      totalTokens: sum(days),
      totalEnergyWh: sum(days) * 0.001,
      totalWaterMl: sum(days) * 0.0035,
      totalCo2G: sum(days) * 0.0004,
      queryCount: daily.reduce((n, d) => n + d.queries, 0),
      sessionCount: daily.filter((d) => d.tokens > 0).length,
    },
    previous: {
      totalTokens: sum(prior),
      totalEnergyWh: sum(prior) * 0.001,
      totalWaterMl: sum(prior) * 0.0035,
      totalCo2G: sum(prior) * 0.0004,
      queryCount: previousDaily.reduce((n, d) => n + d.queries, 0),
      sessionCount: previousDaily.filter((d) => d.tokens > 0).length,
    },
  }
}

function savings(perDay: Array<{ date: string; count: number; tokens: number; originalTokens?: number }>) {
  const daily: Record<string, unknown> = {}
  for (const d of perDay) {
    daily[d.date] = {
      count: d.count, tokens: d.tokens,
      originalTokens: d.originalTokens ?? 0,
      energyWh: 0, waterMl: 0, co2G: 0,
    }
  }
  return { daily, previous: { applyCount: 0, totalTokensSaved: 0, totalOriginalTokens: 0 } }
}

// ── avgReduction ────────────────────────────────────────────────────────────

test('avgReduction divides tokens removed by the ORIGINAL tokens they came from', () => {
  assert.equal(avgReduction({ tokensSaved: 20, optimizedOriginalTokens: 100 }), 20)
  assert.equal(avgReduction({ tokensSaved: 35, optimizedOriginalTokens: 163 })?.toFixed(1), '21.5')
})

test('avgReduction is null — not zero — when no original count was recorded', () => {
  // Null and zero mean different things: "cannot be computed" versus "nothing
  // was removed". The dashboard omits the metric on null and would print a
  // confident 0% on zero.
  assert.equal(avgReduction({ tokensSaved: 40, optimizedOriginalTokens: 0 }), null)
  assert.equal(avgReduction({}), null)
  assert.equal(avgReduction({ tokensSaved: 0, optimizedOriginalTokens: 100 }), 0)
})

// ── removedShare ────────────────────────────────────────────────────────────

test('removedShare measures against what the period WOULD have totalled', () => {
  // The removed tokens were never sent, so they are not inside totalTokens.
  // 200 removed out of a would-have-been 1200 is 16.7%, not 20%.
  assert.equal(removedShare({ tokensSaved: 200, totalTokens: 1000 }).toFixed(1), '16.7')
  assert.equal(removedShare({ tokensSaved: 0, totalTokens: 1000 }), 0)
  assert.equal(removedShare({ tokensSaved: 0, totalTokens: 0 }), 0)
})

// ── changeVs ────────────────────────────────────────────────────────────────

test('changeVs returns null with no prior period, rather than calling it +100%', () => {
  assert.equal(changeVs(500, 0), null)
  assert.deepEqual(changeVs(110, 100), { pct: 10, direction: 'up' })
  assert.deepEqual(changeVs(90, 100), { pct: -10, direction: 'down' })
  assert.equal(changeVs(1001, 1000)?.direction, 'flat')
})

// ── buildModel ──────────────────────────────────────────────────────────────

test('buildModel totals savings from the days inside the window only', () => {
  const model = buildModel({
    weekly: weekly([100, 0, 200, 300, 0, 400, 500]),
    savings: savings([
      { date: '2026-08-14', count: 1, tokens: 10, originalTokens: 50 },
      { date: '2026-08-19', count: 2, tokens: 30, originalTokens: 150 },
      // Outside the seven-day window — must not be counted.
      { date: '2026-08-01', count: 9, tokens: 900, originalTokens: 4000 },
    ]),
  })
  assert.equal(model.current.tokensSaved, 40)
  assert.equal(model.current.optimizations, 3)
  assert.equal(model.current.optimizedOriginalTokens, 200)
  assert.equal(model.avgReduction, 20)
  assert.equal(model.current.totalTokens, 1500)
})

test('buildModel pairs the previous period positionally, not by date', () => {
  // The reference trace is "the same weekday one period earlier". Its dates are
  // different by definition, so the two series line up by index.
  const model = buildModel({ weekly: weekly([10, 20, 30], [5, 40, 15]) })
  assert.equal(model.prevSeries.length, 3)
  assert.equal(model.prevSeries[1].used, 40)
  assert.equal(model.series[1].used, 20)
})

test('buildModel reports an empty period rather than zeros that look like data', () => {
  const model = buildModel({ weekly: weekly([0, 0, 0]), savings: savings([]) })
  assert.equal(model.empty, true)
  assert.equal(model.hasOptimizations, false)
  assert.equal(model.avgReduction, null)
})

test('savedImpact prices removed tokens with the shared per-token model', () => {
  const model = buildModel({
    weekly: weekly([1000]),
    savings: savings([{ date: '2026-08-14', count: 1, tokens: 1000, originalTokens: 5000 }]),
  })
  // 1,000 tokens at the GPT-4o anchor: ~1.06 Wh, ~3.54 mL, ~0.375 g.
  assert.ok(Math.abs(model.savedImpact.energyWh - 1.0607) < 0.01)
  assert.ok(Math.abs(model.savedImpact.waterMl - 3.5357) < 0.01)
  assert.ok(Math.abs(model.savedImpact.co2G - 0.3753) < 0.01)
})

// ── insights ────────────────────────────────────────────────────────────────

test('insights returns nothing for an empty period', () => {
  assert.deepEqual(insights(buildModel({ weekly: weekly([0, 0, 0]) })), [])
})

test('insights does not claim a peak day when no day actually stands out', () => {
  // Three near-identical days. A "highest-usage day" here would be noise.
  const model = buildModel({ weekly: weekly([100, 104, 98, 101, 99, 103, 100], [90, 90, 90, 90, 90, 90, 90]) })
  assert.equal(insights(model).some((f: { id: string }) => f.id === 'peak-day'), false)
})

test('insights names the peak day only when it clears the runner-up by 25%', () => {
  const model = buildModel({ weekly: weekly([100, 100, 500, 100, 100, 100, 100], [90, 90, 90, 90, 90, 90, 90]) })
  const peak = insights(model).find((f: { id: string }) => f.id === 'peak-day')
  assert.ok(peak, 'expected a peak-day insight')
  assert.match(peak.basis, /500/)
})

test('insights omits the reduction rate when originals were never recorded', () => {
  const model = buildModel({
    weekly: weekly([100, 200, 300]),
    savings: savings([
      { date: '2026-08-14', count: 1, tokens: 10 },
      { date: '2026-08-15', count: 1, tokens: 20 },
    ]),
  })
  assert.equal(insights(model).some((f: { id: string }) => f.id === 'reduction-rate'), false)
})

test('insights reports concentration only when one day carries 30% or more', () => {
  const spread = buildModel({
    weekly: weekly([100, 100, 100]),
    savings: savings([
      { date: '2026-08-14', count: 1, tokens: 34, originalTokens: 170 },
      { date: '2026-08-15', count: 1, tokens: 33, originalTokens: 165 },
      { date: '2026-08-16', count: 1, tokens: 33, originalTokens: 165 },
    ]),
  })
  // 34 of 100 is over the threshold; a genuinely even split would not be.
  const found = insights(spread).find((f: { id: string }) => f.id === 'savings-concentration')
  assert.ok(found)
  assert.match(found.value, /^3[0-9]%$/)
})

// ── ledgerRows ──────────────────────────────────────────────────────────────

test('ledgerRows splits prompt and response tokens and sorts newest first', () => {
  const now = Date.UTC(2026, 7, 20, 12, 0, 0)
  const rows = ledgerRows([
    {
      id: 'a', platform: 'chatgpt', startTime: new Date(now - DAY).toISOString(),
      totalTokens: 300, queryCount: 2, totalEnergyWh: 0.3, totalWaterMl: 1, totalCo2G: 0.1,
      queries: [{ promptTokens: 40, responseTokens: 160 }, { promptTokens: 20, responseTokens: 80 }],
    },
    {
      id: 'b', platform: 'claude', startTime: new Date(now).toISOString(),
      totalTokens: 100, queryCount: 1, totalEnergyWh: 0.1, totalWaterMl: 0.4, totalCo2G: 0.04,
      queries: [{ promptTokens: 25, responseTokens: 75 }],
    },
  ])
  assert.equal(rows[0].id, 'b')
  assert.equal(rows[1].promptTokens, 60)
  assert.equal(rows[1].responseTokens, 240)
})
