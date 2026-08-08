// The data-center regions the globe marks.
//
// Eight regions that concentrate a large share of public AI inference
// capacity. `intensity` is an approximate annual average grid carbon intensity
// in gCO₂e/kWh, taken from public grid data. It is illustrative context, not a
// routing claim: no prompt is ever traced to a location.
//
// Lives outside the Globe component so the marker sizes on the sphere and the
// legend beside it are driven by exactly the same numbers.

export const REGIONS = [
  { id: 'ashburn',   location: [39.0458, -76.8755], label: 'Ashburn, VA',  intensity: 330 },
  { id: 'dublin',    location: [53.3498, -6.2603],  label: 'Dublin, IE',   intensity: 290 },
  { id: 'mumbai',    location: [19.0760, 72.8777],  label: 'Mumbai, IN',   intensity: 630 },
  { id: 'singapore', location: [1.3521, 103.8198],  label: 'Singapore',    intensity: 410 },
  { id: 'tokyo',     location: [35.6762, 139.6503], label: 'Tokyo, JP',    intensity: 450 },
  { id: 'dallas',    location: [32.7767, -96.7970], label: 'Dallas, TX',   intensity: 390 },
  { id: 'london',    location: [51.5074, -0.1278],  label: 'London, UK',   intensity: 230 },
  { id: 'sydney',    location: [-33.8688, 151.209], label: 'Sydney, AU',   intensity: 640 },
]

const MIN_INTENSITY = Math.min(...REGIONS.map((r) => r.intensity))
const MAX_INTENSITY = Math.max(...REGIONS.map((r) => r.intensity))

/** 0 → 1 across the set, so the legend and the globe agree on "how heavy". */
export function intensityShare(intensity) {
  return (intensity - MIN_INTENSITY) / (MAX_INTENSITY - MIN_INTENSITY || 1)
}

// Dot size tracks carbon intensity, which is what the caption next to the
// globe has always promised: bigger dot, dirtier grid.
export const GLOBE_MARKERS = REGIONS.map((m) => ({
  location: m.location,
  size: 0.035 + intensityShare(m.intensity) * 0.045,
}))
