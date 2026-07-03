// Local-timezone day helpers.
//
// Sessions and savings are stored with UTC ISO timestamps (instants). Those are
// correct to keep in UTC. But every *user-facing* day grouping, chart axis, and
// label must use the browser's LOCAL calendar day, so "today" and the weekly
// buckets match the clock on the wall — not UTC. Mixing the two is what made the
// weekly chart show the wrong day for anyone whose local date differs from UTC.

// localDayKey(dateLike) -> "YYYY-MM-DD" for the LOCAL calendar day of an instant.
export function localDayKey(dateLike) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// formatDayLabel("YYYY-MM-DD") -> human label, parsing the key as a LOCAL date.
// new Date("YYYY-MM-DD") parses as UTC midnight, which shifts a day for negative
// UTC offsets; constructing from parts keeps the label on the bucketed day.
export function formatDayLabel(dayKey, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  const [y, m, d] = String(dayKey).split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return dt.toLocaleDateString('en-US', opts);
}
