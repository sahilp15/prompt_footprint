// PromptFootprint Carbon and Water Factors
// ---------------------------------------------------------------------------
// Carbon and water are kept SEPARATE from energy and from each other, and every
// factor carries the accounting boundary it was measured under.
//
// The rule this file exists to enforce: two numbers computed under different
// boundaries may never be added, averaged, or displayed in one unlabelled field.
// Google's 0.26 mL is cooling water inside Google's fleet. The Azure/AWS proxies
// are modelled on-site cooling PLUS electricity-generation water. Presenting
// either as "water used" without its boundary makes providers look comparable
// when they are not, so `combineCarbon`/`combineWater` refuse to merge mismatched
// scopes rather than quietly producing a wrong number.

(function (root) {
  'use strict';

  // ── Carbon (gCO2e per Wh) ────────────────────────────────────────────────

  const CARBON_FACTORS = {
    // Google reports 0.03 gCO2e for 0.24 Wh -> 0.125 g/Wh on the rounded totals,
    // while the rounded Scope 2 + Scope 1/3 components imply about 0.14 g/Wh.
    // Both are inside the same fleet and accounting context, so the honest form
    // is the range, not one of the two endpoints.
    google_fleet: {
      id: 'google_fleet',
      provider: 'google',
      gPerWh: { low: 0.125, central: 0.1325, high: 0.14 },
      scope: 'market_based_plus_allocated_embodied',
      accounting: 'market-based',
      method: 'Ratio implied by Google\'s reported Gemini Apps totals (market-based Scope 2 plus allocated Scope 1/3 and embodied)',
      sourceIds: ['S1'],
      appliesWithin: 'Google fleet and accounting context only',
    },
    azure_openai_proxy: {
      id: 'azure_openai_proxy',
      provider: 'openai',
      gPerWh: { central: 0.35 },
      scope: 'location_based_grid_proxy',
      accounting: 'location-based',
      method: 'Independent Azure carbon-intensity proxy, 0.35 kgCO2e/kWh',
      sourceIds: ['S5'],
      appliesWithin: 'Independent infrastructure proxy, not OpenAI telemetry',
    },
    aws_anthropic_proxy: {
      id: 'aws_anthropic_proxy',
      provider: 'anthropic',
      gPerWh: { central: 0.287 },
      scope: 'location_based_grid_proxy',
      accounting: 'location-based',
      method: 'Independent AWS-weighted carbon-intensity proxy, 0.287 kgCO2e/kWh',
      sourceIds: ['S5'],
      appliesWithin: 'Independent infrastructure proxy, not Anthropic telemetry. Current Claude can run on several clouds.',
    },
    unknown_grid: {
      id: 'unknown_grid',
      provider: 'unknown',
      // Geometric centre of a band spanning 6x; an arithmetic midpoint would
      // read as a specific claim about a grid we have not identified.
      gPerWh: { low: 0.10, central: Math.sqrt(0.10 * 0.60), high: 0.60 },
      scope: 'unknown_grid_range',
      accounting: 'unspecified',
      method: 'Broad grid-dependent operational range for an unidentified deployment',
      sourceIds: ['S4', 'S5'],
      appliesWithin: 'Deployment region and accounting method unknown',
    },
  };

  // ── Water (mL per Wh) ────────────────────────────────────────────────────
  // `boundary` is the field that must never be dropped:
  //   cooling          on-site cooling of the machines and their infrastructure
  //   full-operational on-site cooling PLUS water for generating the electricity
  //   undisclosed      a published number whose boundary was never stated

  const AZURE_WATER = { pue: 1.12, siteWueLPerKwh: 0.30, sourceWueLPerKwh: 4.35 };
  const AWS_WATER = { pue: 1.14, siteWueLPerKwh: 0.18, sourceWueLPerKwh: 5.11 };

  // L/kWh is numerically mL/Wh. Site WUE is measured at the facility, so it is
  // divided by PUE to bring it onto the same IT-energy basis as source WUE.
  function operationalWaterMlPerWh(p) {
    return p.sourceWueLPerKwh + p.siteWueLPerKwh / p.pue;
  }

  const WATER_FACTORS = {
    google_product_cooling: {
      id: 'google_product_cooling',
      provider: 'google',
      // Fleet WUE Category 2 of 1.15 L/kWh == 1.15 mL/Wh. Google's rounded
      // energy/water totals (0.24 Wh, 0.26 mL) do not divide to exactly this,
      // so the anchor pair is preferred whenever the product median applies.
      mlPerWh: 1.15,
      anchor: { energyWh: 0.24, waterMl: 0.26 },
      scope: 'datacenter_cooling_and_associated_infrastructure',
      boundary: 'cooling',
      method: 'Google fleet WUE Category 2; excludes broader upstream and lifecycle water',
      sourceIds: ['S1'],
      appliesWithin: 'Same Google fleet cooling conditions',
    },
    chatgpt_reported: {
      id: 'chatgpt_reported',
      provider: 'openai',
      anchor: { energyWh: 0.34, waterMl: 0.322 },
      mlPerWh: 0.322 / 0.34,
      scope: 'undisclosed',
      boundary: 'undisclosed',
      method: 'Reported 0.000085 US gal per average query; boundary never stated',
      sourceIds: ['S2'],
      appliesWithin: 'Unknown — do not label this cooling-only or full-operational',
    },
    azure_full_operational: {
      id: 'azure_full_operational',
      provider: 'openai',
      mlPerWh: operationalWaterMlPerWh(AZURE_WATER),
      components: AZURE_WATER,
      scope: 'onsite_cooling_plus_electricity_generation',
      boundary: 'full-operational',
      method: 'Azure PUE 1.12, site WUE 0.30 L/kWh, source WUE 4.35 L/kWh; excludes hardware-manufacturing water',
      sourceIds: ['S5'],
      appliesWithin: 'Modelled Azure operational boundary',
    },
    aws_full_operational: {
      id: 'aws_full_operational',
      provider: 'anthropic',
      mlPerWh: operationalWaterMlPerWh(AWS_WATER),
      components: AWS_WATER,
      scope: 'onsite_cooling_plus_electricity_generation',
      boundary: 'full-operational',
      method: 'AWS PUE 1.14, site WUE 0.18 L/kWh, source WUE 5.11 L/kWh; excludes hardware-manufacturing water',
      sourceIds: ['S5'],
      appliesWithin: 'Modelled AWS operational boundary',
    },
    hyperscaler_full_operational_range: {
      id: 'hyperscaler_full_operational_range',
      provider: 'unknown',
      mlPerWhLow: operationalWaterMlPerWh(AZURE_WATER),
      mlPerWh: (operationalWaterMlPerWh(AZURE_WATER) + operationalWaterMlPerWh(AWS_WATER)) / 2,
      mlPerWhHigh: operationalWaterMlPerWh(AWS_WATER),
      scope: 'onsite_cooling_plus_electricity_generation',
      boundary: 'full-operational',
      method: 'Span of the Azure and AWS operational proxies, used when the deployment is unknown',
      sourceIds: ['S5'],
      appliesWithin: 'Unidentified hyperscale deployment',
    },
  };

  function carbonFactor(id) { return CARBON_FACTORS[id] || null; }
  function waterFactor(id) { return WATER_FACTORS[id] || null; }

  function _range(v) {
    if (v == null) return null;
    if (typeof v === 'number') return { low: v, central: v, high: v };
    return { low: v.low != null ? v.low : v.central, central: v.central, high: v.high != null ? v.high : v.central };
  }

  /**
   * Carbon for an energy range under ONE named factor. The returned object always
   * carries scope, accounting, factorId, and sources — there is no code path that
   * produces a bare gram number.
   */
  function carbonFromEnergy(energyWh, factorId) {
    const f = carbonFactor(factorId);
    const e = _range(energyWh);
    if (!f || !e) return null;
    const g = _range(f.gPerWh);
    return {
      low: e.low * g.low,
      central: e.central * g.central,
      high: e.high * g.high,
      unit: 'gCO2e',
      factorId: f.id,
      scope: f.scope,
      accounting: f.accounting,
      method: f.method,
      appliesWithin: f.appliesWithin,
      sourceIds: f.sourceIds,
    };
  }

  /**
   * Water for an energy range under ONE named factor, with its boundary attached.
   * When the factor carries a measured anchor pair (Google, ChatGPT), the anchor
   * ratio is used so the displayed number reproduces the published one at the
   * published energy rather than drifting off a rounded WUE.
   */
  function waterFromEnergy(energyWh, factorId) {
    const f = waterFactor(factorId);
    const e = _range(energyWh);
    if (!f || !e) return null;
    const lowRate = f.mlPerWhLow != null ? f.mlPerWhLow : f.mlPerWh;
    const highRate = f.mlPerWhHigh != null ? f.mlPerWhHigh : f.mlPerWh;
    const midRate = f.anchor ? (f.anchor.waterMl / f.anchor.energyWh) : f.mlPerWh;
    return {
      low: e.low * lowRate,
      central: e.central * midRate,
      high: e.high * highRate,
      unit: 'mL',
      factorId: f.id,
      scope: f.scope,
      boundary: f.boundary,
      method: f.method,
      appliesWithin: f.appliesWithin,
      sourceIds: f.sourceIds,
    };
  }

  /**
   * Merge carbon results ONLY when they share an accounting method. Mixing
   * market-based and location-based figures under one field would rank providers
   * by an artefact of their reporting choice, so it is refused outright.
   */
  function combineCarbon(results) {
    const list = (results || []).filter(Boolean);
    if (!list.length) return { ok: false, mixed: false, reason: 'no-carbon-results', value: null };
    const accountings = new Set(list.map((r) => r.accounting));
    if (accountings.size > 1) {
      return {
        ok: false,
        mixed: true,
        reason: 'mixed-accounting',
        message: `Refusing to combine carbon figures with different accounting methods (${Array.from(accountings).join(', ')}). Show them side by side with their labels instead.`,
        value: null,
        parts: list,
      };
    }
    const acc = list.reduce((a, r) => ({ low: a.low + r.low, central: a.central + r.central, high: a.high + r.high }),
      { low: 0, central: 0, high: 0 });
    return { ok: true, mixed: false, value: { ...acc, unit: 'gCO2e', accounting: list[0].accounting, scope: list[0].scope, factorId: list.map((r) => r.factorId).join('+'), sourceIds: list.flatMap((r) => r.sourceIds || []) } };
  }

  /** Same rule for water, keyed on the boundary rather than the accounting method. */
  function combineWater(results) {
    const list = (results || []).filter(Boolean);
    if (!list.length) return { ok: false, mixed: false, reason: 'no-water-results', value: null };
    const boundaries = new Set(list.map((r) => r.boundary));
    if (boundaries.size > 1) {
      return {
        ok: false,
        mixed: true,
        reason: 'mixed-boundary',
        message: `Refusing to combine water figures with different boundaries (${Array.from(boundaries).join(', ')}). Cooling-only and full-operational water are different quantities.`,
        value: null,
        parts: list,
      };
    }
    const acc = list.reduce((a, r) => ({ low: a.low + r.low, central: a.central + r.central, high: a.high + r.high }),
      { low: 0, central: 0, high: 0 });
    return { ok: true, mixed: false, value: { ...acc, unit: 'mL', boundary: list[0].boundary, scope: list[0].scope, factorId: list.map((r) => r.factorId).join('+'), sourceIds: list.flatMap((r) => r.sourceIds || []) } };
  }

  /** The carbon factor to use for a provider, given what we know about deployment. */
  function carbonFactorForProvider(provider, opts) {
    const o = opts || {};
    if (provider === 'google') return CARBON_FACTORS.google_fleet;
    if (provider === 'openai') return CARBON_FACTORS.azure_openai_proxy;
    // Claude runs on several clouds; without a known deployment the AWS proxy is
    // a centre, not a bound, so the caller widens with the unknown-grid range.
    if (provider === 'anthropic') {
      return o.deploymentKnown ? CARBON_FACTORS.aws_anthropic_proxy : CARBON_FACTORS.unknown_grid;
    }
    return CARBON_FACTORS.unknown_grid;
  }

  const PFEnvFactors = {
    CARBON_FACTORS,
    WATER_FACTORS,
    AZURE_WATER,
    AWS_WATER,
    operationalWaterMlPerWh,
    carbonFactor,
    waterFactor,
    carbonFromEnergy,
    waterFromEnergy,
    combineCarbon,
    combineWater,
    carbonFactorForProvider,
  };

  if (root) root.PFEnvFactors = PFEnvFactors;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFEnvFactors;
})(typeof self !== 'undefined' ? self : this);
