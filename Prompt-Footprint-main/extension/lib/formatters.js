// PromptFootprint Real-World Formatters
// ---------------------------------------------------------------------------
// Single source of truth for turning raw impact values (water mL, energy Wh,
// CO2 g) into human-readable equivalents. Two render forms are produced per
// value so each surface keeps its existing wording:
//   main / sub  — two-part form used by the popup stat cards
//   compact     — single-line form used by the in-page modal
//
// The conversion ratios and thresholds live here only, so the popup and the
// content-script modal can never drift apart.

(function (root) {
  'use strict';

  // Water — drops (~20 per mL) → tsp (5 mL) → fraction of a 250 mL glass.
  function water(ml) {
    if (ml <= 0)   return { main: '0 drops',  sub: 'of water', compact: '0 drops' };
    if (ml < 0.05) return { main: '< 1 drop', sub: 'of water', compact: '< 1 drop' };
    if (ml < 1.5) {
      const n = Math.round(ml * 20);
      return { main: `≈ ${n} drops`, sub: 'of water', compact: `≈ ${n} drops` };
    }
    if (ml < 5) {
      const x = (ml / 5).toFixed(1);
      return { main: `≈ ${x} tsp`, sub: 'of water', compact: `≈ ${x} tsp` };
    }
    if (ml < 250) {
      const p = Math.round((ml / 250) * 100);
      return { main: `≈ ${p}%`, sub: 'of a glass of water', compact: `≈ ${p}% of a glass` };
    }
    const g = (ml / 250).toFixed(1);
    return { main: `≈ ${g} glasses`, sub: 'of water', compact: `≈ ${g} glasses` };
  }

  // Energy — phone screen-on time (~3 W → 1 Wh = 1200 s).
  function energy(wh) {
    if (wh <= 0) return { main: '< 1 sec', sub: 'of phone use', compact: '< 1 sec phone' };
    const s = wh * 1200;
    if (s < 2)  return { main: '< 2 sec', sub: 'of phone screen-on', compact: '< 2 sec phone' };
    if (s < 60) {
      const n = Math.round(s);
      return { main: `≈ ${n}s`, sub: 'of phone screen-on', compact: `≈ ${n}s phone` };
    }
    if (s < 3600) {
      const n = Math.round(s / 60);
      return { main: `≈ ${n} min`, sub: 'of phone screen-on', compact: `≈ ${n} min phone` };
    }
    const x = (s / 3600).toFixed(1);
    return { main: `≈ ${x} hrs`, sub: 'of phone screen-on', compact: `≈ ${x} hr phone` };
  }

  // CO2 — distance driven by car (~200 g/km → 1 g = 5 m).
  function co2(g) {
    if (g <= 0) return { main: '< 1 cm', sub: 'driven by car', compact: '< 1 cm by car' };
    const m = g * 5;
    if (m < 1) {
      const n = Math.round(m * 100);
      return { main: `≈ ${n} cm`, sub: 'driven by car', compact: `≈ ${n} cm by car` };
    }
    if (m < 1000) {
      const x = m.toFixed(1);
      return { main: `≈ ${x} m`, sub: 'driven by car', compact: `≈ ${x} m by car` };
    }
    const x = (m / 1000).toFixed(2);
    return { main: `≈ ${x} km`, sub: 'driven by car', compact: `≈ ${x} km by car` };
  }

  const PFFormat = { water, energy, co2 };

  if (root) root.PFFormat = PFFormat;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFFormat;
})(typeof self !== 'undefined' ? self : this);
